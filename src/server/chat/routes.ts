import { Router } from "express";
import { asyncHandler, notFound, validateBody } from "../http.js";
import { requireAuth } from "../auth/middleware.js";
import { aiRateLimiter } from "../rateLimit.js";
import { chatMessageCreateSchema } from "../../shared/schemas.js";
import {
  MAX_MESSAGES_PER_SESSION,
  addMessage,
  endSession,
  getOrCreateOpenSession,
  getSession,
  listMessages,
} from "./repo.js";
import { chatRespond, currentAiMode } from "../ai/index.js";
import { verifyQuote } from "../memory/quoteVerify.js";
import { createConstraint } from "../memory/constraints.repo.js";
import { createTaste } from "../memory/tastes.repo.js";
import { recordHunchEvidence } from "../memory/hunches.repo.js";
import {
  createParticipant,
  findParticipantByName,
  getParticipant,
  listParticipants,
  updateParticipant,
} from "../participants/repo.js";
import { nameKey, parseRelationshipIntent } from "./relationshipIntent.js";
import { parseTimeOffIntent } from "./timeOffIntent.js";
import { createTimeOff } from "../timeoff/repo.js";
import { timeOffCreateSchema } from "../../shared/schemas.js";
import { formatRange } from "../timeoff/nudge.js";
import type { TimeOffProposal } from "../../shared/momentTypes.js";
import { z } from "zod";
import { applyAppActions, buildAppSnapshot, composeAssistantReply } from "./appAssistant.js";

export const chatRouter = Router();
chatRouter.use(requireAuth);

chatRouter.get(
  "/session",
  asyncHandler(async (req, res) => {
    const session = await getOrCreateOpenSession(req.user!.id);
    const messages = await listMessages(session.id);
    res.json({ session, messages });
  })
);

chatRouter.post(
  "/session/end",
  asyncHandler(async (req, res) => {
    const session = await getOrCreateOpenSession(req.user!.id);
    const ended = await endSession(req.user!.id, session.id);
    res.json({ session: ended });
  })
);

