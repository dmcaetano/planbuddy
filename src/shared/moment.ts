import type { MomentInfo, MomentKind } from "./momentTypes.js";

/**
 * Pure moment engine (sdlc/001-max-one-click/spec.md rules 2, 4, 12, 13).
 * Everything here is derived from the device's local wall-clock string. The
 * weekday is computed from the date text itself with UTC arithmetic, so the
 * server's or the test runner's time zone can never change a result.
 */

export const MOMENT_MIN_YEAR = 2020;
export const MOMENT_MAX_YEAR = 2100;

export interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** YYYY-MM-DD */
  date: string;
  /** hour * 60 + minute */
  minutesOfDay: number;
  /** 1 = Monday ... 7 = Sunday */
  weekday: number;
}

const LOCAL_ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Strict "YYYY-MM-DDTHH:mm[:ss]" (no zone). Returns null for anything else. */
export function parseLocalDateTime(input: unknown): LocalDateTime | null {
  if (typeof input !== "string") return null;
  const match = LOCAL_ISO.exec(input);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  if (year < MOMENT_MIN_YEAR || year > MOMENT_MAX_YEAR) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  const dow = utc.getUTCDay();
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    date: `${year}-${pad2(month)}-${pad2(day)}`,
    minutesOfDay: hour * 60 + minute,
    weekday: dow === 0 ? 7 : dow,
  };
}

export function isValidLocalDateTime(input: unknown): input is string {
  return parseLocalDateTime(input) !== null;
}

/** Adds whole days to a YYYY-MM-DD string (UTC arithmetic, DST-proof). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

/** 1 = Monday ... 7 = Sunday, from the date text alone. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function weekdayName(date: string): string {
  return WEEKDAY_NAMES[weekdayOf(date) - 1];
}

export function momentKey(kind: MomentKind, planDate: string): string {
  return `${kind}:${planDate}`;
}

export function momentLabel(kind: MomentKind, planDate: string): string {
  if (kind === "tonight") return `${weekdayName(planDate)} evening`;
  if (kind === "day") return weekdayName(planDate);
  return "This weekend";
}

export function momentInfoFor(kind: MomentKind, planDate: string): MomentInfo {
  return { kind, planDate, key: momentKey(kind, planDate), label: momentLabel(kind, planDate) };
}

/* ---------------------------------------------------------------------- */
/* Rule 2: the table. Every minute of the week matches exactly one row.     */
/* ---------------------------------------------------------------------- */

export type MomentDateRule = "today" | "tomorrow" | "saturday";

export interface MomentRow {
  id: number;
  /** 1 = Monday ... 7 = Sunday */
  days: readonly number[];
  fromMinute: number;
  toMinute: number;
  kind: MomentKind;
  date: MomentDateRule;
}

const END_OF_DAY = 24 * 60 - 1;

export const MOMENT_ROWS: readonly MomentRow[] = [
  { id: 1, days: [1, 2, 3, 4], fromMinute: 0, toMinute: END_OF_DAY, kind: "weekend", date: "saturday" },
  { id: 2, days: [5], fromMinute: 0, toMinute: 12 * 60 + 59, kind: "weekend", date: "saturday" },
  { id: 3, days: [5, 6, 7], fromMinute: 13 * 60, toMinute: 20 * 60 + 59, kind: "tonight", date: "today" },
  { id: 4, days: [5], fromMinute: 21 * 60, toMinute: END_OF_DAY, kind: "day", date: "tomorrow" },
  { id: 5, days: [6], fromMinute: 0, toMinute: 12 * 60 + 59, kind: "day", date: "today" },
  { id: 6, days: [6], fromMinute: 21 * 60, toMinute: END_OF_DAY, kind: "day", date: "tomorrow" },
  { id: 7, days: [7], fromMinute: 0, toMinute: 12 * 60 + 59, kind: "day", date: "today" },
  { id: 8, days: [7], fromMinute: 21 * 60, toMinute: END_OF_DAY, kind: "weekend", date: "saturday" },
];

function daysUntilSaturday(weekday: number): number {
  return (6 - weekday + 7) % 7;
}

function applyDateRule(parsed: LocalDateTime, rule: MomentDateRule): string {
  if (rule === "today") return parsed.date;
  if (rule === "tomorrow") return addDays(parsed.date, 1);
  return addDays(parsed.date, daysUntilSaturday(parsed.weekday));
}

/** The rows that match a device time (always exactly one for valid input). */
export function matchingMomentRows(localIso: string): MomentRow[] {
  const parsed = parseLocalDateTime(localIso);
  if (!parsed) return [];
  return MOMENT_ROWS.filter(
    (row) => row.days.includes(parsed.weekday) && parsed.minutesOfDay >= row.fromMinute && parsed.minutesOfDay <= row.toMinute
  );
}

/** Resolves the moment for a device-local date-time. Throws on garbage input. */
export function resolveMoment(localIso: string): MomentInfo {
  const parsed = parseLocalDateTime(localIso);
  if (!parsed) throw new Error("Invalid local date-time");
  const rows = matchingMomentRows(localIso);
  if (rows.length !== 1) throw new Error("Moment table does not cover this time exactly once");
  const row = rows[0];
  return momentInfoFor(row.kind, applyDateRule(parsed, row.date));
}

