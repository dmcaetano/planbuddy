/**
 * Deterministic parser for "<Name> is my <relationship>" statements said to Buddy.
 *
 * Pure and side-effect free: it only recognises the sentence. Whether the person exists, and the
 * confirm-before-write step, are handled by the chat route.
 *
 * Relationship words stay exactly as the user typed them (lower-cased, so "esposa" stays "esposa" and
 * is never translated). Only a known vocabulary is trusted on its own; any other single short word is
 * returned with `known: false` so the caller can accept it only for a person that already exists.
 */

export interface RelationshipIntent {
  /** The name exactly as typed. */
  name: string;
  /** Relationship phrase as typed, lower-cased and trimmed. */
  relationship: string;
  /** True when the phrase is in the known vocabulary. */
  known: boolean;
}

const VOCAB_WORDS = [
  // English
  "wife", "husband", "partner", "spouse", "girlfriend", "boyfriend", "fiance", "fiancee", "fiancé", "fiancée",
  "mother", "mom", "mum", "mama", "mommy", "mummy", "father", "dad", "daddy", "papa",
  "son", "daughter", "child", "kid", "baby", "brother", "sister", "sibling", "twin",
  "friend", "grandmother", "grandfather", "grandma", "grandpa", "granny", "grandad", "grandson", "granddaughter",
  "aunt", "uncle", "cousin", "niece", "nephew", "colleague", "coworker", "roommate", "flatmate", "neighbour",
  "neighbor", "boss", "stepson", "stepdaughter", "stepmother", "stepfather", "mother-in-law", "father-in-law",
  "son-in-law", "daughter-in-law", "brother-in-law", "sister-in-law", "dog", "cat", "pet",
  // Portuguese (kept as typed)
  "esposa", "marido", "mulher", "namorada", "namorado", "noiva", "noivo", "companheiro", "companheira",
  "mãe", "mae", "pai", "mamã", "papá", "filho", "filha", "irmão", "irmao", "irmã", "irma",
  "amigo", "amiga", "avó", "avo", "avô", "tio", "tia", "primo", "prima", "sobrinho", "sobrinha",
  "colega", "vizinho", "vizinha", "genro", "nora", "cunhado", "cunhada", "sogro", "sogra", "enteado", "enteada",
  "cão", "cao", "gato", "gata", "cadela",
];
const VOCAB = new Set(VOCAB_WORDS);
const MODIFIERS = ["best", "little", "big", "younger", "older", "twin", "step", "half", "future", "oldest", "youngest"];

/** Words that can never be a name or a free relationship word. */
const STOP_WORDS = new Set([
  "i", "me", "you", "he", "she", "it", "we", "they", "this", "that", "who", "what", "there", "here", "everyone",
  "nobody", "someone", "buddy", "my", "your", "our", "the", "a", "an", "and", "or", "not", "no", "yes",
  "favourite", "favorite", "best", "worst", "only", "first", "last", "life", "world", "everything", "all", "own",
  "problem", "fault", "job", "business", "choice", "thing", "plan", "idea", "dream", "passion", "happy", "place",
  "home", "weekend", "birthday", "holiday", "day", "night", "dinner", "lunch", "breakfast", "restaurant", "type",
]);

const NAME_WORD = "[\\p{L}][\\p{L}'’.-]*";
const NAME = `${NAME_WORD}(?:\\s+${NAME_WORD}){0,2}`;
const PREFIX = "(?:(?:ok|okay|so|btw|fyi|hey|hi|well|actually|just so you know|by the way)[,:]?\\s+)*(?:buddy[,:]?\\s+)?";
const SUFFIX = "(?:\\s+(?:now|actually|by the way|btw))?\\s*[.!]*";
const IS = "(?:is|é|'s|’s)";
const REL = `((?:${MODIFIERS.join("|")})?\\s*[\\p{L}][\\p{L}'’-]{1,24}(?:\\s+[\\p{L}][\\p{L}'’-]{1,24})?)`;

// "Dani is my wife" / "Sissi é a minha filha" is intentionally NOT supported (stay with "my").
const PATTERN_NAME_FIRST = new RegExp(`^\\s*${PREFIX}(${NAME})\\s+${IS}\\s+my\\s+${REL}${SUFFIX}\\s*$`, "iu");
const PATTERN_REL_FIRST = new RegExp(`^\\s*${PREFIX}my\\s+${REL}\\s+${IS}\\s+(${NAME})${SUFFIX}\\s*$`, "iu");

function cleanName(raw: string): string | null {
  const name = raw.trim().replace(/[.\-']+$/u, "").trim();
  if (!name || name.length > 60) return null;
  const words = name.toLowerCase().split(/\s+/u);
  if (words.some((w) => STOP_WORDS.has(w))) return null;
  return name;
}

function classify(rawRel: string): { relationship: string; known: boolean } | null {
  const relationship = rawRel.trim().toLowerCase().replace(/\s+/gu, " ");
  if (!relationship || relationship.length > 40) return null;
  const words = relationship.split(" ");
  const head = words[words.length - 1];
  const modifiersOk = words.slice(0, -1).every((w) => MODIFIERS.includes(w));
  if (VOCAB.has(relationship) || (modifiersOk && VOCAB.has(head)) || (words.length === 2 && words[0] === "best" && VOCAB.has(head))) {
    return { relationship, known: true };
  }
  // Free word: a single short word that is not a stop word.
  if (words.length === 1 && relationship.length >= 3 && relationship.length <= 14 && !STOP_WORDS.has(relationship)) {
    return { relationship, known: false };
  }
  return null;
}

export function parseRelationshipIntent(text: string): RelationshipIntent | null {
  const input = text.trim();
  if (!input || input.length > 200 || input.endsWith("?")) return null;

  const first = PATTERN_NAME_FIRST.exec(input);
  if (first) {
    const name = cleanName(first[1]);
    const rel = classify(first[2]);
    if (name && rel) return { name, ...rel };
  }

  const second = PATTERN_REL_FIRST.exec(input);
  if (second) {
    const rel = classify(second[1]);
    const name = cleanName(second[2]);
    // "my wife is sick" must not read as a name: the name has to start with a capital here.
    if (name && rel && /^\p{Lu}/u.test(name)) return { name, ...rel };
  }
  return null;
}

/** Accent- and case-insensitive key for matching a spoken name to a stored participant name. */
export function nameKey(name: string): string {
  return name.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/\s+/gu, " ").trim();
}
