import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { WeatherSnapshot } from "../api/types";
import { SCALE_RADIUS_KM } from "@shared/scale";
import {
  computeTimeWindow,
  describeTimeWindow,
  mealHintForWindow,
  TIME_WINDOW_KINDS,
  type TimeWindow,
  type TimeWindowKind,
} from "@shared/timeWindow";
import { CalendarRange, CloudSun, Clock, Sun } from "lucide-react";

export interface QuickPlanRequest {
  scale: TimeWindow["scale"];
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  radiusKm: number;
  moodContext: string;
}

interface Props {
  disabled: boolean;
  onPlan: (request: QuickPlanRequest) => void;
}

type Setting = "mixed" | "outdoors" | "indoors";

interface Outlook {
  weather: WeatherSnapshot | null;
  setting: Setting;
}

const ICONS: Record<TimeWindowKind, typeof Clock> = {
  today: Clock,
  weekend: Sun,
  week: CalendarRange,
};

/** How often the windows are recomputed, so "3h 45m left" does not go stale while the page sits open. */
const TICK_MS = 60_000;

function settingSentence(setting: Setting): string {
  if (setting === "outdoors") return "Setting: outdoors";
  if (setting === "indoors") return "Setting: indoors";
  return "Setting: mixed";
}

/**
 * The request PlanBuddy sends for a one-tap plan: the exact window, the meal it
 * can still anchor on, and what the forecast implies. Remembered constraints
 * and tastes are applied server-side, so they are deliberately absent here.
 */
export function buildQuickPlanRequest(timeWindow: TimeWindow, setting: Setting): QuickPlanRequest {
  const meal = mealHintForWindow(timeWindow);
  return {
    scale: timeWindow.scale,
    startDate: timeWindow.startDate,
    endDate: timeWindow.endDate,
    startTime: timeWindow.startTime,
    endTime: timeWindow.endTime,
    radiusKm: SCALE_RADIUS_KM[timeWindow.scale],
    moodContext: [
      describeTimeWindow(timeWindow),
      `Meal: ${meal}`,
      settingSentence(setting),
      "Walking: 45-75 minutes",
      "Budget: flexible",
      "Transport: flexible",
    ]
      .join(". ")
      .slice(0, 280),
  };
}

export default function TimeLeftPlans({ disabled, onPlan }: Props) {
  const [now, setNow] = useState(() => new Date());
  const [outlooks, setOutlooks] = useState<Record<TimeWindowKind, Outlook | undefined>>({
    today: undefined,
    weekend: undefined,
    week: undefined,
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const windows = useMemo(
    () => TIME_WINDOW_KINDS.map((kind) => computeTimeWindow(kind, now)),
    // `now` ticks every minute, but the derived windows only change on the
    // quarter hour — keying on the computed range keeps this cheap and stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), Math.floor(now.getMinutes() / 15)]
  );

  // One forecast lookup per distinct date range. The server caches Open-Meteo
  // for 30 minutes, so a returning user rarely pays for this at all.
  const rangeKey = windows.map((item) => `${item.startDate}:${item.endDate}`).join("|");
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      windows.map(async (item) => {
        if (!item.usable) return [item.kind, undefined] as const;
        try {
          const data = await api.get<Outlook>(
            `/weather/outlook?startDate=${item.startDate}&endDate=${item.endDate}`
          );
          return [item.kind, data] as const;
        } catch {
          // No forecast simply means the button plans without a weather nudge.
          return [item.kind, undefined] as const;
        }
      })
    ).then((entries) => {
      if (cancelled) return;
      setOutlooks(Object.fromEntries(entries) as Record<TimeWindowKind, Outlook | undefined>);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);

  return (
    <section className="card time-left" aria-label="Plan the time you have left">
      <div className="eyebrow">Time left</div>
      <h2>Plan what's actually left</h2>
      <p className="muted">
        One tap. PlanBuddy takes the hours you still have, the forecast for them, and what it remembers you love.
      </p>
      <div className="time-left__grid">
        {windows.map((item) => {
          const Icon = ICONS[item.kind];
          const outlook = outlooks[item.kind];
          const weather = outlook?.weather;
          return (
            <button
              key={item.kind}
              type="button"
              className="time-left__button"
              disabled={disabled || !item.usable}
              onClick={() => onPlan(buildQuickPlanRequest(item, outlook?.setting ?? "mixed"))}
            >
              <span className="time-left__head">
                <Icon size={16} aria-hidden />
                <strong>{item.label}</strong>
              </span>
              <span className="time-left__detail">{item.detail}</span>
              {item.usable && weather && !weather.unavailable && (
                <span className="time-left__weather">
                  <CloudSun size={13} aria-hidden /> {weather.summary}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {disabled && <p className="muted">Pick at least one person below first.</p>}
    </section>
  );
}
