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

/** Every plan is a usable three-stop itinerary; trips also require a destination anchor. */
export function isTripScale(scale: Scale): boolean {
  return scale === "getaway" || scale === "vacation";
}

export function beatCountForScale(_scale: Scale): number {
  return 3;
}
