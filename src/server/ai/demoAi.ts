import type { AiCandidate, AiChatResponse, AiFeedbackResponse, AiGenerateResponse } from "../../shared/schemas.js";
import { isTripScale, type Scale } from "../../shared/scale.js";
import { LOCAL_TEMPLATES, TRIP_TEMPLATES } from "./contentPool.js";
import { hashSeed, mulberry32, seededShuffle } from "./rng.js";
import { blockedTermsForConstraint } from "../plans/engine/constraintKeywords.js";

export interface MemoryFact {
  id: string;
  text: string;
  source: "taste" | "constraint";
  tags?: string[];
}

export interface GenerateContext {
  scale: Scale;
  moodContext: string | null;
  radiusKm: number;
  activeConstraints: { id: string; text: string }[];
  loveTastes: MemoryFact[];
  seed: string; // unique per (planSpecId, batchIndex) for determinism
}

function candidateText(c: Pick<AiCandidate, "title" | "rationale" | "category"> & { beats: { title: string; description: string }[] }): string {
  return [c.title, c.rationale, c.category, ...c.beats.map((b) => `${b.title} ${b.description}`)]
    .join(" ")
    .toLowerCase();
}

function selfReportCompliance(
  text: string,
  constraints: { id: string; text: string }[]
): { constraintId: string; satisfied: boolean }[] {
  return constraints.map((c) => {
    const blocked = blockedTermsForConstraint(c.text);
    const satisfied = !blocked.some((term) => text.includes(term));
    return { constraintId: c.id, satisfied };
  });
}

export function generateCandidatesDemo(ctx: GenerateContext): AiGenerateResponse {
  const seed = hashSeed(ctx.seed);
  const rand = mulberry32(seed);
  const mood = (ctx.moodContext ?? "").toLowerCase();
  const loveTags = new Set(ctx.loveTastes.flatMap((t) => t.tags ?? []));

  if (isTripScale(ctx.scale)) {
    const shuffled = seededShuffle(TRIP_TEMPLATES, seed);
    const scored = shuffled
      .map((t) => {
        let bonus = 0;
        if (mood && t.tags.some((tag) => mood.includes(tag))) bonus += 2;
        if (t.tags.some((tag) => loveTags.has(tag))) bonus += 1;
        return { t, bonus };
      })
      .sort((a, b) => b.bonus - a.bonus);
    const chosen = scored.slice(0, Math.min(8, scored.length)).map((s) => s.t);
    const candidates: AiCandidate[] = chosen.map((t) => {
      const beats = t.beats.map((b) => ({ ...b, category: t.category }));
      const text = candidateText({ title: t.title, rationale: t.rationale, category: t.category, beats });
      const citations = ctx.loveTastes
        .filter((f) => t.tags.some((tag) => (f.tags ?? []).includes(tag)))
        .slice(0, 2)
        .map((f) => ({ factId: f.id, quote: f.text, source: f.source }));
      return {
        title: t.title,
        rationale: t.rationale,
        category: t.category,
        indoor: t.indoor,
        beats,
        destinationAnchor: t.destinationAnchor,
        resolverVenueIds: [],
        citations,
        constraintCompliance: selfReportCompliance(text, ctx.activeConstraints),
        travelEstimateKm: Math.round(50 + rand() * Math.max(1, ctx.radiusKm - 50)),
      };
    });
    return { candidates };
  }

  const shuffled = seededShuffle(LOCAL_TEMPLATES, seed);
  const scored = shuffled
    .map((t) => {
      let bonus = 0;
      if (mood && t.tags.some((tag) => mood.includes(tag))) bonus += 2;
      if (t.tags.some((tag) => loveTags.has(tag))) bonus += 1;
      return { t, bonus };
    })
    .sort((a, b) => b.bonus - a.bonus);
  const chosen = scored.slice(0, Math.min(8, scored.length)).map((s) => s.t);
  const candidates: AiCandidate[] = chosen.map((t) => {
    const beats = [t.beat];
    const text = candidateText({ title: t.title, rationale: t.rationale, category: t.category, beats });
    const citations = ctx.loveTastes
      .filter((f) => t.tags.some((tag) => (f.tags ?? []).includes(tag)))
      .slice(0, 2)
      .map((f) => ({ factId: f.id, quote: f.text, source: f.source }));
    return {
      title: t.title,
      rationale: t.rationale,
      category: t.category,
      indoor: t.indoor,
      beats: beats.map((b) => ({ ...b, category: t.category, indoor: t.indoor })),
      destinationAnchor: null,
      resolverVenueIds: [],
      citations,
      constraintCompliance: selfReportCompliance(text, ctx.activeConstraints),
      travelEstimateKm: Math.round(1 + rand() * Math.max(1, ctx.radiusKm)),
    };
  });
  return { candidates };
}