chatRouter.post(
  "/session/:id/messages",
  aiRateLimiter,
  validateBody(chatMessageCreateSchema),
  asyncHandler(async (req, res) => {
    const session = await getSession(req.user!.id, req.params.id);
    if (!session) throw notFound();
    if (session.status !== "open") {
      res.status(400).json({ error: "This chat session has ended. Start a new one." });
      return;
    }

    const userMessage = await addMessage(session.id, "user", req.body.content);

    // "<Name> is my <relationship>": propose only; nothing is written until the confirm endpoint is called.
    const proposed = await proposeRelationship(req.user!.id, req.body.content);
    if (proposed) {
      const assistantMessage = await addMessage(session.id, "assistant", proposed.reply);
      let endedSession = session;
      if (session.messageCount + 2 >= MAX_MESSAGES_PER_SESSION) {
        endedSession = (await endSession(req.user!.id, session.id)) ?? session;
      }
      res.status(201).json({
        userMessage,
        assistantMessage,
        aiMode: currentAiMode(),
        specUpdate: null,
        memoryUpdates: [],
        relationshipProposal: proposed.proposal,
        timeOffProposal: null,
        session: endedSession,
      });
      return;
    }

    // "I'm off Dec 24 to 31": propose only; saved by the confirm endpoint on one tap.
    const today = new Date().toISOString().slice(0, 10);
    const timeOffProposal = parseTimeOffIntent(req.body.content, today);
    if (timeOffProposal) {
      const range = formatRange(timeOffProposal.startDate, timeOffProposal.endDate, today);
      const assistantMessage = await addMessage(
        session.id,
        "assistant",
        `Got it: ${timeOffProposal.label}, ${range}. Tap to save it to your Time off, or ignore this and nothing changes.`
      );
      let endedSession = session;
      if (session.messageCount + 2 >= MAX_MESSAGES_PER_SESSION) {
        endedSession = (await endSession(req.user!.id, session.id)) ?? session;
      }
      res.status(201).json({
        userMessage,
        assistantMessage,
        aiMode: currentAiMode(),
        specUpdate: null,
        memoryUpdates: [],
        relationshipProposal: null,
        timeOffProposal,
        session: endedSession,
      });
      return;
    }

    const snapshot = await buildAppSnapshot(req.user!.id);
    const { mode, response } = await chatRespond({ message: req.body.content, seed: userMessage.id, snapshot });
    const appResult = await applyAppActions(req.user!.id, response.actions, req.body.content);
    const assistantMessage = await addMessage(
      session.id,
      "assistant",
      composeAssistantReply(response.reply, response.actions.length, appResult)
    );

    const memoryUpdates: { kind: "constraint" | "taste" | "hunch"; text: string; verified: boolean }[] = [];

    for (const extraction of response.extractions) {
      const quoteValid = verifyQuote(req.body.content, extraction.quote, extraction.quoteStart, extraction.quoteEnd);
      const participant = extraction.participantName
        ? await findParticipantByName(req.user!.id, extraction.participantName)
        : null;

      if (extraction.kind === "constraint") {
        if (quoteValid) {
          await createConstraint(req.user!.id, {
            participantId: participant?.id ?? null,
            text: extraction.text,
            status: "active_unverified",
            source: "chat",
            sourceQuote: extraction.quote,
            sourceMessageId: userMessage.id,
          });
          memoryUpdates.push({ kind: "constraint", text: extraction.text, verified: true });
        } else {
          await recordHunchEvidence(req.user!.id, {
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
          await createTaste(req.user!.id, {
            participantId: participant?.id ?? null,
            text: extraction.text,
            polarity: extraction.polarity,
            weight: Math.max(0.3, extraction.confidence),
            source: "stated",
          });
          memoryUpdates.push({ kind: "taste", text: extraction.text, verified: true });
        } else {
          await recordHunchEvidence(req.user!.id, {
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
      endedSession = (await endSession(req.user!.id, session.id)) ?? session;
    }

    res.status(201).json({
      userMessage,
      assistantMessage,
      aiMode: mode,
      specUpdate: response.specUpdate ?? null,
      memoryUpdates,
      relationshipProposal: null,
      timeOffProposal: null,
      applied: appResult.applied,
      user: appResult.user,
      session: endedSession,
    });
  })
);

export interface RelationshipProposal {
  /** "set" updates an existing local person; "add" creates a new one. */
  action: "set" | "add";
  participantId: string | null;
  name: string;
  relationship: string;
  previousRelationship: string | null;
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

const confirmRelationshipSchema = z
  .object({
    participantId: z.string().trim().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    relationship: z.string().trim().min(1).max(120),
  })
  .refine((v) => v.participantId || v.name, { message: "participantId or name is required" });

// The confirm tap is what performs the write. Tenant-scoped; the owner cannot be edited here.
chatRouter.post(
  "/confirm-relationship",
  validateBody(confirmRelationshipSchema),
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { participantId, name, relationship } = req.body as z.infer<typeof confirmRelationshipSchema>;

    if (participantId) {
      const existing = await getParticipant(userId, participantId);
      if (!existing) throw notFound();
      if (existing.isOwner) {
        res.status(400).json({ error: "Your own entry has no relationship to set." });
        return;
      }
      const participant = await updateParticipant(userId, participantId, { relationship });
      if (!participant) throw notFound();
      res.json({ participant, created: false });
      return;
    }

    const match = await findLocalByName(userId, name!);
    if (match) {
      const participant = await updateParticipant(userId, match.id, { relationship });
      res.json({ participant, created: false });
      return;
    }
    const participant = await createParticipant(userId, { name: name!, kind: "person", relationship });
    res.status(201).json({ participant, created: true });
  })
);

export type { TimeOffProposal };

// The confirm tap is what performs the write.
chatRouter.post(
  "/confirm-time-off",
  validateBody(timeOffCreateSchema),
  asyncHandler(async (req, res) => {
    const timeOff = await createTimeOff(req.user!.id, req.body);
    res.status(201).json({ timeOff });
  })
);
