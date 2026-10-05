// Reads real production proposals as the canary account. Usage: node scripts/live-read.mjs "<localDateTime>" [anotherCount]
import fs from "node:fs";
const BASE = process.env.PB_BASE || "https://planbuddy.onrender.com";
const creds = fs.readFileSync("../API Keys/PlanBuddy canary account.txt", "utf8");
const email = /email=(.*)/.exec(creds)[1].trim();
const password = /password=(.*)/.exec(creds)[1].trim();
let cookie = "";
async function api(path, body, method) {
  const res = await fetch(BASE + path, {
    method: method || (body ? "POST" : "GET"),
    headers: { "content-type": "application/json", cookie, origin: BASE, "x-planbuddy-client": "1" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  if (sc.length) cookie = sc.map((c) => c.split(";")[0]).join("; ");
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text, status: res.status }; }
}
async function waitJob(jobId) {
  const t0 = Date.now();
  for (;;) {
    const j = await api(`/api/plan-jobs/${jobId}`);
    if (j.status === "succeeded" || j.status === "completed" || j.status === "failed" || j.status === "error") return { j, ms: Date.now() - t0 };
    if (Date.now() - t0 > 120000) return { j, ms: -1 };
    await new Promise((r) => setTimeout(r, 700));
  }
}
function show(label, ms, resp) {
  const w = resp?.winner?.candidate;
  console.log(`\n== ${label} (${ms} ms)`);
  if (!w) return console.log(JSON.stringify(resp).slice(0, 400));
  console.log(`${w.title} | ${w.category} | ${w.travelEstimateKm} km`);
  for (const b of w.beats) console.log(`  ${b.startTime ?? b.start ?? ""} ${b.kind ?? b.type ?? ""} ${b.title ?? b.name} @ ${b.place?.name ?? b.placeName ?? ""} ${b.place?.address ?? ""}`);
  console.log("  why:", (w.rationale || "").slice(0, 300));
}
const when = process.argv[2];
const n = Number(process.argv[3] ?? 0);
const login = await api("/api/auth/login", { email, password });
if (!login.user) { console.log("login failed", login); process.exit(1); }
const t0 = Date.now();
const m = await api("/api/moment", { localDateTime: when });
console.log("moment", m.moment?.label, m.status, "|", m.reasonLine);
let resp = m.plan, ms = Date.now() - t0, specId = resp?.spec?.id;
if (m.status === "generating") { const r = await waitJob(m.jobId); ms = Date.now() - t0; resp = r.j.result ?? r.j; specId = resp?.spec?.id ?? specId; }
show(`${when} first`, ms, resp);
for (let i = 0; i < n; i++) {
  const t = Date.now();
  const r = await api(`/api/plan-specs/${specId}/regenerate`, {});
  const w = await waitJob(r.jobId);
  show(`${when} another #${i + 1}`, Date.now() - t, w.j.result ?? w.j);
}
