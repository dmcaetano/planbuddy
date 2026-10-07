export const SCALES = ["day_off", "weekend", "getaway", "vacation"] as const;
export type Scale = (typeof SCALES)[number];

export const SCALE_LABELS: Record<Scale, string> = {
  day_off: "Day off",
  weekend: "Weekend",
  getaway: "Getaway",
  vacation: "Vacation",
};

export const SCALE_RADIUS_KM: Record<Scale, number> = {
  day_off: 25,
  weekend: 60,
  getaway: 250,
  vacation: 1500, // destination-scale; not a hard travel-distance filter
};

/** Trips also require a destination anchor. */
export function isTripScale(scale: Scale): boolean {
  return scale === "getaway" || scale === "vacation";
}

/** Plans are not fixed at three stops: a day off or a weekend holds more. */
export function beatCountForScale(scale: Scale): number {
  if (scale === "weekend") return 7;
  if (scale === "day_off") return 5;
  return 3;
}

/** The user's own "how far from home" for a scale, else the app default. Only day and weekend are user-set. */
export function radiusForScale(
  scale: Scale,
  prefs: { travelDayKm?: number | null; travelWeekendKm?: number | null } | null | undefined
): number {
  if (scale === "day_off" && prefs?.travelDayKm) return prefs.travelDayKm;
  if (scale === "weekend" && prefs?.travelWeekendKm) return prefs.travelWeekendKm;
  return SCALE_RADIUS_KM[scale];
}
