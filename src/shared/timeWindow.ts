import type { Scale } from "./scale.js";

/**
 * "Plan whatever time I have left" windows.
 *
 * Every helper here is pure and takes `now` explicitly so the client, the
 * server, and the tests all compute the same window for the same instant.
 * Dates are local calendar dates (the user plans in their own timezone);
 * clock values are local "HH:MM" strings, matching Beat.startTime.
 */

export const TIME_WINDOW_KINDS = ["today", "weekend", "week"] as const;
export type TimeWindowKind = (typeof TIME_WINDOW_KINDS)[number];

/** Earliest a day that has not started yet is planned from. */
export const DAY_START_MINUTES = 9 * 60;
/** Last useful moment of a day — later than this and there is nothing left to plan. */
export const DAY_END_MINUTES = 22 * 60 + 30;
/** Deciding, getting ready, and setting off all happen before the first stop. */
export const LEAD_MINUTES = 45;
/** Below this, a three-stop itinerary stops being an honest promise. */
export const MIN_USABLE_MINUTES = 150;

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface TimeWindow {
  kind: TimeWindowKind;
  /** Scale the window plans at — a single leftover day is a day off, a multi-day window is a weekend. */
  scale: Scale;
  startDate: string;
  endDate: string;
  /** Local "HH:MM" the first stop can realistically begin at, on `startDate`. */
  startTime: string;
  /** Local "HH:MM" everything must be wrapped up by, on `endDate`. */
  endTime: string;
  /** Usable minutes across the whole window, counting only DAY_START..DAY_END on each day. */
  minutesLeft: number;
  /** True when the window opens on a later date — "this weekend" rather than "what's left of it". */
  startsLater: boolean;
  /** False when too little time remains to promise a real three-stop plan. */
  usable: boolean;
  label: string;
  detail: string;
}

export function parseClock(value: string | null | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatClock(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(totalMinutes)));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

