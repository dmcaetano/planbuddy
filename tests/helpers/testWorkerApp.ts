import { runMigrations } from "../../src/server/db/migrate.js";
import workerExport from "../../src/worker/index.js";
import type { WorkerBindings } from "../../src/worker/bindings.js";

let migrated: Promise<void> | null = null;

/** Stub Workflow binding for plain-Node tests: Workflows only run inside the real Workers runtime,
 *  so plan-generation-triggering tests just assert the job row/202 contract, not an actual run. */
export function stubBindings(): WorkerBindings {
  return {
    PLAN_GENERATION: {
      async create() {
        return { id: "stub-instance" };
      },
    },
  };
}

export async function getTestWorkerApp() {
  if (!migrated) migrated = runMigrations();
  await migrated;
  return workerExport;
}

const BASE = "http://worker.test";

/** A minimal same-origin cookie jar around the Worker's fetch export, mirroring supertest.agent()
 *  for the Express build's tests but talking directly to Hono's `app.fetch` (no real HTTP socket). */
export class WorkerAgent {
  private cookies = new Map<string, string>();

  constructor(
    private readonly worker: Awaited<ReturnType<typeof getTestWorkerApp>>,
    private readonly env: WorkerBindings = stubBindings()
  ) {}

  private cookieHeader(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private absorbSetCookie(res: Response): void {
    const setCookie = res.headers.get("set-cookie");
    if (!setCookie) return;
    const [pair] = setCookie.split(";");
    const idx = pair.indexOf("=");
    const name = pair.slice(0, idx);
    const value = pair.slice(idx + 1);
    if (setCookie.includes("Max-Age=0")) {
      this.cookies.delete(name);
    } else {
      this.cookies.set(name, value);
    }
  }

  async request(
    method: string,
    path: string,
    opts: { body?: unknown; sameOrigin?: boolean; headers?: Record<string, string> } = {}
  ): Promise<{ status: number; body: unknown; headers: Headers }> {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (opts.sameOrigin !== false && method !== "GET" && method !== "HEAD") {
      headers["x-planbuddy-client"] = "1";
    }
    const cookie = this.cookieHeader();
    if (cookie) headers["cookie"] = cookie;

    const req = new Request(`${BASE}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const res = await this.worker.fetch(req, this.env as never, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as never);
    this.absorbSetCookie(res);
    const text = await res.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { status: res.status, body, headers: res.headers };
  }

  get(path: string, headers?: Record<string, string>) {
    return this.request("GET", path, { headers });
  }
  post(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request("POST", path, { body, headers });
  }
  put(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request("PUT", path, { body, headers });
  }
  patch(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request("PATCH", path, { body, headers });
  }
  delete(path: string, headers?: Record<string, string>) {
    return this.request("DELETE", path, { headers });
  }
}
