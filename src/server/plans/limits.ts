/** A catalogue-backed local plan is inexpensive, so let people explore
 * meaningfully before asking them to alter the request. History exclusions
 * still prevent every surfaced stop from repeating across these generations. */
export const MAX_GENERATIONS_PER_SPEC = 20;
