import type { Id } from "./types.js";

/** The three kinds of "now" the Home screen can answer. See sdlc/001-max-one-click/spec.md rule 2. */
export type MomentKind = "tonight" | "day" | "weekend";

export interface MomentInfo {
  kind: MomentKind;
  /** YYYY-MM-DD, derived from the device's local date-time (never the server clock). */
  planDate: string;
  /** `${kind}:${planDate}`, e.g. `tonight:2026-10-09`. */
  key: string;
  /** Human label, e.g. "Friday evening", "Saturday", "This weekend". */
  label: string;
}

/** Everything a proposal's reason line is built from. Each part must be traceable to stored data. */
export interface ReasonParts {
  moment: string;
  /** Display names or relationship words, e.g. ["you", "your wife"]. */
  people: string[];
  /** One taste/hunch quoted exactly as stored, owned by the viewer or the household (never a friend). */
  taste: { id: Id; text: string } | null;
  /** One clause from a stored forecast for the plan date, or null. */
  weather: string | null;
  romantic: boolean;
  /** Added by workstream A: the participant ids behind `people` (each exists in the viewer's household). */
  peopleIds?: Id[];
}

/**
 * Timing the moment engine computed when a proposal was created (stored on the spec so
 * "Show another" under the same setup keeps the same timing). Added by workstream A.
 */
export interface StoredMomentTimes {
  startTime: string | null;
  mealFirst: boolean;
  mealStart: string | null;
  mealWindow: { from: string; to: string } | null;
  lateMealFirst: boolean;
  firstStopMinutes: number;
  romantic: boolean;
}

/** Body of POST /api/moment. `kind` (added by workstream A) is the scope-switch override of spec rule 13. */
export interface MomentRequest {
  localDateTime: string;
  kind?: MomentKind;
}

export interface TimeOff {
  id: Id;
  label: string;
  startDate: string;
  endDate: string;
  /** YYYY-MM-DD the nudge is hidden until, or null. */
  snoozedUntil: string | null;
}

export interface TripIdea {
  name: string;
  reason: string;
  /** "getaway" = local option, "vacation" = farther option. */
  scope: "getaway" | "vacation";
}

export interface TripNudge {
  timeOff: TimeOff;
  /** Built from stored facts only (dates + one stored taste quoted as stored). */
  line: string;
  /** At most one local and one farther idea. Labelled as ideas in the UI, never facts. */
  ideas: TripIdea[];
}

export type MomentStatus = "ready" | "locked" | "generating" | "empty_household";

/**
 * POST /api/moment  body: { localDateTime: "YYYY-MM-DDTHH:mm[:ss]" }  (device-local wall clock, no zone)
 * Opening the app only ever reuses or enqueues; it never exceeds the 20-generations-per-setup ceiling.
 */
export interface MomentResponse {
  moment: MomentInfo;
  status: MomentStatus;
  reasonLine: string | null;
  reasonParts: ReasonParts | null;
  /** True when the romantic framing applies (kind tonight + owner + one partner-word household person). */
  romantic: boolean;
  /**
   * status "ready": the PipelineResponse shape already used by the client (spec, winner, alternates: [],
   * generationsUsed, generationsRemaining ...). status "locked": the locked plan's candidate in the same shape.
   * Otherwise null.
   */
  plan: unknown | null;
  lockedPlanId: Id | null;
  /** status "generating": a normal generation job; the client tracks it and calls POST /api/moment again. */
  jobId: string | null;
  nudge: TripNudge | null;
  /** Which card leads (spec rule 22). */
  lead: "moment" | "nudge";
}

/** A Buddy-proposed time-off entry, saved only by the confirm endpoint (POST /api/chat/confirm-time-off). */
export interface TimeOffProposal {
  label: string;
  startDate: string;
  endDate: string;
}
