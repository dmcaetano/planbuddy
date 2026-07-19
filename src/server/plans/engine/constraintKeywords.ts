/**
 * Deterministic, mechanical constraint-to-keyword mapping used by the
 * server-side constraint filter (never by the model). A constraint's free
 * text is scanned for a dictionary trigger; if found, any candidate whose
 * combined text contains one of the associated blocked terms is a hard
 * veto, regardless of what the AI claims about its own compliance.
 */
export interface KeywordRule {
  triggers: string[]; // substrings in constraint text that activate this rule
  blocked: string[]; // substrings in candidate text that violate it
}

export const CONSTRAINT_KEYWORD_RULES: KeywordRule[] = [
  { triggers: ["peanut", "tree nut", "nut allerg"], blocked: ["peanut", "cashew", "almond", "walnut", "hazelnut"] },
  { triggers: ["shellfish", "seafood allerg"], blocked: ["shellfish", "shrimp", "crab", "lobster", "oyster"] },
  { triggers: ["dairy", "lactose"], blocked: ["dairy", "cheese", "milk", "cream", "gelato", "ice cream"] },
  { triggers: ["gluten", "celiac"], blocked: ["gluten", "wheat", "bread", "pasta", "noodle"] },
  { triggers: ["no alcohol", "sober", "alcohol-free", "no drinking"], blocked: ["beer", "wine", "brewery", "winery", "cocktail", "alcohol"] },
  { triggers: ["no seafood"], blocked: ["seafood", "fish", "shellfish", "shrimp", "crab", "lobster", "oyster"] },
  { triggers: ["no spicy", "spice-free", "no heat"], blocked: ["spicy", "chili", "hot sauce"] },
  { triggers: ["no smoking", "smoke-free"], blocked: ["smoking", "cigar"] },
  {
    triggers: ["quiet", "low noise", "no loud", "no crowds", "avoid loud", "avoid crowd", "noise-sensitive"],
    blocked: ["nightlife", "loud", "crowded", "rave", "concert"],
  },
  { triggers: ["no stairs", "wheelchair", "step-free", "mobility"], blocked: ["climbing", "hike", "trail", "bouldering", "stairs"] },
];

export function indoorOnlyRequired(text: string): boolean {
  const t = text.toLowerCase();
  return /\bindoor(s)?\s+only\b|\bmust be indoor\b/.test(t);
}

export function outdoorOnlyRequired(text: string): boolean {
  const t = text.toLowerCase();
  return /\boutdoor(s)?\s+only\b|\bmust be outdoor\b/.test(t);
}

export function blockedTermsForConstraint(constraintText: string): string[] {
  const t = constraintText.toLowerCase();
  const blocked = new Set<string>();
  for (const rule of CONSTRAINT_KEYWORD_RULES) {
    if (rule.triggers.some((trigger) => t.includes(trigger))) {
      rule.blocked.forEach((term) => blocked.add(term));
    }
  }
  return [...blocked];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isExplicitlySafeMention(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 64), start);
  const after = text.slice(end, Math.min(text.length, end + 24));

  // Examples: gluten-safe, dairy free, allergy-friendly.
  if (/^\s*[- ]\s*(?:free|safe|friendly|aware)\b/.test(after)) return true;

  // Examples: without wheat, avoid loud/crowded rooms, no alcohol.
  if (/\b(?:no|without|avoid|avoids|avoiding|avoided|free of|free from)\b[^.!?;]{0,44}$/.test(before)) {
    return true;
  }

  // Examples: gluten-free bread, dairy-free ice cream, nut-safe menu.
  return /\b(?:gluten|celiac|dairy|lactose|nut|peanut|shellfish|allergen|alcohol|smoke|spice)[- ](?:free|safe|friendly)\b[^.!?;]{0,36}$|\b(?:wheelchair[- ]accessible|step[- ]free|non[- ]alcoholic|zero[- ]alcohol)\b[^.!?;]{0,36}$/.test(
    before
  );
}

/**
 * Finds real blocked-term mentions while allowing explicit safety language.
 * A plain substring check incorrectly classified "gluten-safe" and
 * "uncrowded" as violations, causing safe AI plans to dead-end.
 */
export function containsUnsafeBlockedTerm(text: string, term: string): boolean {
  const normalized = text.toLowerCase();
  const matcher = new RegExp(`(?<![a-z0-9])${escapeRegExp(term.toLowerCase())}(?![a-z0-9])`, "g");
  for (const match of normalized.matchAll(matcher)) {
    const start = match.index ?? 0;
    if (!isExplicitlySafeMention(normalized, start, start + match[0].length)) return true;
  }
  return false;
}
