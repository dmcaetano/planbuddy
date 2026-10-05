import type { ReasonParts } from "../../shared/momentTypes.js";
import type { Participant, Taste, WeatherSnapshot } from "../../shared/types.js";

/** Words too common to count as a taste/plan overlap. */
const OVERLAP_STOP = new Set([
  "with", "that", "this", "from", "have", "like", "love", "good", "nice", "plan", "meal", "food", "place",
  "walk", "eat", "and", "the", "for", "near", "easy", "soft", "start", "finish", "stop",
]);

function plain(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function significantTokens(value: string): string[] {
  return Array.from(
    new Set(
      plain(value)
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 4 && !OVERLAP_STOP.has(token))
    )
  );
}

/**
 * Model/demo path: pick the love taste whose significant words overlap the plan text the most.
 * Deterministic; ties go to the earlier taste; null when nothing overlaps (the clause is omitted).
 */
export function pickTasteByOverlap(tastes: Pick<Taste, "id" | "text">[], planText: string): { id: string; text: string } | null {
  const haystack = plain(planText);
  let best: { id: string; text: string } | null = null;
  let bestScore = 0;
  for (const taste of tastes) {
    const score = significantTokens(taste.text).filter((token) => haystack.includes(token)).length;
    if (score > bestScore) {
      bestScore = score;
      best = { id: taste.id, text: taste.text };
    }
  }
  return best;
}

const MAX_NAMED_PEOPLE = 4;

function personLabel(participant: Participant): string {
  if (participant.isOwner) return "you";
  const relationship = participant.relationship?.trim();
  if (participant.kind === "person" && relationship && relationship.length <= 24) {
    return `your ${relationship.toLowerCase()}`;
  }
  return participant.name;
}

export interface ReasonInput {
  momentLabel: string;
  /** The group, owner first. Local household participants only. */
  participants: Participant[];
  romantic: boolean;
  /** Already filtered by the caller to the viewer's own and household-scoped tastes. */
  taste: { id: string; text: string } | null;
  weather: WeatherSnapshot | null;
}

export function buildReasonParts(input: ReasonInput): ReasonParts {
  const ordered = [...input.participants].sort((a, b) => Number(b.isOwner) - Number(a.isOwner));
  const shown = ordered.slice(0, MAX_NAMED_PEOPLE);
  const people = shown.map(personLabel);
  if (ordered.length > shown.length) people.push(`${ordered.length - shown.length} more`);
  const forecastKnown = Boolean(input.weather && !input.weather.unavailable && input.weather.summary.trim());
  return {
    moment: input.momentLabel,
    people,
    peopleIds: shown.map((participant) => participant.id),
    taste: input.taste ? { id: input.taste.id, text: input.taste.text } : null,
    weather: forecastKnown ? input.weather!.summary.trim() : null,
    romantic: input.romantic,
  };
}

function joinPeople(people: string[]): string {
  if (people.length <= 1) return people[0] ?? "";
  return `${people.slice(0, -1).join(", ")} and ${people[people.length - 1]}`;
}

/** Assembled by the server from the parts; never written freehand by a model. */
export function buildReasonLine(parts: ReasonParts): string {
  const lead = parts.romantic ? `${parts.moment}, a romantic evening` : parts.moment;
  const segments: string[] = [parts.people.length > 0 ? `${lead} for ${joinPeople(parts.people)}` : lead];
  if (parts.taste) segments.push(`fits “${parts.taste.text}”`);
  if (parts.weather) segments.push(parts.weather);
  return segments.join(" · ");
}
