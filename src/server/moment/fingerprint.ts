import crypto from "node:crypto";
import type { Constraint, Participant } from "../../shared/types.js";

/**
 * The inputs fingerprint of a moment proposal (spec rule 5): the group's participant ids, their
 * active constraints and their relationships. A new allergy, a new relationship, or a person
 * added or removed changes it; a taste change or a rename does not.
 */
export function computeInputsFingerprint(participants: Participant[], constraints: Constraint[]): string {
  const people = participants
    .map((participant) => [participant.id, (participant.relationship ?? "").trim().toLowerCase()])
    .sort((a, b) => a[0].localeCompare(b[0]));
  const rules = constraints
    .map((constraint) => [constraint.id, constraint.participantId ?? "", constraint.text.trim().toLowerCase(), constraint.status])
    .sort((a, b) => a[0].localeCompare(b[0]));
  return crypto.createHash("sha256").update(JSON.stringify({ people, rules })).digest("hex").slice(0, 32);
}
