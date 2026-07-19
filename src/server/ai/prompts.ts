import type { GenerateContext } from "./demoAi.js";
import { beatCountForScale, isTripScale } from "../../shared/scale.js";

export function buildGenerateSystemPrompt(): string {
  return [
    "You are PlanBuddy's candidate proposer. You suggest plan concepts; you never decide anything.",
    "Reply with JSON only, matching this shape exactly:",
    '{"candidates": [{"title": string, "rationale": string, "category": string, "indoor": boolean,',
    '"beats": [{"title": string, "description": string, "category": string, "indoor": boolean}],',
    '"destinationAnchor": string|null, "resolverVenueIds": string[], ',
    '"citations": [{"factId": string, "quote": string, "source": string}],',
    '"constraintCompliance": [{"constraintId": string, "satisfied": boolean}],',
    '"travelEstimateKm": number|null}]}',
    "Return exactly 8 candidates. Day off/Weekend candidates use exactly 1 beat. Getaway/Vacation candidates use exactly 3 beats and must set destinationAnchor to permanent geography (a real city/region name), never a specific venue you are not certain currently exists.",
    "Only cite facts given to you verbatim in the prompt (constraints, tastes, recent plan history) — never invent a citation.",
    "Never invent that a specific venue is currently open, closed, or exists unless a resolver venue ID is supplied to you.",
    "You must self-report constraintCompliance for every constraint given, honestly.",
  ].join("\n");
}

export function buildGenerateUserPrompt(ctx: GenerateContext): string {
  const lines: string[] = [];
  lines.push(`Scale: ${ctx.scale} (radius ${ctx.radiusKm}km, ${beatCountForScale(ctx.scale)} beat(s) per candidate, trip=${isTripScale(ctx.scale)})`);
  if (ctx.moodContext) lines.push(`Mood/context note from the user: "${ctx.moodContext}"`);
  lines.push("Active household/participant constraints (hard vetoes; you must not violate these):");
  if (ctx.activeConstraints.length === 0) lines.push("- none");
  for (const c of ctx.activeConstraints) lines.push(`- [id=${c.id}] ${c.text}`);
  lines.push("Known loved tastes (may cite by factId if directly relevant):");
  if (ctx.loveTastes.length === 0) lines.push("- none");
  for (const t of ctx.loveTastes) lines.push(`- [id=${t.id}] ${t.text}`);
  lines.push("Propose exactly 8 diverse, feasible candidates as JSON only, no prose outside the JSON.");
  return lines.join("\n");
}

export function buildChatSystemPrompt(): string {
  return [
    "You are PlanBuddy's chat assistant. Reply with JSON only:",
    '{"reply": string, "specUpdate": {"scale": string|null, "moodContext": string|null}|null,',
    '"extractions": [{"participantName": string|null, "kind": "constraint"|"taste", "text": string,',
    '"quote": string|null, "quoteStart": number|null, "quoteEnd": number|null, "polarity": "love"|"avoid"|null, "confidence": number}]}',
    "Only extract a constraint or taste when the user directly stated it in THIS message. `quote` must be a verbatim substring of the user's message you were just given, and quoteStart/quoteEnd must be the correct character offsets into that exact message — the server mechanically re-verifies this and demotes anything that doesn't match to a non-filtering hunch.",
    "Never fabricate a quote. If you are not confident, omit the extraction rather than guess.",
  ].join("\n");
}

export function buildChatUserPrompt(message: string): string {
  return `User message (verify quotes against this exact text): "${message}"`;
}

export function buildFeedbackSystemPrompt(): string {
  return [
    "You are PlanBuddy's feedback interpreter. Reply with JSON only:",
    '{"evidence": [{"participantName": string|null, "text": string, "polarity": "love"|"avoid", "confidence": number}]}',
    "You map free-text feedback to guarded preference evidence only. You must NEVER emit anything resembling a constraint (allergy, safety, accessibility) — that requires an explicit statement elsewhere, not post-plan feedback.",
  ].join("\n");
}

export function buildFeedbackUserPrompt(rating: number, comment: string | null): string {
  return `Rating: ${rating}/5. Comment: ${comment ? `"${comment}"` : "(none)"}`;
}
