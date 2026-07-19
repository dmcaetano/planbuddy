import type { AiCandidate } from "../../../shared/schemas.js";
import { blockedTermsForConstraint, indoorOnlyRequired, outdoorOnlyRequired } from "./constraintKeywords.js";

export interface FilterContext {
  activeConstraints: { id: string; text: string }[];
  knownFacts: Map<string, string>; // factId -> verbatim fact text
  resolverMode: "inspiration" | "resolved";
  radiusKm: number;
  isTripScale: boolean;
}

export interface RejectedCandidate {
  candidate: AiCandidate;
  reason: string;
}

export interface FilterResult {
  kept: AiCandidate[];
  rejected: RejectedCandidate[];
}

function candidateText(c: AiCandidate): string {
  return [c.title, c.rationale, c.category, ...c.beats.map((b) => `${b.title} ${b.description}`)]
    .join(" ")
    .toLowerCase();
}

const RADIUS_MULTIPLIER = 2;

export function filterCandidates(candidates: AiCandidate[], ctx: FilterContext): FilterResult {
  const kept: AiCandidate[] = [];
  const rejected: RejectedCandidate[] = [];
  const seenTitles = new Set<string>();

  for (const candidate of candidates) {
    const text = candidateText(candidate);
    const normalizedTitle = candidate.title.trim().toLowerCase();

    const violated = ctx.activeConstraints.find((c) => {
      const blocked = blockedTermsForConstraint(c.text);
      if (blocked.some((term) => text.includes(term))) return true;
      if (indoorOnlyRequired(c.text) && !candidate.indoor) return true;
      if (outdoorOnlyRequired(c.text) && candidate.indoor) return true;
      return false;
    });
    if (violated) {
      rejected.push({ candidate, reason: `constraint violation: ${violated.text}` });
      continue;
    }

    const invalidCitation = candidate.citations.find((cite) => {
      const factText = ctx.knownFacts.get(cite.factId);
      if (!factText) return true;
      return !factText.toLowerCase().includes(cite.quote.toLowerCase());
    });
    if (invalidCitation) {
      rejected.push({ candidate, reason: `invalid citation: ${invalidCitation.factId}` });
      continue;
    }

    if (!ctx.isTripScale && candidate.travelEstimateKm != null) {
      if (candidate.travelEstimateKm > ctx.radiusKm * RADIUS_MULTIPLIER) {
        rejected.push({ candidate, reason: "impossible radius" });
        continue;
      }
    }

    if (seenTitles.has(normalizedTitle)) {
      rejected.push({ candidate, reason: "duplicate candidate" });
      continue;
    }

    if (candidate.resolverVenueIds.length > 0 && ctx.resolverMode === "inspiration") {
      rejected.push({ candidate, reason: "venue-firewall: no live resolver payload backs this venue" });
      continue;
    }

    seenTitles.add(normalizedTitle);
    kept.push(candidate);
  }

  return { kept, rejected };
}
