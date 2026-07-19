import type { Candidate, CandidateReaction, Reaction } from "../../shared/types.js";
import { eventFeatureExtract } from "../ai/index.js";
import { listParticipants } from "../participants/repo.js";
import { recordHunchEvidence, removeReactionEvidence } from "../memory/hunches.repo.js";
import { getCandidateReaction, upsertCandidateReaction } from "./reactions.repo.js";

export async function applyCandidateReaction(
  userId: string,
  candidate: Candidate,
  reaction: Reaction
): Promise<CandidateReaction> {
  const existing = await getCandidateReaction(userId, candidate.id);
  if (existing?.reaction === "love" && reaction !== "love") {
    await removeReactionEvidence(userId, candidate.id);
  }

  let learned: { summary: string; features: string[] } | null = null;
  if (reaction === "love") {
    learned = existing?.reaction === "love" && existing.featureSummary
      ? { summary: existing.featureSummary, features: existing.features }
      : (await eventFeatureExtract(candidate)).response;
  }

  const saved = await upsertCandidateReaction(userId, candidate.id, reaction, learned);
  if (reaction === "love" && learned) {
    const owner = (await listParticipants(userId)).find((participant) => participant.isOwner);
    for (const feature of learned.features) {
      await recordHunchEvidence(userId, {
        participantId: owner?.id ?? null,
        text: feature,
        polarity: "love",
        planId: null,
        sessionId: candidate.id,
        note: `Love: ${learned.summary}`,
      });
    }
  }
  return saved.reaction;
}
