// Pure business logic for the Buddy chat, split out of chat/routes.ts
// (2026-10, Cloudflare Worker port) for the same reason as
// moment/resolve.ts: that file did `import { Router } from "express"` and
// `export const chatRouter = Router()` at module scope, which crashes a
// Worker merely by being imported (live-verified for moment/routes.ts:
// "Uncaught TypeError: require_streams(...) is not a function" deep in
// body-parser/iconv-lite). Nothing here imports express.
import { otherBuddiesBlock } from "../omni/hub.js";
import { HttpError } from "../http.js";
import { MAX_MESSAGES_PER_SESSION, addMessage, endSession, getOrCreateOpenSession, getSession, listMessages } from "./repo.js";
import type { ChatMessage, ChatSession } from "../../shared/types.js";
import { chatRespond, currentAiMode, type AiMode } from "../ai/index.js";
import { verifyQuote } from "../memory/quoteVerify.js";
import { createConstraint } from "../memory/constraints.repo.js";
import { createTaste } from "../memory/tastes.repo.js";
import { recordHunchEvidence } from "../memory/hunches.repo.js";
import { createParticipant, findParticipantByName, getParticipant, listParticipants, updateParticipant } from "../participants/repo.js";
import { nameKey, parseRelationshipIntent } from "./relationshipIntent.js";
import { parseTimeOffIntent } from "./timeOffIntent.js";
import { formatRange } from "../timeoff/nudge.js";
import type { TimeOffProposal } from "../../shared/momentTypes.js";
import { applyAppActions, buildAppSnapshot, composeAssistantReply } from "./appAssistant.js";

export type { TimeOffProposal };

export interface RelationshipProposal {
  /** "set" updates an existing local person; "add" creates a new one. */
  action: "set" | "add";
  participantId: string | null;
  name: string;
  relationship: string;
  previousRelationship: string | null;
}

export async function getChatSession(userId: string): Promise<{ session: ChatSession; messages: ChatMessage[] }> {
  const session = await getOrCreateOpenSession(userId);
  const messages = await listMessages(session.id);
  return { session, messages };
}

export async function endChatSession(userId: string): Promise<ChatSession | null> {
  const session = await getOrCreateOpenSession(userId);
  return endSession(userId, session.id);
}

async function findLocalByName(userId: string, name: string) {
  const key = nameKey(name);
  const all = await listParticipants(userId);
  return all.find((p) => !p.isOwner && !p.isFriendAccount && nameKey(p.name) === key) ?? null;
}

async function proposeRelationship(
  userId: string,
  message: string
): Promise<{ reply: string; proposal: RelationshipProposal | null } | null> {
  const intent = parseRelationshipIntent(message);
  if (!intent) return null;
  const person = await findLocalByName(userId, intent.name);

  // A free (non-vocabulary) word is only trusted for someone already in the household.
  if (!person && !intent.known) return null;

  if (person) {
    if ((person.relationship ?? "").toLowerCase() === intent.relationship) {
      return { reply: `${person.name} is already saved as your ${intent.relationship}.`, proposal: null };
    }
    return {
      reply: `Got it: ${person.name} is your ${intent.relationship}. Tap to save it, or ignore this and nothing changes.`,
      proposal: {
        action: "set",
        participantId: person.id,
        name: person.name,
        relationship: intent.relationship,
        previousRelationship: person.relationship,
      },
    };
  }
  return {
    reply: `I don't have anyone called ${intent.name} yet. Want me to add ${intent.name} as your ${intent.relationship}?`,
    proposal: {
      action: "add",
      participantId: null,
      name: intent.name,
      relationship: intent.relationship,
      previousRelationship: null,
    },
  };
}

export interface PostMessageResult {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  aiMode: AiMode;
  specUpdate: unknown;
  memoryUpdates: { kind: "constraint" | "taste" | "hunch"; text: string; verified: boolean }[];
  relationshipProposal: RelationshipProposal | null;
  timeOffProposal: TimeOffProposal | null;
  session: ChatSession;
  applied?: unknown;
  user?: unknown;
  planRequest?: unknown;
}