function dayCount(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 1;
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

export function describeDuration(minutes: number): string {
  if (minutes <= 0) return "0m";
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/** Rounds up to the next quarter hour so a suggested start reads like a plan, not a stopwatch. */
function earliestStartMinutes(now: Date): number {
  const raw = now.getHours() * 60 + now.getMinutes() + LEAD_MINUTES;
  return Math.max(DAY_START_MINUTES, Math.ceil(raw / 15) * 15);
}

/** Saturday of the weekend the user is currently in, or the one coming up. */
function weekendStart(now: Date): Date {
  const day = now.getDay();
  if (day === 6 || day === 0) return addDays(now, day === 0 ? -1 : 0);
  // Friday evening already reads as the weekend to most people.
  if (day === 5 && now.getHours() * 60 + now.getMinutes() >= 17 * 60) return addDays(now, 0);
  return addDays(now, (6 - day + 7) % 7);
}

function usableMinutes(startDate: string, startMinutes: number, endDate: string, endMinutes: number): number {
  const days = dayCount(startDate, endDate);
  if (days <= 1) return Math.max(0, endMinutes - startMinutes);
  const fullDayMinutes = DAY_END_MINUTES - DAY_START_MINUTES;
  return Math.max(
    0,
    DAY_END_MINUTES - startMinutes + (days - 2) * fullDayMinutes + (endMinutes - DAY_START_MINUTES)
  );
}

function dateRangeLabel(startDate: string, endDate: string): string {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const startLabel = WEEKDAY_LABELS[start.getDay()] ?? startDate;
  const endLabel = WEEKDAY_LABELS[end.getDay()] ?? endDate;
  return startDate === endDate ? startLabel : `${startLabel}–${endLabel}`;
}

/**
 * Computes the usable slice of time a one-tap plan should cover. Windows that
 * begin today start from "now plus enough lead time to leave the house"; a
 * window whose first day has already run out rolls onto its next day.
 *
 * A weekend or week with nothing usable left rolls forward to the next one —
 * late on a Sunday, "the weekend" means the one coming up. "Rest of today" has
 * no such reading, so a spent day stays honestly unplannable.
 */
export function computeTimeWindow(kind: TimeWindowKind, now: Date): TimeWindow {
  const window = buildTimeWindow(kind, now);
  if (window.usable || kind === "today") return window;

  const tomorrow = addDays(now, 1);
  const next = buildTimeWindow(kind, tomorrow);
  const startMinutes = parseClock(next.startTime) ?? DAY_START_MINUTES;
  const endMinutes = parseClock(next.endTime) ?? DAY_END_MINUTES;
  return {
    ...next,
    startsLater: true,
    label: kind === "weekend" ? "Next weekend" : "Next week",
    detail: windowDetail(next.startDate, next.endDate, startMinutes, endMinutes, next.minutesLeft, next.usable, true),
  };
}

function buildTimeWindow(kind: TimeWindowKind, now: Date): TimeWindow {
  const today = addDays(now, 0);
  const todayKey = toDateKey(today);

  let startDay = today;
  let endDay = today;
  if (kind === "weekend") {
    startDay = weekendStart(now);
    endDay = addDays(startDay, 1);
  } else if (kind === "week") {
    // The rest of the week runs through Sunday; on a Sunday only today is left.
    const day = now.getDay();
    endDay = day === 0 ? today : addDays(today, 7 - day);
  }

  // A weekend already underway opens today, not on the Saturday that is gone.
  let startDate = toDateKey(startDay) < todayKey ? todayKey : toDateKey(startDay);
  const endDate = toDateKey(endDay);
  let startMinutes = startDate === todayKey ? earliestStartMinutes(now) : DAY_START_MINUTES;

  // Today is spent but the window still has a tomorrow — open it there instead.
  if (startMinutes >= DAY_END_MINUTES && startDate < endDate) {
    startDate = toDateKey(addDays(new Date(`${startDate}T00:00:00`), 1));
    startMinutes = DAY_START_MINUTES;
  }
  startMinutes = Math.min(startMinutes, DAY_END_MINUTES);
  const endMinutes = DAY_END_MINUTES;

  const minutesLeft = usableMinutes(startDate, startMinutes, endDate, endMinutes);
  const startsLater = startDate !== todayKey;
  const scale: Scale = startDate === endDate ? "day_off" : "weekend";
  const usable = minutesLeft >= MIN_USABLE_MINUTES;

  return {
    kind,
    scale,
    startDate,
    endDate,
    startTime: formatClock(startMinutes),
    endTime: formatClock(endMinutes),
    minutesLeft,
    startsLater,
    usable,
    label: windowLabel(kind, startsLater),
    detail: windowDetail(startDate, endDate, startMinutes, endMinutes, minutesLeft, usable, startsLater),
  };
}

function windowLabel(kind: TimeWindowKind, startsLater: boolean): string {
  if (kind === "today") return "Rest of today";
  if (kind === "weekend") return startsLater ? "This weekend" : "Rest of the weekend";
  return "Rest of the week";
}

function windowDetail(
  startDate: string,
  endDate: string,
  startMinutes: number,
  endMinutes: number,
  minutesLeft: number,
  usable: boolean,
  startsLater: boolean
): string {
  if (!usable) {
    return minutesLeft <= 0 ? "Nothing left to plan" : `Only ${describeDuration(minutesLeft)} left`;
  }
  const span =
    startDate === endDate
      ? `${formatClock(startMinutes)}–${formatClock(endMinutes)}`
      : `${dateRangeLabel(startDate, endDate)}${startsLater ? "" : ` from ${formatClock(startMinutes)}`}`;
  return `${describeDuration(minutesLeft)} · ${span}`;
}

export type MealHint = "lunch" | "dinner" | "flexible";

/** Which meal the window can actually anchor on, from when it opens. */
export function mealHintForWindow(window: TimeWindow): MealHint {
  const startMinutes = parseClock(window.startTime) ?? DAY_START_MINUTES;
  const firstDayEnd = window.startDate === window.endDate ? parseClock(window.endTime) ?? DAY_END_MINUTES : DAY_END_MINUTES;
  if (startMinutes >= 16 * 60 && firstDayEnd >= 19 * 60) return "dinner";
  if (startMinutes >= 10 * 60 + 30 && startMinutes <= 13 * 60 + 30) return "lunch";
  return "flexible";
}

/**
 * The compact sentence the window contributes to a spec's mood context. The
 * exact window also travels as first-class spec fields; this keeps it legible
 * in the AI prompt and in anything that reads the request back to the user.
 */
export function describeTimeWindow(window: TimeWindow): string {
  return window.startDate === window.endDate
    ? `Time left: ${describeDuration(window.minutesLeft)} between ${window.startTime} and ${window.endTime} today`
    : `Time left: ${describeDuration(window.minutesLeft)} from ${window.startTime} on ${window.startDate} to ${window.endTime} on ${window.endDate}`;
}
