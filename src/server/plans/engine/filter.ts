import type { AiCandidate } from "../../../shared/schemas.js";
import {
  blockedTermsForConstraint,
  containsUnsafeBlockedTerm,
  indoorOnlyRequired,
  outdoorOnlyRequired,
} from "./constraintKeywords.js";

export interface FilterContext {
  activeConstraints: { id: string; text: string }[];
  knownFacts: Map<string, string>; // factId -> verbatim fact text
  resolverMode: "inspiration" | "resolved";
  resolvedVenueIds?: string[];
  groundedSourceUrls?: string[];
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
  const groundedUrls = new Set((ctx.groundedSourceUrls ?? []).map(normalizeSourceUrl));
  const resolvedVenueIds = new Set(ctx.resolvedVenueIds ?? []);

  for (let candidate of candidates) {
    const text = candidateText(candidate);
    const normalizedTitle = candidate.title.trim().toLowerCase();

    const violated = ctx.activeConstraints.find((c) => {
      const blocked = blockedTermsForConstraint(c.text);
      if (blocked.some((term) => containsUnsafeBlockedTerm(text, term))) return true;
      if (indoorOnlyRequired(c.text) && !candidate.indoor) return true;
      if (outdoorOnlyRequired(c.text) && candidate.indoor) return true;
      return false;
    });
    if (violated) {
      rejected.push({ candidate, reason: `constraint violation: ${violated.text}` });
      continue;
    }

    // Memory citations explain why the plan fits; they are not safety or
    // venue evidence. A bad optional citation must never erase an otherwise
    // useful plan. Keep only citations that match a real fact verbatim.
    const sanitizedCitations = candidate.citations.filter(
      (cite) => {
        const factText = ctx.knownFacts.get(cite.factId);
        return Boolean(factText?.toLowerCase().includes(cite.quote.toLowerCase()));
      }
    );
    candidate = { ...candidate, citations: sanitizedCitations };

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
    if (candidate.resolverVenueIds.some((venueId) => !resolvedVenueIds.has(venueId))) {
      rejected.push({ candidate, reason: "venue-firewall: candidate referenced a place outside the resolver payload" });
      continue;
    }

    const placeSourceUrls = [
      ...candidate.beats.flatMap((beat) => (beat.place?.sourceUrl ? [beat.place.sourceUrl] : [])),
      ...(candidate.fallback?.place?.sourceUrl ? [candidate.fallback.place.sourceUrl] : []),
    ];
    // When the fast planner has a current web dossier, retain the strict
    // source firewall. When it deliberately runs without research, Maps
    // links and explicit verification checks are still useful; do not turn
    // the absence of optional research into a dead end.
    const unsupportedSource = groundedUrls.size > 0
      ? placeSourceUrls.find((url) => !groundedUrls.has(normalizeSourceUrl(url)))
      : undefined;
    if (unsupportedSource) {
      rejected.push({ candidate, reason: "place-source firewall: named place is not backed by web-search evidence" });
      continue;
    }

    seenTitles.add(normalizedTitle);
    kept.push(candidate);
  }

  return { kept, rejected };
}

function normalizeSourceUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return raw.trim().toLowerCase().replace(/\/+$/, "");
  }
}
