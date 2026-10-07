import { otherBuddiesBlock } from "../omni/hub.js";
import { createConstraint, deleteConstraint, getConstraint, listConstraints } from "../memory/constraints.repo.js";
import { createTaste, deleteTaste, getTaste, listTastes } from "../memory/tastes.repo.js";
import { confirmHunch, deleteHunch, dismissHunch, getHunch, listHunches } from "../memory/hunches.repo.js";
import {
  createParticipant,
  deleteParticipant,
  findParticipantByName,
  getParticipant,
  listParticipants,
  updateParticipant,
} from "../participants/repo.js";
import { createTimeOff, deleteTimeOff, getTimeOff, listTimeOff, updateTimeOff } from "../timeoff/repo.js";
import { listFriends } from "../friends/repo.js";
import { getUserById, setHomeBase, setTravelPreferences } from "../users/repo.js";
import { geocodeCity } from "../weather/openMeteo.js";
import { chatRespond } from "../ai/index.js";
import { lastSurfacedPlans } from "../plans/plans.repo.js";
import { getActiveJobForUser } from "../plans/jobs.js";
import { isoDateSchema, type AiAppAction } from "../../shared/schemas.js";
import { radiusForScale } from "../../shared/scale.js";
import type { PublicUser } from "../../shared/types.js";

export interface UndoRequest {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
}

export interface AppliedChange {
  label: string;
  undo: UndoRequest | null;
}

export interface AppActionResult {
  applied: AppliedChange[];
  failed: string[];
  user: PublicUser | null;
  planRequest: { scope: "tonight" | "day" | "weekend" | null } | null;
}

/** Compact, id-bearing picture of everything Buddy may read or change. Never contains other users' memory. */
export async function buildAppSnapshot(userId: string): Promise<string> {
  const [user, people, constraints, tastes, hunches, timeOff, friends, recentPlans, activeJob] = await Promise.all([
    getUserById(userId),
    listParticipants(userId),
    listConstraints(userId),
    listTastes(userId),
    listHunches(userId),
    listTimeOff(userId),
    listFriends(userId),
    lastSurfacedPlans(userId, 3),
    getActiveJobForUser(userId),
  ]);
  const nameOf = (id: string | null) => (id ? people.find((p) => p.id === id)?.name ?? "Household" : "Household");
  return JSON.stringify({
    today: new Date().toISOString().slice(0, 10),
    homeBase: user?.homeBaseLabel ?? null,
    travelKm: { dinnerOrDayOut: radiusForScale("day_off", user), weekend: radiusForScale("weekend", user) },
    people: people.map((p) => ({ id: p.id, name: p.name, kind: p.kind, relationship: p.relationship, isYou: p.isOwner })),
    constraints: constraints.map((c) => ({ id: c.id, text: c.text, for: nameOf(c.participantId), status: c.status })),
    tastes: tastes.map((t) => ({ id: t.id, text: t.text, polarity: t.polarity, for: nameOf(t.participantId) })),
    hunches: hunches.filter((h) => h.status === "active").map((h) => ({ id: h.id, text: h.text, polarity: h.polarity, for: nameOf(h.participantId) })),
    timeOff: timeOff.map((t) => ({ id: t.id, label: t.label, startDate: t.startDate, endDate: t.endDate })),
    planner: {
      note: "Plans are built and edited by the separate Planner worker, never by you. You can only read them here.",
      working: activeJob ? { status: activeJob.status, stage: activeJob.stageLabel, progressPct: Math.round(activeJob.progressPct) } : null,
      recentPlans: recentPlans.map((pl) => ({ title: pl.title, category: pl.category, distanceKmFromHome: pl.distanceKm, stops: pl.beats.map((b) => b.place?.name ?? b.title).filter(Boolean) })),
    },
    circle: friends.map((f) => ({ name: f.displayName, groups: f.labels.map((l) => l.name) })),
  });
}

async function resolvePerson(userId: string, name: string | null | undefined): Promise<{ id: string | null } | { error: string }> {
  if (!name || /^(household|everyone|all|us)$/i.test(name.trim())) return { id: null };
  const person = await findParticipantByName(userId, name.trim());
  return person ? { id: person.id } : { error: `I don't have anyone called ${name.trim()} yet` };
}

function clampKm(value: number | null | undefined, min: number, max: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, Math.round(value)));
}