/**
 * Rule 13: the date each scope option uses from this device time.
 * Tonight: today before 21:00, tomorrow otherwise. A day out: today before
 * 13:00, tomorrow otherwise. This weekend: the coming Saturday (today when it
 * is Saturday before 21:00).
 */
export function scopeSwitchMoments(localIso: string): Record<MomentKind, MomentInfo> {
  const parsed = parseLocalDateTime(localIso);
  if (!parsed) throw new Error("Invalid local date-time");
  const tonightDate = parsed.minutesOfDay < 21 * 60 ? parsed.date : addDays(parsed.date, 1);
  const dayDate = parsed.minutesOfDay < 13 * 60 ? parsed.date : addDays(parsed.date, 1);
  const untilSaturday = parsed.weekday === 6 && parsed.minutesOfDay >= 21 * 60 ? 7 : daysUntilSaturday(parsed.weekday);
  const weekendDate = addDays(parsed.date, untilSaturday);
  return {
    tonight: momentInfoFor("tonight", tonightDate),
    day: momentInfoFor("day", dayDate),
    weekend: momentInfoFor("weekend", weekendDate),
  };
}

/* ---------------------------------------------------------------------- */
/* Rule 4: timing.                                                          */
/* ---------------------------------------------------------------------- */

export function clockToMinutes(value: string | null | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function minutesToClock(total: number): string {
  const wrapped = ((Math.round(total) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(wrapped / 60))}:${pad2(wrapped % 60)}`;
}

function ceilTo(value: number, step: number): number {
  return Math.ceil(value / step - 1e-9) * step;
}

export interface MomentTimes {
  /** First beat start "HH:MM", null for weekend (existing Saturday timing). */
  startTime: string | null;
  /** True when the meal is the first beat. */
  mealFirst: boolean;
  /** Meal start "HH:MM", null for weekend. */
  mealStart: string | null;
  /** The window the meal must start inside when it is the second beat. */
  mealWindow: { from: string; to: string } | null;
  /** A meal-first plan that starts late: carries an extra "check opening hours" note. */
  lateMealFirst: boolean;
  /** Minimum length of the first stop when the meal is second. */
  firstStopMinutes: number;
}

export const FIRST_STOP_MIN_MINUTES = 35;
const TONIGHT_FLOOR = 16 * 60 + 30;
const DAY_FLOOR = 10 * 60;
const TONIGHT_WINDOW = { from: 19 * 60, to: 21 * 60 };
const DAY_WINDOW = { from: 12 * 60, to: 15 * 60 };
const LATEST_MEAL_START = 22 * 60;

/**
 * Rule 4. `planDate` is the moment's plan date; a plan dated after the device's
 * today uses the fixed starts (16:30 / 10:00). `localIso` is the device time.
 */
export function momentTimes(kind: MomentKind, planDate: string, localIso: string): MomentTimes {
  const parsed = parseLocalDateTime(localIso);
  if (!parsed) throw new Error("Invalid local date-time");
  if (kind === "weekend") {
    return { startTime: null, mealFirst: false, mealStart: null, mealWindow: null, lateMealFirst: false, firstStopMinutes: FIRST_STOP_MIN_MINUTES };
  }
  const sameDay = planDate <= parsed.date;
  const nowMinutes = parsed.minutesOfDay + parsed.second / 60;
  const floor = kind === "tonight" ? TONIGHT_FLOOR : DAY_FLOOR;
  const window = kind === "tonight" ? TONIGHT_WINDOW : DAY_WINDOW;
  let start: number;
  if (!sameDay) start = floor;
  else if (kind === "tonight") start = Math.max(ceilTo(nowMinutes + 30, 15), floor);
  else start = Math.max(ceilTo(nowMinutes + 60, 60), floor);

  const mealFirst = start >= window.from;
  if (mealFirst) {
    const mealStart = kind === "tonight" ? Math.min(start, LATEST_MEAL_START) : start;
    const lateThreshold = kind === "tonight" ? 21 * 60 : 14 * 60;
    return {
      startTime: minutesToClock(mealStart),
      mealFirst: true,
      mealStart: minutesToClock(mealStart),
      mealWindow: null,
      lateMealFirst: mealStart >= lateThreshold,
      firstStopMinutes: FIRST_STOP_MIN_MINUTES,
    };
  }
  const mealStart = Math.max(window.from, ceilTo(start + FIRST_STOP_MIN_MINUTES, 15));
  return {
    startTime: minutesToClock(start),
    mealFirst: false,
    mealStart: minutesToClock(mealStart),
    mealWindow: { from: minutesToClock(window.from), to: minutesToClock(window.to) },
    lateMealFirst: false,
    firstStopMinutes: mealStart - start,
  };
}

/* ---------------------------------------------------------------------- */
/* Rule 12: partner words.                                                  */
/* ---------------------------------------------------------------------- */

export const PARTNER_WORDS: readonly string[] = [
  "wife", "husband", "partner", "spouse", "girlfriend", "boyfriend", "fiancé", "fiancée",
  "esposa", "marido", "mulher", "namorada", "namorado", "noiva", "noivo", "companheira", "companheiro",
];

function plain(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

const PARTNER_SET = new Set(PARTNER_WORDS.map(plain));

export function isPartnerWord(relationship: string | null | undefined): boolean {
  if (!relationship) return false;
  return PARTNER_SET.has(plain(relationship));
}
