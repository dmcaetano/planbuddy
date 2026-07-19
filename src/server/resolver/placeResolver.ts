import { env } from "../env.js";

export interface ResolvedVenue {
  id: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  openNow: boolean | null;
}

export interface PlaceResolverResult {
  mode: "inspiration" | "resolved";
  venues: ResolvedVenue[];
}

/**
 * Pluggable live place resolver. With no provider key configured this is a
 * deliberate no-op: the app runs in explicit Inspiration mode, where the
 * model may name permanent geography and categories but the server never
 * asserts specific current venue facts (hours, open/closed) because there is
 * no live payload backing them (immutable principle #9).
 */
export async function resolvePlaces(_lat: number, _lng: number, _radiusKm: number): Promise<PlaceResolverResult> {
  if (!env.PLACE_RESOLVER_API_KEY) {
    return { mode: "inspiration", venues: [] };
  }
  // A real provider integration would call out here and map results into
  // ResolvedVenue[]. No provider is wired up in v1, so this remains
  // reachable-but-inert until PLACE_RESOLVER_API_KEY is set and a real
  // client is implemented alongside it.
  return { mode: "inspiration", venues: [] };
}
