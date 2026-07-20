// Canonical catalog for the optional "fun profile" taste quiz.
//
// Shared between client (renders the chips) and server (validates
// submissions and maps option ids to the exact taste/constraint text that
// gets written to memory). Keeping this in one place means the client can
// never smuggle arbitrary taste/constraint text through the quiz endpoint —
// only the ids defined here map to a write.

export interface QuizOption {
  id: string;
  label: string;
  /** Present when selecting this option should write a taste. */
  taste?: { text: string; polarity: "love" | "avoid" };
  /** Present when selecting this option should write a hard constraint. */
  constraint?: { text: string };
}

export interface QuizQuestion {
  id: string;
  prompt: string;
  /** Multi-select chips vs. single-select. */
  multi: boolean;
  /** Max selections allowed when multi is true. */
  maxSelect?: number;
  options: QuizOption[];
}

export const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: "days",
    prompt: "Which kinds of days sound best?",
    multi: true,
    maxSelect: 3,
    options: [
      { id: "nature", label: "Nature", taste: { text: "nature parks trails scenic", polarity: "love" } },
      { id: "food", label: "Food discovery", taste: { text: "food markets restaurants tasting", polarity: "love" } },
      { id: "arts", label: "Arts & culture", taste: { text: "culture museum historic learning", polarity: "love" } },
      { id: "active", label: "Active play", taste: { text: "active hiking climbing adrenaline", polarity: "love" } },
      { id: "cozy", label: "Cozy social", taste: { text: "social board games cafe cozy", polarity: "love" } },
      { id: "wellness", label: "Wellness", taste: { text: "wellness yoga quiet restorative", polarity: "love" } },
      { id: "beach", label: "Beach/coast", taste: { text: "beach coastal waterfront swimming", polarity: "love" } },
      { id: "making", label: "Making things", taste: { text: "creative pottery painting studio", polarity: "love" } },
    ],
  },
  {
    id: "energy",
    prompt: "Your ideal energy?",
    multi: false,
    options: [
      { id: "slow", label: "Slow reset", taste: { text: "quiet relaxed unhurried", polarity: "love" } },
      { id: "easy", label: "Easy-going mix", taste: { text: "gentle walk relaxed", polarity: "love" } },
      { id: "full", label: "Full energy", taste: { text: "active adrenaline packed", polarity: "love" } },
    ],
  },
  {
    id: "environment",
    prompt: "Inside or outside?",
    multi: false,
    options: [
      { id: "outdoors", label: "Mostly outdoors", taste: { text: "outdoors park trail waterfront", polarity: "love" } },
      { id: "indoors", label: "Mostly indoors", taste: { text: "indoor museum cafe studio", polarity: "love" } },
      { id: "either", label: "Either" },
    ],
  },
  {
    id: "social",
    prompt: "What social atmosphere feels right?",
    multi: false,
    options: [
      { id: "quiet", label: "Quiet/one-to-one", taste: { text: "quiet low-key uncrowded", polarity: "love" } },
      { id: "smallgroup", label: "Small-group fun", taste: { text: "social board games cafe", polarity: "love" } },
      { id: "lively", label: "Lively buzz", taste: { text: "lively concert nightlife crowded", polarity: "love" } },
    ],
  },
  {
    id: "walking",
    prompt: "How much walking feels good?",
    multi: false,
    options: [
      { id: "short", label: "10–30 min", taste: { text: "10-30 minutes walking, gentle pace", polarity: "love" } },
      { id: "medium", label: "30–60 min", taste: { text: "30-60 minutes walking, moderate pace", polarity: "love" } },
      { id: "long", label: "60–120 min", taste: { text: "60-120 minutes walking, active pace", polarity: "love" } },
    ],
  },
  {
    id: "time",
    prompt: "Best time to head out?",
    multi: false,
    options: [
      { id: "morning", label: "Morning", taste: { text: "morning breakfast sunrise", polarity: "love" } },
      { id: "afternoon", label: "Afternoon", taste: { text: "afternoon lunch", polarity: "love" } },
      { id: "evening", label: "Evening", taste: { text: "evening dinner sunset", polarity: "love" } },
      { id: "flexible", label: "Flexible" },
    ],
  },
  {
    id: "foodRole",
    prompt: "What role should food play?",
    multi: false,
    options: [
      { id: "main", label: "Main event", taste: { text: "meal-centered restaurant tasting", polarity: "love" } },
      { id: "casual", label: "Casual discovery", taste: { text: "market cafe picnic snacks", polarity: "love" } },
      { id: "activity", label: "Activity first", taste: { text: "activity first, simple meal", polarity: "love" } },
    ],
  },
  {
    id: "spend",
    prompt: "Typical spend?",
    multi: false,
    options: [
      { id: "free", label: "Free/low-cost", taste: { text: "free low-cost picnic park market", polarity: "love" } },
      { id: "casual", label: "Casual", taste: { text: "casual cafe market", polarity: "love" } },
      { id: "special", label: "Special occasion", taste: { text: "special restaurant tasting", polarity: "love" } },
      { id: "flexible", label: "Flexible" },
    ],
  },
  {
    id: "distance",
    prompt: "How far should adventure go?",
    multi: false,
    options: [
      { id: "nearby", label: "Nearby", taste: { text: "nearby walkable local", polarity: "love" } },
      { id: "shortdrive", label: "Short drive", taste: { text: "short scenic drive", polarity: "love" } },
      { id: "weekend", label: "Weekend away", taste: { text: "getaway road trip cabin", polarity: "love" } },
      { id: "bigtrip", label: "Big trip", taste: { text: "vacation destination resort", polarity: "love" } },
    ],
  },
  {
    id: "avoid",
    prompt: "Anything PlanBuddy must always avoid?",
    multi: true,
    options: [
      { id: "peanuts", label: "Peanuts/tree nuts", constraint: { text: "Peanut and tree-nut allergy" } },
      { id: "shellfish", label: "Shellfish", constraint: { text: "Shellfish allergy" } },
      { id: "dairy", label: "Dairy", constraint: { text: "Dairy/lactose-free only" } },
      { id: "gluten", label: "Gluten", constraint: { text: "Celiac; gluten-free only" } },
      { id: "alcohol", label: "Alcohol", constraint: { text: "No alcohol" } },
      { id: "stairs", label: "Stairs", constraint: { text: "No stairs; step-free access required" } },
      { id: "noise", label: "Noise/crowds", constraint: { text: "Avoid loud places and crowds; quiet only" } },
      { id: "none", label: "None" },
    ],
  },
];

