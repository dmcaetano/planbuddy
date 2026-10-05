import { isPartnerWord } from "../../shared/moment.js";
import type { MomentKind } from "../../shared/momentTypes.js";
import type { Participant } from "../../shared/types.js";

/**
 * Spec rule 12: romantic framing applies only to a `tonight` moment whose people are the owner
 * plus exactly one other local household person with a partner-word relationship. Pets are ignored.
 * A connected friend account never triggers it (its relationship is forced to "PlanBuddy friend"
 * and the owner cannot store one for it), and it also counts as an extra person, so
 * "owner + wife + a friend account" stays neutral.
 */
export function isRomanticGroup(participants: Participant[], kind: MomentKind): boolean {
  if (kind !== "tonight") return false;
  const others = participants.filter((participant) => participant.kind === "person" && !participant.isOwner);
  if (others.length !== 1) return false;
  const [other] = others;
  if (other.isFriendAccount) return false;
  return isPartnerWord(other.relationship);
}
