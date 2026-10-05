import type { Scale } from "@shared/scale";
import type { MomentKind, MomentInfo } from "@shared/momentTypes";
import { resolveMoment, scopeSwitchMoments, weekdayName } from "@shared/moment";

const pad = (value: number) => String(value).padStart(2, "0");

/** YYYY-MM-DD in the browser's local zone (never toISOString, which is UTC). */
export function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** YYYY-MM-DDTHH:mm:ss, the device's local wall clock with no zone — what POST /api/moment expects. */
export function formatLocalDateTime(date: Date): string {
  return `${formatLocalDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** The moment for the browser's clock right now (same table the server uses, spec rule 2). */
export function currentMoment(now: Date = new Date()): MomentInfo {
  return resolveMoment(formatLocalDateTime(now));
}

/** The date each scope-switch option uses from this device time (spec rule 13). */
export function scopeSwitchDates(now: Date = new Date()): Record<MomentKind, string> {
  const moments = scopeSwitchMoments(formatLocalDateTime(now));
  return { tonight: moments.tonight.planDate, day: moments.day.planDate, weekend: moments.weekend.planDate };
}

/** "Finding your Friday dinner…" — loading text built from a resolved moment. */
export function momentLoadingText(moment: Pick<MomentInfo, "kind" | "planDate">): string {
  const weekday = weekdayName(moment.planDate);
  if (moment.kind === "tonight") return `Finding your ${weekday} dinner…`;
  if (moment.kind === "day") return `Finding your ${weekday} day out…`;
  return "Finding your weekend plan…";
}

/** Router state passed from Home to the Customize page (/plan/custom). */
export interface CustomizeState {
  /** Participant ids of the household group. */
  group?: string[];
  kind?: MomentKind;
  planDate?: string;
  scale?: Scale;
}
