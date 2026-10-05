import { addDays } from "../../shared/moment.js";
import type { TimeOffProposal } from "../../shared/momentTypes.js";

/**
 * Deterministic parser for plain time-off statements said to Buddy, for example
 * "I'm off Dec 24 to 31", "I have vacation from 24 December to 2 January",
 * "time off 2026-12-24 to 2026-12-31".
 *
 * Pure: it only recognises the sentence and resolves the dates (a date with no year means its next
 * occurrence on or after `today`). Saving is a separate confirm step in the chat route.
 */

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_WORD = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

interface PartialDate {
  year: number | null;
  month: number | null;
  day: number;
}

// "2026-12-24" | "Dec 24" | "December 24th, 2026" | "24 Dec" | "24th of December 2026" | bare "31"
const DATE_PATTERN =
  `(?:(\\d{4})-(\\d{2})-(\\d{2})` +
  `|(${MONTH_WORD})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?` +
  `|(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+(${MONTH_WORD})\\.?(?:,?\\s+(\\d{4}))?` +
  `|(\\d{1,2})(?:st|nd|rd|th)?)`;

const LEAD =
  "(?:(?:i|we)(?:['’]m|\\s+am|['’]re|\\s+are)\\s+(?:off|away|on\\s+(?:vacation|holiday|holidays|leave))" +
  "|(?:i|we)\\s+(?:have|got|will\\s+have|['’]ll\\s+have)\\s+(?:some\\s+|a\\s+)?(?:vacation|holidays?|time\\s+off|leave|days\\s+off)" +
  "|(?:vacation|holidays?|time\\s+off|leave|days\\s+off))";
const SEPARATOR = "\\s*(?:to|until|till|through|thru|[-–—]|and)\\s*";
const PREFIX = "(?:(?:ok|okay|so|btw|fyi|hey|hi|well|actually|just so you know|by the way)[,:]?\\s+)*(?:buddy[,:]?\\s+)?";
const PATTERN = new RegExp(
  `^\\s*${PREFIX}(${LEAD})\\s*(?:from|on|between|:)?\\s*${DATE_PATTERN}${SEPARATOR}${DATE_PATTERN}\\s*[.!]*\\s*$`,
  "iu"
);

function labelFor(lead: string): string {
  const text = lead.toLowerCase();
  if (text.includes("vacation")) return "Vacation";
  if (text.includes("holiday")) return "Holiday";
  if (text.includes("leave")) return "Leave";
  return "Time off";
}

function monthOf(word: string): number | null {
  return MONTH_NAMES[word.toLowerCase().replace(/\.$/, "")] ?? null;
}

function readDate(groups: (string | undefined)[], offset: number): PartialDate | null {
  const g = groups.slice(offset, offset + 10);
  const [isoY, isoM, isoD, monA, dayA, yearA, dayB, monB, yearB, bare] = g;
  if (isoY && isoM && isoD) return { year: Number(isoY), month: Number(isoM), day: Number(isoD) };
  if (monA && dayA) return { year: yearA ? Number(yearA) : null, month: monthOf(monA), day: Number(dayA) };
  if (dayB && monB) return { year: yearB ? Number(yearB) : null, month: monthOf(monB), day: Number(dayB) };
  if (bare) return { year: null, month: null, day: Number(bare) };
  return null;
}

function isRealDate(year: number, month: number, day: number): boolean {
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** The next occurrence of month/day on or after `today` (a year in the text wins). */
function resolveStart(date: PartialDate, today: string): string | null {
  if (date.month === null) return null; // the start of a range must name a month
  if (date.year !== null) return isRealDate(date.year, date.month, date.day) ? iso(date.year, date.month, date.day) : null;
  const thisYear = Number(today.slice(0, 4));
  for (const year of [thisYear, thisYear + 1]) {
    if (isRealDate(year, date.month, date.day) && iso(year, date.month, date.day) >= today) return iso(year, date.month, date.day);
  }
  return null;
}

function resolveEnd(date: PartialDate, start: string): string | null {
  const startYear = Number(start.slice(0, 4));
  const startMonth = Number(start.slice(5, 7));
  const startDay = Number(start.slice(8, 10));
  if (date.year !== null && date.month !== null) {
    return isRealDate(date.year, date.month, date.day) ? iso(date.year, date.month, date.day) : null;
  }
  if (date.month === null) {
    // "Dec 24 to 31": the same month, or the next one when the day is earlier.
    let year = startYear;
    let month = startMonth;
    if (date.day < startDay) {
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
    return isRealDate(year, month, date.day) ? iso(year, month, date.day) : null;
  }
  for (const year of [startYear, startYear + 1]) {
    if (isRealDate(year, date.month, date.day) && iso(year, date.month, date.day) >= start) return iso(year, date.month, date.day);
  }
  return null;
}

export function parseTimeOffIntent(text: string, today: string): TimeOffProposal | null {
  const input = text.trim();
  if (!input || input.length > 200 || input.endsWith("?")) return null;
  const match = PATTERN.exec(input);
  if (!match) return null;
  const groups = match.slice(1);
  const lead = groups[0] ?? "";
  const first = readDate(groups, 1);
  const second = readDate(groups, 11);
  if (!first || !second) return null;
  const startDate = resolveStart(first, today);
  if (!startDate) return null;
  const endDate = resolveEnd(second, startDate);
  if (!endDate || endDate < startDate) return null;
  // A range longer than a year is almost certainly a mis-parse.
  if (endDate > addDays(startDate, 366)) return null;
  return { label: labelFor(lead), startDate, endDate };
}
