import { Router } from "express";
import { asyncHandler, notFound, validateBody } from "../http.js";
import { requireAuth } from "../auth/middleware.js";
import { tasteCreateSchema, tasteUpdateSchema, quizSubmitSchema } from "../../shared/schemas.js";
import { createTaste, deleteTaste, deleteTastesBySource, listTastes, updateTaste } from "./tastes.repo.js";
import { createConstraint, deleteConstraintsBySource } from "./constraints.repo.js";
import { listParticipants } from "../participants/repo.js";
import { QUIZ_CONSTRAINT_SOURCE, QUIZ_TASTE_SOURCE, resolveQuizWrites } from "../../shared/quiz.js";
import type { Constraint, Taste } from "../../shared/types.js";

export const tastesRouter = Router();
tastesRouter.use(requireAuth);

tastesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const tastes = await listTastes(req.user!.id);
    res.json({ tastes });
  })
);

tastesRouter.post(
  "/",
  validateBody(tasteCreateSchema),
  asyncHandler(async (req, res) => {
    const taste = await createTaste(req.user!.id, {
      participantId: req.body.participantId ?? null,
      text: req.body.text,
      polarity: req.body.polarity,
      weight: req.body.weight,
      source: "stated",
    });
    res.status(201).json({ taste });
  })
);

/**
 * Optional tap-first "fun profile" taste quiz. Writes structured, visible
 * tastes/constraints for the account owner participant, tagged with the
 * 'onboarding_quiz' provenance marker. Submitting again (a retake) first
 * removes every taste/constraint this endpoint previously wrote for the
 * user, then writes fresh ones from the new answers — so retaking never
 * duplicates. Unanswered / "Not sure" questions simply produce no writes.
 */
tastesRouter.post(
  "/quiz",
  validateBody(quizSubmitSchema),
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const owner = (await listParticipants(userId)).find((p) => p.isOwner);
    const participantId = owner?.id ?? null;

    const writes = resolveQuizWrites(req.body.answers);

    await deleteTastesBySource(userId, QUIZ_TASTE_SOURCE);
    await deleteConstraintsBySource(userId, QUIZ_CONSTRAINT_SOURCE);

    const tastes: Taste[] = [];
    const constraints: Constraint[] = [];

    for (const write of writes) {
      if (write.taste) {
        const taste = await createTaste(userId, {
          participantId,
          text: write.taste.text,
          polarity: write.taste.polarity,
          source: QUIZ_TASTE_SOURCE,
        });
        tastes.push(taste);
      }
      if (write.constraint) {
        const constraint = await createConstraint(userId, {
          participantId,
          text: write.constraint.text,
          status: "verified",
          source: QUIZ_CONSTRAINT_SOURCE,
        });
        constraints.push(constraint);
      }
    }

    res.status(201).json({ tastes, constraints });
  })
);

tastesRouter.patch(
  "/:id",
  validateBody(tasteUpdateSchema),
  asyncHandler(async (req, res) => {
    const taste = await updateTaste(req.user!.id, req.params.id, req.body);
    if (!taste) throw notFound();
    res.json({ taste });
  })
);

tastesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const ok = await deleteTaste(req.user!.id, req.params.id);
    if (!ok) throw notFound();
    res.status(204).end();
  })
);
