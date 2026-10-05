import { weekdayName, type MomentTimes } from "../../shared/moment.js";
import type { MomentInfo, StoredMomentTimes } from "../../shared/momentTypes.js";

/** The request text for a moment spec. Stays under the 280-character mood limit. */
export function buildMomentMood(moment: MomentInfo, times: MomentTimes, romantic: boolean): string {
  let text: string;
  if (moment.kind === "weekend") {
    text = `Moment: this weekend, a ${weekdayName(moment.planDate)} plan.`;
  } else if (moment.kind === "tonight") {
    text = times.mealFirst
      ? `Meal: dinner. Tonight: dinner first at ${times.mealStart}, then two more stops.`
      : `Meal: dinner. Tonight: start ${times.startTime}, dinner around ${times.mealStart}.`;
    if (romantic) text += " Romantic evening for two.";
  } else {
    text = times.mealFirst
      ? `Meal: lunch. A day out: lunch first at ${times.mealStart}, then two more stops.`
      : `Meal: lunch. A day out: start ${times.startTime}, lunch around ${times.mealStart}.`;
  }
  return text.slice(0, 280);
}

export function toStoredTimes(times: MomentTimes, romantic: boolean): StoredMomentTimes {
  return {
    startTime: times.startTime,
    mealFirst: times.mealFirst,
    mealStart: times.mealStart,
    mealWindow: times.mealWindow,
    lateMealFirst: times.lateMealFirst,
    firstStopMinutes: times.firstStopMinutes,
    romantic,
  };
}
