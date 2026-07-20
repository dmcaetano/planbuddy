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

    // Models occasionally cite an id shaped like a user-memory reference
    // (e.g. "memory-234cf483") that doesn't match any known fact id given in
    // the prompt, rather than an actual dossier source. That's a legitimate
    // (if slightly hallucinated) reference to conversational memory context,
    // not a fabricated dossier fact -- drop it instead of failing the whole
    // candidate. Anything else unmatched is still treated as fabricated.
    const sanitizedCitations = candidate.citations.filter(
      (cite) => ctx.knownFacts.has(cite.factId) || !/^memory-/i.test(cite.factId)
    );
    const invalidCitation = sanitizedCitations.find((cite) => {
      const factText = ctx.knownFacts.get(cite.factId);
      if (!factText) return true;
      return !factText.toLowerCase().includes(cite.quote.toLowerCase());
    });
    if (invalidCitation) {
      // Never surface the raw internal fact id to the user -- this reason
      // string can end up in a user-visible "every candidate was rejected"
      // message.
      rejected.push({ candidate, reason: "invalid citation: source could not be verified" });
      continue;
    }
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

    const placeSourceUrls = [
      ...candidate.beats.flatMap((beat) => (beat.place?.sourceUrl ? [beat.place.sourceUrl] : [])),
      ...(candidate.fallback?.place?.sourceUrl ? [candidate.fallback.place.sourceUrl] : []),
    ];
    const unsupportedSource = placeSourceUrls.find((url) => !groundedUrls.has(normalizeSourceUrl(url)));
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