export const QUIZ_TASTE_SOURCE = "onboarding_quiz" as const;
export const QUIZ_CONSTRAINT_SOURCE = "onboarding_quiz" as const;

export interface QuizAnswerInput {
  questionId: string;
  optionIds: string[];
}

export interface QuizWrite {
  taste?: { text: string; polarity: "love" | "avoid" };
  constraint?: { text: string };
}

/**
 * Resolves submitted answers against the canonical catalog, returning only
 * the writes that correspond to real, current question/option ids. Unknown
 * ids (stale client, tampered payload) are silently dropped rather than
 * erroring — the quiz is optional and best-effort by design.
 */
export function resolveQuizWrites(answers: QuizAnswerInput[]): QuizWrite[] {
  const writes: QuizWrite[] = [];
  const byId = new Map(QUIZ_QUESTIONS.map((q) => [q.id, q]));
  for (const answer of answers) {
    const question = byId.get(answer.questionId);
    if (!question) continue;
    const seen = new Set<string>();
    for (const optionId of answer.optionIds) {
      if (seen.has(optionId)) continue;
      seen.add(optionId);
      const option = question.options.find((o) => o.id === optionId);
      if (!option) continue;
      if (option.taste) writes.push({ taste: option.taste });
      if (option.constraint) writes.push({ constraint: option.constraint });
    }
  }
  return writes;
}
