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
import { chatRespond } from "../ai/index.js";
import { verifyQuote } from "../memory/quoteVerify.js";
import { createConstraint } from "../memory/constraints.repo.js";
import { createTaste } from "../memory/tastes.repo.js";
import { recordHunchEvidence } from "../memory/hunches.repo.js";
import { findParticipantByName } from "../participants/repo.js";

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
    const { mode, response } = await chatRespond({ message: req.body.content, seed: userMessage.id });
    const assistantMessage = await addMessage(session.id, "assistant", response.reply);

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
      session: endedSession,
    });
  })
);
