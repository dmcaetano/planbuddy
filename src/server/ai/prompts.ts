import type { GenerateContext } from "./demoAi.js";
import { beatCountForScale, isTripScale } from "../../shared/scale.js";

export function buildGenerateSystemPrompt(): string {
  return [
    "You are PlanBuddy's grounded local planner. Produce a decision-ready itinerary, not generic inspiration.",
    "A citation-validated place dossier is supplied in the user prompt. Use only named places in that dossier and copy their name, address, sourceUrl, sourceLabel, and factualNote exactly.",
    "Reply with JSON only, matching this shape exactly:",
    '{"candidates": [{"title": string, "rationale": string, "category": string, "indoor": boolean,',
    '"beats": [{"title": string, "description": string, "category": string, "indoor": boolean, "startTime": string|null, "durationMinutes": number|null, "travelMode": "walking"|"driving"|"transit"|"ferry"|null, "distanceFromPreviousKm": number|null, "travelMinutes": number|null, "place": {"name": string, "address": string|null, "kind": string, "sourceUrl": string, "sourceLabel": string, "factualNote": string}|null}],',
    '"walkingDistanceKm": number|null, "walkingMinutes": number|null, "estimatedCost": string|null,',
    '"checkBeforeYouGo": string[], "fallback": {"title": string, "description": string, "place": {"name": string, "address": string|null, "kind": string, "sourceUrl": string, "sourceLabel": string, "factualNote": string}|null}|null,',
    '"photoSearchTerm": string|null, "destinationAnchor": string|null, "resolverVenueIds": string[],',
    '"citations": [{"factId": string, "quote": string, "source": string}],',
    '"constraintCompliance": [{"constraintId": string, "satisfied": boolean}], "travelEstimateKm": number|null}]}',
    "Return exactly 1 best candidate with exactly 3 chronological beats. Commit to the strongest fit instead of offering a menu of ideas.",
    "For Day off/Weekend, each candidate must name a real, current meal/activity venue plus permanent walkable geography. For Getaway/Vacation, set a real destinationAnchor and three useful trip beats.",
    "Never add a named venue, landmark, neighborhood, park, route stop, or source URL that is absent from the supplied dossier.",
    "Do not claim current opening hours, price, booking availability, dog acceptance, accessibility, or weather unless the cited source explicitly supports it. Put uncertain operational facts in checkBeforeYouGo as actions to verify.",
    "Distances and travel times are estimates: make them geographically plausible and conservative. Do not output Google Maps URLs; the server creates them.",
    "Make start times coherent with the request, sunset, heat, meals, and companions. Rationale must explain why this specific route fits the remembered household.",
    "For a local request that asks for walking plus a meal, use this exact sequence: a gentle pre-meal walk, the meal, then a soft after-meal stroll. Schedule the requested meal time exactly when one is given.",
    "walkingMinutes must include both walking between stops and time spent walking inside a park/promenade. walkingDistanceKm must cover that same total. Respect any explicit walking-time range.",
    "estimatedCost must be formatted per person and stay inside any explicit budget (for example, €35–50 per person). Never silently total multiple people.",
    "checkBeforeYouGo must cover current hours, reservation/terrace availability, pet acceptance when a pet is present, and any price/menu fact not established by the dossier.",
    "photoSearchTerm must be a permanent landmark, park, waterfront, or neighborhood actually on the route—not a restaurant and never an invented feature.",
    "Only cite memory facts given verbatim in the prompt. Never invent a memory citation.",
    "Self-report constraintCompliance for every hard constraint honestly. If a source cannot establish a constraint such as pet acceptance or gluten safety, mark it unsatisfied so the server rejects the candidate.",
    "resolverVenueIds must always be an empty array; web source validation is the venue firewall for this version.",
  ].join("\n");
}

function weatherLine(ctx: GenerateContext): string {
  const weather = ctx.weather;
  if (!weather || weather.unavailable) return "Live forecast: unavailable; make all weather advice conditional.";
  return [
    `Live forecast summary: ${weather.summary}`,
    weather.temperatureMinC != null ? `low ${weather.temperatureMinC}C` : null,
    weather.apparentTemperatureC != null ? `feels up to ${weather.apparentTemperatureC}C` : null,
    weather.windSpeedKph != null ? `wind up to ${weather.windSpeedKph} km/h` : null,
    weather.uvIndex != null ? `UV ${weather.uvIndex}` : null,
    weather.sunset ? `sunset ${weather.sunset}` : null,
  ]
    .filter(Boolean)
    .join("; ");
}