async function applyOne(userId: string, action: AiAppAction, sourceMessage: string, out: AppActionResult): Promise<void> {
  const fail = (reason: string) => {
    out.failed.push(reason);
  };
  switch (action.type) {
    case "new_plan":
      out.planRequest = { scope: action.scope ?? null };
      return;
    case "set_travel": {
      const user = await getUserById(userId);
      const prevDay = radiusForScale("day_off", user);
      const prevWeekend = radiusForScale("weekend", user);
      const day = clampKm(action.dayKm, 2, 200) ?? prevDay;
      const weekend = clampKm(action.weekendKm, 2, 400) ?? prevWeekend;
      out.user = await setTravelPreferences(userId, day, weekend);
      out.applied.push({
        label: `Distance from home: ${day} km for a dinner or day out, ${weekend} km for a weekend`,
        undo: { method: "PUT", path: "/auth/travel-preferences", body: { travelDayKm: prevDay, travelWeekendKm: prevWeekend } },
      });
      return;
    }
    case "set_home_base": {
      const city = action.city?.trim();
      if (!city) return fail("Which city should be your home base?");
      const [match] = await geocodeCity(city);
      if (!match) return fail(`I couldn't find a place called ${city}`);
      const prev = await getUserById(userId);
      out.user = await setHomeBase(userId, match.label, match.lat, match.lng);
      out.applied.push({
        label: `Home base: ${match.label}`,
        undo:
          prev?.homeBaseLabel && prev.homeBaseLat != null && prev.homeBaseLng != null
            ? { method: "PUT", path: "/auth/home-base", body: { label: prev.homeBaseLabel, lat: prev.homeBaseLat, lng: prev.homeBaseLng } }
            : null,
      });
      return;
    }
    case "add_constraint": {
      const text = action.text?.trim();
      if (!text) return fail("What should the constraint say?");
      const who = await resolvePerson(userId, action.personName);
      if ("error" in who) return fail(who.error);
      const created = await createConstraint(userId, {
        participantId: who.id,
        text,
        status: "active_unverified",
        source: "chat",
        sourceQuote: sourceMessage.slice(0, 500),
      });
      out.applied.push({ label: `Constraint added: ${text}`, undo: { method: "DELETE", path: `/constraints/${created.id}` } });
      return;
    }
    case "remove_constraint": {
      const existing = action.id ? await getConstraint(userId, action.id) : null;
      if (!existing) return fail("I couldn't find that constraint");
      await deleteConstraint(userId, existing.id);
      out.applied.push({
        label: `Constraint removed: ${existing.text}`,
        undo: { method: "POST", path: "/constraints", body: { text: existing.text, participantId: existing.participantId } },
      });
      return;
    }
    case "add_taste": {
      const text = action.text?.trim();
      if (!text || !action.polarity) return fail("I need the taste and whether it's loved or avoided");
      const who = await resolvePerson(userId, action.personName);
      if ("error" in who) return fail(who.error);
      const created = await createTaste(userId, { participantId: who.id, text, polarity: action.polarity, source: "stated" });
      out.applied.push({
        label: `${action.polarity === "love" ? "Loves" : "Avoids"}: ${text}`,
        undo: { method: "DELETE", path: `/tastes/${created.id}` },
      });
      return;
    }
    case "remove_taste": {
      const existing = action.id ? await getTaste(userId, action.id) : null;
      if (!existing) return fail("I couldn't find that taste");
      await deleteTaste(userId, existing.id);
      out.applied.push({
        label: `Taste removed: ${existing.text}`,
        undo: {
          method: "POST",
          path: "/tastes",
          body: { text: existing.text, polarity: existing.polarity, participantId: existing.participantId, weight: existing.weight },
        },
      });
      return;
    }
    case "add_person": {
      const name = action.name?.trim();
      if (!name) return fail("What's their name?");
      const created = await createParticipant(userId, { name, kind: action.kind ?? "person", relationship: action.relationship?.trim() || null });
      out.applied.push({
        label: `${created.kind === "pet" ? "Pet" : "Person"} added: ${created.name}${created.relationship ? ` (${created.relationship})` : ""}`,
        undo: { method: "DELETE", path: `/participants/${created.id}` },
      });
      return;
    }
    case "set_relationship": {
      const existing = action.id ? await getParticipant(userId, action.id) : null;
      if (!existing || existing.isOwner) return fail("I couldn't find that person");
      const relationship = action.relationship?.trim();
      if (!relationship) return fail("What's their relationship to you?");
      await updateParticipant(userId, existing.id, { relationship });
      out.applied.push({
        label: `${existing.name} is now your ${relationship}`,
        undo: { method: "PATCH", path: `/participants/${existing.id}`, body: { relationship: existing.relationship ?? null } },
      });
      return;
    }
    case "remove_person": {
      const existing = action.id ? await getParticipant(userId, action.id) : null;
      if (!existing || existing.isOwner) return fail("I couldn't find that person");
      await deleteParticipant(userId, existing.id);
      out.applied.push({
        label: `Removed ${existing.name}`,
        undo: { method: "POST", path: "/participants", body: { name: existing.name, kind: existing.kind, relationship: existing.relationship ?? null } },
      });
      return;
    }
    case "add_time_off": {
      const label = action.label?.trim();
      const start = isoDateSchema.safeParse(action.startDate);
      const end = isoDateSchema.safeParse(action.endDate ?? action.startDate);
      if (!label || !start.success || !end.success || end.data < start.data) {
        return fail("I need a label and valid start and end dates for time off");
      }
      const created = await createTimeOff(userId, { label, startDate: start.data, endDate: end.data });
      out.applied.push({
        label: `Time off added: ${label}, ${start.data} to ${end.data}`,
        undo: { method: "DELETE", path: `/time-off/${created.id}` },
      });
      return;
    }
    case "update_time_off": {
      const existing = action.id ? await getTimeOff(userId, action.id) : null;
      if (!existing) return fail("I couldn't find that time off");
      const label = action.label?.trim() || existing.label;
      const start = isoDateSchema.safeParse(action.startDate ?? existing.startDate);
      const end = isoDateSchema.safeParse(action.endDate ?? existing.endDate);
      if (!start.success || !end.success || end.data < start.data) return fail("Those dates aren't valid");
      await updateTimeOff(userId, existing.id, { label, startDate: start.data, endDate: end.data });
      out.applied.push({
        label: `Time off updated: ${label}, ${start.data} to ${end.data}`,
        undo: { method: "PATCH", path: `/time-off/${existing.id}`, body: { label: existing.label, startDate: existing.startDate, endDate: existing.endDate } },
      });
      return;
    }
    case "remove_time_off": {
      const existing = action.id ? await getTimeOff(userId, action.id) : null;
      if (!existing) return fail("I couldn't find that time off");
      await deleteTimeOff(userId, existing.id);
      out.applied.push({
        label: `Time off removed: ${existing.label}`,
        undo: { method: "POST", path: "/time-off", body: { label: existing.label, startDate: existing.startDate, endDate: existing.endDate } },
      });
      return;
    }
    case "confirm_hunch":
    case "dismiss_hunch":
    case "remove_hunch": {
      const existing = action.id ? await getHunch(userId, action.id) : null;
      if (!existing) return fail("I couldn't find that hunch");
      if (action.type === "confirm_hunch") await confirmHunch(userId, existing.id);
      else if (action.type === "dismiss_hunch") await dismissHunch(userId, existing.id);
      else await deleteHunch(userId, existing.id);
      const verb = action.type === "confirm_hunch" ? "Confirmed" : action.type === "dismiss_hunch" ? "Dismissed" : "Deleted";
      out.applied.push({ label: `${verb} hunch: ${existing.text}`, undo: null });
      return;
    }
  }
}

