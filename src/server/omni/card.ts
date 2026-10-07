// The OmniBuddy card and its one-tap action. READ-ONLY on the card path: opening the hub never builds a plan,
// never calls a model and never creates a row ("five opens create zero rows").
import { env } from "../env.js";
import { getDb } from "../db/client.js";
import { resolveMoment } from "../../shared/moment.js";
import { radiusForScale } from "../../shared/scale.js";
import type { MomentInfo } from "../../shared/momentTypes.js";
import type { PlanRecord } from "../../shared/types.js";
import { getUserById } from "../users/repo.js";
import { listParticipants } from "../participants/repo.js";
import { listActiveConstraints } from "../memory/constraints.repo.js";
import { getCandidate } from "../plans/candidates.repo.js";
import { getPlanSpec } from "../plans/specs.repo.js";
import { computeInputsFingerprint } from "../moment/fingerprint.js";
import { findNewestMomentPlan, listLockedPlansCovering } from "../moment/repo.js";
import { lastBeatEnded } from "../moment/retime.js";
import { buildReasonLine } from "../moment/reason.js";

export type Loc = "en" | "pt-PT";

export interface BuddyCard {
  state: "ready" | "needs_data" | "error";
  title: string;
  body?: string;
  reason?: string;
  primaryAction?: { id: string; label: string };
  deeplink?: string;
  freshUntil?: string;
}

/** Device-local wall clock "YYYY-MM-DDTHH:mm" in the app's time zone (the hub does not send one). */
export function localNow(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: env.PLANBUDDY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return parts.replace(" ", "T");
}

const t = (loc: Loc, en: string, pt: string) => (loc === "pt-PT" ? pt : en);

function lockLabel(kind: MomentInfo["kind"], loc: Loc): string {
  if (kind === "tonight") return t(loc, "Lock tonight's plan", "Fixar o plano desta noite");
  if (kind === "day") return t(loc, "Lock the day's plan", "Fixar o plano do dia");
  return t(loc, "Lock the weekend plan", "Fixar o plano do fim de semana");
}

export type PlanState =
  | { kind: "no_household" }
  | { kind: "no_plan"; moment: MomentInfo }
  | { kind: "locked"; moment: MomentInfo; plan: PlanRecord }
  | { kind: "suggested"; moment: MomentInfo; plan: PlanRecord; reasonLine: string | null };

/** Where the current moment stands, from stored rows only. */
export async function currentPlanState(userId: string, now = new Date()): Promise<PlanState> {
  const localIso = localNow(now);
  const moment = resolveMoment(localIso);
  const household = await listParticipants(userId);
  if (household.length === 0) return { kind: "no_household" };

  for (const plan of await listLockedPlansCovering(userId, moment.planDate)) {
    const sameDay = plan.eventStartDate === plan.eventEndDate && plan.eventStartDate === moment.planDate;
    if (sameDay && lastBeatEnded(plan.beats, localIso)) continue;
    return { kind: "locked", moment, plan };
  }

  const user = await getUserById(userId);
  const radius = radiusForScale(moment.kind === "weekend" ? "weekend" : "day_off", user);
  const constraints = await listActiveConstraints(userId);
  const fp = computeInputsFingerprint(household, constraints, radius, user ? { lat: user.homeBaseLat, lng: user.homeBaseLng } : null);
  const plan = await findNewestMomentPlan(userId, moment.key, fp);
  if (plan && plan.status === "suggested") {
    const candidate = await getCandidate(plan.candidateId);
    if (candidate && !candidate.rejected) {
      const spec = await getPlanSpec(userId, plan.planSpecId);
      return { kind: "suggested", moment, plan, reasonLine: spec?.reasonParts ? buildReasonLine(spec.reasonParts) : null };
    }
  }
  return { kind: "no_plan", moment };
}

const brief = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

function planBody(plan: PlanRecord): string {
  const stops = plan.beats.map((b) => b.place?.name ?? b.title).filter(Boolean).slice(0, 4);
  return brief([plan.rationale, stops.length ? stops.join(" → ") : ""].filter(Boolean).join("\n"), 400);
}

export async function buildCard(userId: string, loc: Loc, now = new Date()): Promise<BuddyCard> {
  const deeplink = env.PLANBUDDY_PUBLIC_URL;
  const freshUntil = new Date(now.getTime() + 10 * 60_000).toISOString();
  const s = await currentPlanState(userId, now);
  if (s.kind === "no_household") {
    return {
      state: "needs_data",
      title: t(loc, "Who is the plan for?", "Para quem é o plano?"),
      body: t(loc, "Add who you plan with (you, a partner, a pet) in PlanBuddy so it can propose something real.", "Junta as pessoas com quem planeias (tu, parceiro/a, animal) no PlanBuddy para que possa propor algo real."),
      deeplink,
      freshUntil,
    };
  }
  if (s.kind === "no_plan") {
    return {
      state: "needs_data",
      title: t(loc, `No plan yet for ${s.moment.label.toLowerCase()}`, `Ainda sem plano: ${s.moment.label.toLowerCase()}`),
      body: t(loc, `Open PlanBuddy once to build ${s.moment.label.toLowerCase()}; the hub never starts a plan by itself.`, `Abre o PlanBuddy uma vez para criar o plano (${s.moment.label.toLowerCase()}); o hub nunca inicia um plano sozinho.`),
      deeplink,
      freshUntil,
    };
  }
  if (s.kind === "locked") {
    return {
      state: "ready",
      title: `${s.moment.label}: ${s.plan.title}`,
      body: planBody(s.plan),
      reason: t(loc, "Locked", "Fixado"),
      primaryAction: { id: "view_plan", label: t(loc, "Open the plan", "Abrir o plano") },
      deeplink,
      freshUntil,
    };
  }
  return {
    state: "ready",
    title: `${s.moment.label}: ${s.plan.title}`,
    body: planBody(s.plan),
    reason: s.reasonLine ?? undefined,
    primaryAction: { id: "lock_plan", label: lockLabel(s.moment.kind, loc) },
    deeplink,
    freshUntil,
  };
}

export interface ActOutcome {
  ok: boolean;
  message: string;
  undoToken?: string;
}

/** Locks the proposed plan for the current moment. Returns what to record for undo. */
export async function lockCurrentPlan(userId: string, loc: Loc, now = new Date()): Promise<{ ok: boolean; message: string; planId?: string; noop?: boolean }> {
  const s = await currentPlanState(userId, now);
  if (s.kind === "locked") return { ok: true, noop: true, message: t(loc, `Already locked: ${s.plan.title}.`, `Já fixado: ${s.plan.title}.`) };
  if (s.kind !== "suggested") return { ok: false, message: t(loc, "There is no plan to lock yet. Open PlanBuddy to build one.", "Ainda não há plano para fixar. Abre o PlanBuddy para criar um.") };
  const db = await getDb();
  await db.query(`UPDATE plans SET status = 'locked', locked_at = now() WHERE id = $1 AND user_id = $2 AND status = 'suggested'`, [s.plan.id, userId]);
  return { ok: true, planId: s.plan.id, message: t(loc, `Locked: ${s.plan.title}.`, `Fixado: ${s.plan.title}.`) };
}

export async function unlockPlan(userId: string, planId: string): Promise<void> {
  const db = await getDb();
  await db.query(`UPDATE plans SET status = 'suggested', locked_at = NULL WHERE id = $1 AND user_id = $2 AND status = 'locked'`, [planId, userId]);
}
