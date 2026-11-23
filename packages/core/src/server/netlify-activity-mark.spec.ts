import type { H3Event } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetAppConfigForTests } from "../app-config/store.js";
import { INTEGRATION_RETRY_SWEEP_PATH } from "../integrations/integration-durable-dispatch-config.js";
import { __resetNetlifyActivityMarkForTests } from "../jobs/netlify-wake-marker.js";
import { RECURRING_JOBS_SWEEP_PATH } from "../jobs/scheduler-dispatch.js";
import { installNetlifyActivityMarkHook } from "./netlify-activity-mark.js";

const T0 = Date.parse("2026-11-20T12:00:00.000Z");
const BLOBS_CONTEXT = Buffer.from(
  JSON.stringify({
    siteID: "site-1",
    token: "blobs-token",
    edgeURL: "https://edge.blobs.test",
    uncachedEdgeURL: "https://uncached.blobs.test",
  }),
).toString("base64");

type RequestHook = (event: H3Event) => Promise<void>;

let writes: Map<string, string>;

beforeEach(() => {
  writes = new Map();
  vi.stubEnv("NETLIFY", "true");
  vi.stubEnv("NETLIFY_BLOBS_CONTEXT", BLOBS_CONTEXT);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (init?.method === "PUT") writes.set(url.pathname, String(init.body));
      return new Response(null, { status: 200 });
    }),
  );
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  __resetNetlifyActivityMarkForTests();
  resetAppConfigForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetAppConfigForTests();
});

const install = (app: object = {}) => {
  const hooks: RequestHook[] = [];
  installNetlifyActivityMarkHook(
    Object.assign(app, {
      hooks: {
        hook: (_name: "request", handler: RequestHook) => hooks.push(handler),
      },
    }),
  );
  return hooks;
};

const visit = (hooks: RequestHook[], pathname: string) => {
  const marks: Array<Promise<unknown>> = [];
  const event = {
    url: new URL(`https://my-app.netlify.app${pathname}`),
    req: { waitUntil: (promise: Promise<unknown>) => marks.push(promise) },
  } as unknown as H3Event;
  hooks.forEach((hook) => void hook(event));
  return marks;
};

describe("installNetlifyActivityMarkHook", () => {
  it("marks visits, not the sweep's own handoff or the integration recovery cron", async () => {
    const hooks = install();

    expect(visit(hooks, RECURRING_JOBS_SWEEP_PATH)).toHaveLength(0);
    expect(visit(hooks, INTEGRATION_RETRY_SWEEP_PATH)).toHaveLength(0);

    const marks = visit(hooks, "/inbox");
    expect(marks).toHaveLength(1);
    await Promise.all(marks);
    expect([...writes]).toEqual([
      [
        "/site-1/site:agent-native-recurring-jobs/activity",
        JSON.stringify({ at: T0 }),
      ],
    ]);
  });

  it("hands the write to Netlify's own waitUntil when the request has none", async () => {
    const hooks = install();
    const marks: Array<Promise<unknown>> = [];
    const storeKey = Symbol.for("@netlify/functions/request-context-store");
    const globals = globalThis as Record<symbol, unknown>;
    globals[storeKey] = {
      getStore: () => ({
        context: {
          waitUntil: (promise: Promise<unknown>) => {
            marks.push(promise);
          },
        },
      }),
    };
    try {
      const event = {
        url: new URL("https://my-app.netlify.app/inbox"),
        req: {},
      } as unknown as H3Event;
      await Promise.all(hooks.map((hook) => hook(event)));

      expect(marks).toHaveLength(1);
      await Promise.all(marks);
      expect([...writes.values()]).toEqual([JSON.stringify({ at: T0 })]);
    } finally {
      delete globals[storeKey];
    }
  });

  it("marks nothing on a Workspace deploy", () => {
    vi.stubEnv(
      "AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "mail", path: "/mail" }]),
    );
    resetAppConfigForTests();

    expect(visit(install(), "/mail/inbox")).toHaveLength(0);
    expect(writes.size).toBe(0);
  });

  it("installs once per app", () => {
    const app = {};
    expect(install(app)).toHaveLength(1);
    expect(install(app)).toHaveLength(0);
  });

  it("is not installed in the background function", () => {
    const globals = globalThis as Record<string, unknown>;
    globals.__AGENT_NATIVE_BACKGROUND_RUNTIME__ = true;
    try {
      expect(install()).toHaveLength(0);
    } finally {
      delete globals.__AGENT_NATIVE_BACKGROUND_RUNTIME__;
    }
  });

  it("is not installed off Netlify", () => {
    vi.stubEnv("NETLIFY", "");
    vi.stubEnv("SITE_ID", "");
    expect(install()).toHaveLength(0);
  });

  it("warns instead of failing the request when the event can't be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [hook] = install();

    await expect(hook({} as H3Event)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "[recurring-jobs] Could not mark request activity for the idle sweep:",
      expect.any(String),
    );
    expect(writes.size).toBe(0);
  });
});