export interface ChatContext {
  message: string;
  seed: string;
}

const CONSTRAINT_PHRASES = [
  { re: /\ballerg(?:y|ic|ies)?\s+to\s+([a-z ]{2,30})/i, kind: "constraint" as const },
  { re: /\bno\s+([a-z ]{2,30})\s+(?:please|ever)?\b/i, kind: "constraint" as const },
  { re: /\bcan'?t\s+(?:eat|do|have)\s+([a-z ]{2,30})/i, kind: "constraint" as const },
];
const TASTE_LOVE_PHRASES = [/\bwe love\s+([a-z ]{2,30})/i, /\b(?:i|we)\s+really\s+like\s+([a-z ]{2,30})/i];
const TASTE_AVOID_PHRASES = [/\b(?:i|we)\s+(?:hate|dislike|don'?t like)\s+([a-z ]{2,30})/i];

export function chatRespondDemo(ctx: ChatContext): AiChatResponse {
  const msg = ctx.message;
  const extractions: AiChatResponse["extractions"] = [];

  for (const phrase of CONSTRAINT_PHRASES) {
    const match = msg.match(phrase.re);
    if (match) {
      const captured = match[1].trim();
      const quote = match[0].trim();
      const idx = msg.indexOf(quote);
      extractions.push({
        participantName: null,
        kind: "constraint",
        text: `No ${captured}`,
        quote,
        quoteStart: idx >= 0 ? idx : null,
        quoteEnd: idx >= 0 ? idx + quote.length : null,
        polarity: null,
        confidence: 0.9,
      });
      break;
    }
  }

  for (const re of TASTE_LOVE_PHRASES) {
    const match = msg.match(re);
    if (match) {
      const captured = match[1].trim();
      const quote = match[0].trim();
      const idx = msg.indexOf(quote);
      extractions.push({
        participantName: null,
        kind: "taste",
        text: captured,
        quote,
        quoteStart: idx >= 0 ? idx : null,
        quoteEnd: idx >= 0 ? idx + quote.length : null,
        polarity: "love",
        confidence: 0.75,
      });
      break;
    }
  }
  for (const re of TASTE_AVOID_PHRASES) {
    const match = msg.match(re);
    if (match) {
      const captured = match[1].trim();
      const quote = match[0].trim();
      const idx = msg.indexOf(quote);
      extractions.push({
        participantName: null,
        kind: "taste",
        text: captured,
        quote,
        quoteStart: idx >= 0 ? idx : null,
        quoteEnd: idx >= 0 ? idx + quote.length : null,
        polarity: "avoid",
        confidence: 0.7,
      });
      break;
    }
  }

  const reply =
    extractions.length > 0
      ? "Got it — I've noted that for your household memory. Want me to fold it into a plan?"
      : "Tell me a bit more about who's involved or what kind of day you're after, and I can turn it into a plan.";

  return { reply, specUpdate: null, extractions };
}

export function feedbackExtractDemo(comment: string): AiFeedbackResponse {
  const text = comment.toLowerCase();
  const evidence: AiFeedbackResponse["evidence"] = [];
  if (/loved|amazing|great pick|perfect/.test(text)) {
    evidence.push({ participantName: null, text: "similar plans to this one", polarity: "love", confidence: 0.6 });
  }
  if (/too (loud|crowded|far|expensive)|didn'?t (like|enjoy)|not a fan/.test(text)) {
    evidence.push({ participantName: null, text: "plans like this one", polarity: "avoid", confidence: 0.6 });
  }
  return { evidence };
}