/** Applies model-requested settings changes. Every id is re-checked against this user's own rows before anything is written. */
export async function applyAppActions(userId: string, actions: AiAppAction[], sourceMessage: string): Promise<AppActionResult> {
  const out: AppActionResult = { applied: [], failed: [], user: null, planRequest: null };
  for (const action of actions) {
    try {
      await applyOne(userId, action, sourceMessage, out);
    } catch {
      out.failed.push("Something went wrong saving that change");
    }
  }
  return out;
}

/** Keeps the spoken reply honest: it always reflects what actually changed. */
export function composeAssistantReply(modelReply: string, requested: number, result: AppActionResult): string {
  if (requested === 0) return modelReply;
  const failures = result.failed.length ? ` I couldn't do this: ${result.failed.join("; ")}.` : "";
  if (result.applied.length === 0 && !result.planRequest) return `I couldn't make that change.${failures}`.trim();
  return `${modelReply}${failures}`.trim();
}

/** Plan-dock entry point: answers or changes anything outside the visible plan, using the same snapshot and action executor as the general chat. */
export async function answerAsApp(userId: string, message: string, seed: string) {
  const snapshot = await buildAppSnapshot(userId);
  const { mode, response } = await chatRespond({ message, seed, snapshot, otherBuddies: (await otherBuddiesBlock(userId, message)) || undefined });
  const result = await applyAppActions(userId, response.actions, message);
  return { mode, reply: composeAssistantReply(response.reply, response.actions.length, result), result };
}
