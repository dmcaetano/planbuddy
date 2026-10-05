import { clockToMinutes, minutesToClock, parseLocalDateTime, type MomentTimes } from "../../shared/moment.js";
import type { MomentKind } from "../../shared/momentTypes.js";
import type { Beat } from "../../shared/types.js";
import { findMealBeatIndex } from "../plans/engine/pipeline.js";

function ceil5(minutes: number): number {
  return Math.ceil(minutes / 5) * 5;
}

/** Spec rule 6: the plan is dated today and its first beat has already started. */
export function firstBeatStarted(beats: Beat[], planDate: string, localIso: string): boolean {
  const parsed = parseLocalDateTime(localIso);
  if (!parsed || parsed.date !== planDate) return false;
  const first = clockToMinutes(beats[0]?.startTime ?? null);
  return first !== null && first < parsed.minutesOfDay;
}

/** Spec rule 8: has the plan's last beat ended on the device's today? Unknown timing counts as not ended. */
export function lastBeatEnded(beats: Beat[], localIso: string): boolean {
  const parsed = parseLocalDateTime(localIso);
  if (!parsed) return false;
  const last = beats[beats.length - 1];
  const start = clockToMinutes(last?.startTime ?? null);
  if (start === null) return false;
  return start + (last.durationMinutes ?? 0) <= parsed.minutesOfDay;
}

export interface RetimeResult {
  beats: Beat[];
  /** The meal moved to the first slot because it is now too late for a pre-meal stop. */
  reordered: boolean;
}

/**
 * Deterministic in-place retiming (spec rule 6): every venue is kept, only the clock times move.
 * Returns null when the meal-start window can no longer be met, in which case the caller generates
 * a new proposal. The window is the one in rule 4 (tonight 19:00-21:00, day 12:00-15:00).
 */
export function retimeBeatsForMoment(beats: Beat[], kind: MomentKind, times: MomentTimes, allowNoMeal = false): RetimeResult | null {
  if (kind === "weekend" || !times.startTime || !times.mealStart) return null;
  if (beats.length < 2) return null;
  const start = clockToMinutes(times.startTime);
  const mealStart = clockToMinutes(times.mealStart);
  if (start === null || mealStart === null) return null;
  const windowEnd = kind === "tonight" ? 21 * 60 : 15 * 60;
  if (mealStart > windowEnd) return null;
  const mealIndex = findMealBeatIndex(beats);
  const strip = (beat: Beat): Beat => ({ ...beat, directionsUrl: null });
  // A draft with no identifiable meal stop (only the demo content pool produces these) still has to
  // fit the moment: keep every venue and run the stops one after another from the start time.
  if (mealIndex < 0 && allowNoMeal) return { beats: timeSequentially(beats.map(strip), start), reordered: false };

  if (times.mealFirst) {
    if (mealIndex === 0) {
      const timed = timeSequentially(beats.map((beat) => ({ ...beat })), mealStart);
      return { beats: timed, reordered: false };
    }
    if (mealIndex === 1 && beats.length === 3) {
      // Late: meal first, then the stop that already followed it, then the stop that came before it.
      const meal: Beat = { ...strip(beats[1]), travelMode: null, travelMinutes: null, distanceFromPreviousKm: null };
      const after = strip(beats[2]);
      const before: Beat = { ...strip(beats[0]), travelMode: null, travelMinutes: null, distanceFromPreviousKm: null };
      return { beats: timeSequentially([meal, after, before], mealStart), reordered: true };
    }
    return null;
  }

  if (mealIndex !== 1 || beats.length !== 3) return null;
  const [pre, meal, post] = beats;
  const preDuration = Math.max(5, Math.min(1440, mealStart - start));
  const postStart = ceil5(mealStart + (meal.durationMinutes ?? 90) + (post.travelMinutes ?? 0));
  return {
    beats: [
      { ...pre, startTime: minutesToClock(start), durationMinutes: preDuration },
      { ...meal, startTime: minutesToClock(mealStart) },
      { ...post, startTime: minutesToClock(postStart) },
    ],
    reordered: false,
  };
}

function timeSequentially(beats: Beat[], firstStart: number): Beat[] {
  let cursor = firstStart;
  return beats.map((beat, index) => {
    if (index > 0) {
      const previous = beats[index - 1];
      cursor = ceil5(cursor + (previous.durationMinutes ?? 30) + (beat.travelMinutes ?? 10));
    }
    return { ...beat, startTime: minutesToClock(cursor) };
  });
}
