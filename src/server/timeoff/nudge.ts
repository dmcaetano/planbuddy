import type { TimeOff, TripNudge } from "../../shared/momentTypes.js";
import { addDays } from "../../shared/moment.js";
import type { Taste } from "../../shared/types.js";

/** A range starting further out than this is not nudged yet (spec rule 18). */
export const NUDGE_HORIZON_DAYS = 183;

export interface DateRange {
  startDate: string;
  endDate: string;
}

function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.startDate <= b.endDate && a.endDate >= b.startDate;
}

/**
 * The range a trip nudge is about (spec rules 18, 23): the earliest range that ends on or after the
 * device-local date, starts within 183 days, is not snoozed (snoozed_until before the local date), and
 * overlaps no locked Getaway/Vacation plan. Locked dinner, day and weekend plans are not passed in.
 */
export function selectNudgeRange(timeOff: TimeOff[], localDate: string, lockedTrips: DateRange[]): TimeOff | null {
  const horizon = addDays(localDate, NUDGE_HORIZON_DAYS);
  const candidates = timeOff
    .filter((range) => range.endDate >= localDate)
    .filter((range) => range.startDate <= horizon)
    .filter((range) => !range.snoozedUntil || range.snoozedUntil < localDate)
    .filter((range) => !lockedTrips.some((trip) => rangesOverlap(range, trip)))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
  return candidates[0] ?? null;
}

/* ---------------------------------------------------------------------- */
/* Season guard (spec rule 21)                                             */
/* ---------------------------------------------------------------------- */

const WINTER_WORDS = /\b(snow|snowy|ski|skiing|snowboard|snowboarding|winter)\b/;
const SUMMER_WORDS = /\b(beach|beaches|swim|swimming|sea|seaside)\b/;

function plain(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** The calendar months (1-12) any day of the range falls in. */
export function monthsTouched(startDate: string, endDate: string): Set<number> {
  const months = new Set<number>();
  let day = startDate;
  for (let i = 0; i < 400 && day <= endDate; i++) {
    months.add(Number(day.slice(5, 7)));
    day = addDays(day, 1);
  }
  return months;
}

/**
 * A season-bound taste is cited only when the dates fit its season (northern hemisphere):
 * snow/ski/winter need a range touching December to March; beach/swim/sea need June to September.
 * Every other taste is always citable.
 */
export function tasteFitsRange(text: string, startDate: string, endDate: string): boolean {
  const lower = plain(text);
  const winter = WINTER_WORDS.test(lower);
  const summer = SUMMER_WORDS.test(lower);
  if (!winter && !summer) return true;
  const months = monthsTouched(startDate, endDate);
  const winterOk = [12, 1, 2, 3].some((m) => months.has(m));
  const summerOk = [6, 7, 8, 9].some((m) => months.has(m));
  return (winter && winterOk) || (summer && summerOk);
}

/** Love tastes that may be cited for this range, strongest first (ties keep the stored order). */
export function citableLoveTastes(tastes: Pick<Taste, "id" | "text" | "polarity" | "weight">[], range: DateRange) {
  return tastes
    .filter((taste) => taste.polarity === "love")
    .filter((taste) => tasteFitsRange(taste.text, range.startDate, range.endDate))
    .map((taste, index) => ({ taste, index }))
    .sort((a, b) => b.taste.weight - a.taste.weight || a.index - b.index)
    .map((entry) => ({ id: entry.taste.id, text: entry.taste.text }));
}

/* ---------------------------------------------------------------------- */
/* The line (built from stored facts only)                                 */
/* ---------------------------------------------------------------------- */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDay(date: string, withYear: boolean): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}${withYear ? `, ${y}` : ""}`;
}

export function formatRange(startDate: string, endDate: string, localDate: string): string {
  const year = localDate.slice(0, 4);
  const withYear = startDate.slice(0, 4) !== year || endDate.slice(0, 4) !== year;
  if (startDate === endDate) return formatDay(startDate, withYear);
  return `${formatDay(startDate, withYear)} to ${formatDay(endDate, withYear)}`;
}

/** "Christmas: Dec 24 to Dec 31 · fits “loves snow”" — the label and dates as stored, one taste as stored. */
export function buildNudgeLine(range: TimeOff, taste: { text: string } | null, localDate: string): string {
  const base = `${range.label}: ${formatRange(range.startDate, range.endDate, localDate)}`;
  return taste ? `${base} · fits “${taste.text}”` : base;
}

export function composeNudge(range: TimeOff, taste: { text: string } | null, localDate: string, ideas: TripNudge["ideas"]): TripNudge {
  return { timeOff: range, line: buildNudgeLine(range, taste, localDate), ideas };
}