export async function postChatMessage(userId: string, sessionId: string, content: string): Promise<PostMessageResult> {
  const session = await getSession(userId, sessionId);
  if (!session) throw new HttpError(404, "Not found");
  if (session.status !== "open") {
    throw new HttpError(400, "This chat session has ended. Start a new one.");
  }

  const userMessage = await addMessage(session.id, "user", content);

  // "<Name> is my <relationship>": propose only; nothing is written until the confirm endpoint is called.
  const proposed = await proposeRelationship(userId, content);
  if (proposed) {
    const assistantMessage = await addMessage(session.id, "assistant", proposed.reply);
    let endedSession = session;
    if (session.messageCount + 2 >= MAX_MESSAGES_PER_SESSION) {
      endedSession = (await endSession(userId, session.id)) ?? session;
    }
    return {
      userMessage,
      assistantMessage,
      aiMode: currentAiMode(),
      specUpdate: null,
      memoryUpdates: [],
      relationshipProposal: proposed.proposal,
      timeOffProposal: null,
      session: endedSession,
    };
  }

  // "I'm off Dec 24 to 31": propose only; saved by the confirm endpoint on one tap.
  const today = new Date().toISOString().slice(0, 10);
  const timeOffProposal = parseTimeOffIntent(content, today);
  if (timeOffProposal) {
    const range = formatRange(timeOffProposal.startDate, timeOffProposal.endDate, today);
    const assistantMessage = await addMessage(
      session.id,
      "assistant",
      `Got it: ${timeOffProposal.label}, ${range}. Tap to save it to your Time off, or ignore this and nothing changes.`
    );
    let endedSession = session;
    if (session.messageCount + 2 >= MAX_MESSAGES_PER_SESSION) {
      endedSession = (await endSession(userId, session.id)) ?? session;
    }
    return {
      userMessage,
      assistantMessage,
      aiMode: currentAiMode(),
      specUpdate: null,
      memoryUpdates: [],
      relationshipProposal: null,
      timeOffProposal,
      session: endedSession,
    };
  }

  const snapshot = await buildAppSnapshot(userId);
  const { mode, response } = await chatRespond({
    message: content,
    seed: userMessage.id,
    snapshot,
    otherBuddies: (await otherBuddiesBlock(userId, content)) || undefined,
  });
  const appResult = await applyAppActions(userId, response.actions, content);
  const assistantMessage = await addMessage(
    session.id,
    "assistant",
    composeAssistantReply(response.reply, response.actions.length, appResult)
  );

  const memoryUpdates: PostMessageResult["memoryUpdates"] = [];

  for (const extraction of response.extractions) {
    const quoteValid = verifyQuote(content, extraction.quote, extraction.quoteStart, extraction.quoteEnd);
    const participant = extraction.participantName ? await findParticipantByName(userId, extraction.participantName) : null;

    if (extraction.kind === "constraint") {
      if (quoteValid) {
        await createConstraint(userId, {
          participantId: participant?.id ?? null,
          text: extraction.text,
          status: "active_unverified",
          source: "chat",
          sourceQuote: extraction.quote,
          sourceMessageId: userMessage.id,
        });
        memoryUpdates.push({ kind: "constraint", text: extraction.text, verified: true });
      } else {
        await recordHunchEvidence(userId, {
          participantId: participant?.id ?? null,
          text: extraction.text,
          polarity: "avoid",
          sessionId: session.id,
          note: "Demoted from an unverifiable constraint quote in chat",
        });
        memoryUpdates.push({ kind: "hunch", text: extraction.text, verified: false });
      }
    } else if (extraction.kind === "taste" && extraction.polarity) {
      if (quoteValid) {
        await createTaste(userId, {
          participantId: participant?.id ?? null,
          text: extraction.text,
          polarity: extraction.polarity,
          weight: Math.max(0.3, extraction.confidence),
          source: "stated",
        });
        memoryUpdates.push({ kind: "taste", text: extraction.text, verified: true });
      } else {
        await recordHunchEvidence(userId, {
          participantId: participant?.id ?? null,
          text: extraction.text,
          polarity: extraction.polarity,
          sessionId: session.id,
          note: "Demoted from an unverifiable taste quote in chat",
        });
        memoryUpdates.push({ kind: "hunch", text: extraction.text, verified: false });
      }
    }
  }

  let endedSession = session;
  if (session.messageCount + 2 >= MAX_MESSAGES_PER_SESSION) {
    endedSession = (await endSession(userId, session.id)) ?? session;
  }

  return {
    userMessage,
    assistantMessage,
    aiMode: mode,
    specUpdate: response.specUpdate ?? null,
    memoryUpdates,
    relationshipProposal: null,
    timeOffProposal: null,
    applied: appResult.applied,
    user: appResult.user,
    planRequest: appResult.planRequest,
    session: endedSession,
  };
}

export async function confirmRelationship(
  userId: string,
  body: { participantId?: string; name?: string; relationship: string }
): Promise<{ participant: unknown; created: boolean }> {
  const { participantId, name, relationship } = body;

  if (participantId) {
    const existing = await getParticipant(userId, participantId);
    if (!existing) throw new HttpError(404, "Not found");
    if (existing.isOwner) {
      throw new HttpError(400, "Your own entry has no relationship to set.");
    }
    const participant = await updateParticipant(userId, participantId, { relationship });
    if (!participant) throw new HttpError(404, "Not found");
    return { participant, created: false };
  }

  const match = await findLocalByName(userId, name!);
  if (match) {
    const participant = await updateParticipant(userId, match.id, { relationship });
    return { participant, created: false };
  }
  const participant = await createParticipant(userId, { name: name!, kind: "person", relationship });
  return { participant, created: true };
}