export function buildGenerateUserPrompt(ctx: GenerateContext): string {
  const lines: string[] = [];
  lines.push(
    `Scale: ${ctx.scale} (radius ${ctx.radiusKm}km, ${beatCountForScale(ctx.scale)} beats per candidate, trip=${isTripScale(ctx.scale)})`
  );
  lines.push(`Dates: ${ctx.startDate ?? "not supplied"} to ${ctx.endDate ?? ctx.startDate ?? "not supplied"}`);
  lines.push(
    `Home base: ${ctx.homeBaseLabel ?? "unknown"}` +
      (ctx.homeBaseLat != null && ctx.homeBaseLng != null
        ? ` (${ctx.homeBaseLat.toFixed(4)}, ${ctx.homeBaseLng.toFixed(4)})`
        : "")
  );
  lines.push(weatherLine(ctx));
  if (ctx.moodContext) lines.push(`Current request/context: "${ctx.moodContext}"`);

  lines.push("People and pets included:");
  if (!ctx.participants?.length) lines.push("- household owner");
  for (const p of ctx.participants ?? []) {
    lines.push(`- ${p.name}: ${p.kind}${p.relationship ? ` (${p.relationship})` : ""}`);
  }

  lines.push("Active household/participant constraints (hard vetoes):");
  if (ctx.activeConstraints.length === 0) lines.push("- none");
  for (const c of ctx.activeConstraints) lines.push(`- [id=${c.id}] ${c.text}`);

  lines.push("Known loved tastes and planning preferences:");
  if (ctx.loveTastes.length === 0) lines.push("- none");
  for (const t of ctx.loveTastes) lines.push(`- [id=${t.id}] ${t.text}`);

  lines.push("Known dislikes:");
  if (!ctx.avoidTastes?.length) lines.push("- none");
  for (const t of ctx.avoidTastes ?? []) lines.push(`- [id=${t.id}] ${t.text}`);

  if (ctx.preferenceHunches?.length) {
    lines.push("Feedback-learned hunches (soft, confidence-weighted; do not cite as facts):");
    for (const h of ctx.preferenceHunches) {
      lines.push(`- ${h.polarity} (confidence ${h.confidence.toFixed(2)}): ${h.text}`);
    }
  }

  lines.push(
    "Return exactly 1 grounded, detailed candidate using only the validated dossier below. Prefer one compact route over disconnected stops. JSON only."
  );
  lines.push(`Validated place dossier: ${JSON.stringify(ctx.groundedPlaces ?? [])}`);
  return lines.join("\n");
}

export function buildPlaceResearchSystemPrompt(): string {
  return [
    "Use web search to find a tiny factual place shortlist for PlanBuddy.",
    'Reply with JSON only: {"places": [{"name": string, "address": string|null, "kind": string, "sourceUrl": string, "sourceLabel": string, "factualNote": string, "bestFor": string[], "photoSearchTerm": string|null}]}.',
    "Return exactly 4 real places in a geographically compact area: one primary meal venue, two distinct permanent outdoor walk/landmark stops (one before and one after the meal), and one fallback meal venue.",
    "Copy every sourceUrl from the search results. factualNote may only repeat source-backed facts.",
    "Do not infer dog acceptance, shade, booking availability, route distance, or hours. Never invent geography.",
  ].join("\n");
}

export function buildPlaceResearchUserPrompt(ctx: GenerateContext): string {
  const participantSummary = (ctx.participants ?? []).map((p) => `${p.name} (${p.kind}${p.relationship ? `, ${p.relationship}` : ""})`).join(", ");
  const preferences = [
    ...ctx.loveTastes.map((taste) => taste.text),
    ...(ctx.avoidTastes ?? []).map((taste) => `avoid ${taste.text}`),
  ].join("; ");
  return [
    `Find the four best source-backed building blocks for one plan in ${ctx.homeBaseLabel ?? "the user's home city"}.`,
    `Date: ${ctx.startDate ?? "unspecified"}. Radius: ${ctx.radiusKm} km.`,
    ctx.moodContext ? `Request: ${ctx.moodContext}` : null,
    participantSummary ? `Participants: ${participantSummary}.` : null,
    preferences ? `Remembered preferences: ${preferences}.` : null,
    ctx.weather && !ctx.weather.unavailable ? `Forecast: ${ctx.weather.summary}; sunset ${ctx.weather.sunset ?? "unknown"}.` : null,
    "Prioritize a geographically compact combination and sources that clearly establish what each place is.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildChatSystemPrompt(): string {
  return [
    "You are PlanBuddy's chat assistant. Reply with JSON only:",
    '{"reply": string, "specUpdate": {"scale": string|null, "moodContext": string|null}|null,',
    '"extractions": [{"participantName": string|null, "kind": "constraint"|"taste", "text": string,',
    '"quote": string|null, "quoteStart": number|null, "quoteEnd": number|null, "polarity": "love"|"avoid"|null, "confidence": number}]}',
    "Only extract a constraint or taste when the user directly stated it in THIS message. `quote` must be a verbatim substring of the user's message, with correct character offsets. The server re-verifies it.",
    "Never fabricate a quote. If uncertain, omit the extraction.",
  ].join("\n");
}

export function buildChatUserPrompt(message: string): string {
  return `User message (verify quotes against this exact text): "${message}"`;
}

export function buildFeedbackSystemPrompt(): string {
  return [
    "You are PlanBuddy's feedback interpreter. Reply with JSON only:",
    '{"evidence": [{"participantName": string|null, "text": string, "polarity": "love"|"avoid", "confidence": number}]}',
    "Map free-text feedback to guarded preference evidence only. Never emit a safety constraint; that requires an explicit statement elsewhere.",
  ].join("\n");
}

export function buildFeedbackUserPrompt(rating: number, comment: string | null): string {
  return `Rating: ${rating}/5. Comment: ${comment ? `"${comment}"` : "(none)"}`;
}
