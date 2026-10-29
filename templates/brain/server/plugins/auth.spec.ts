import { autoMountAuth, getH3App } from "@agent-native/core/server";
import { H3 } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAuthPlugin: vi.fn((options) => ({
    kind: "auth-plugin",
    options,
  })),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  createAuthPlugin: mocks.createAuthPlugin,
}));

const sweep = vi.hoisted(() => ({
  sync: vi.fn(async () => ({ checked: 1, results: [] })),
  queue: vi.fn(async () => ({ processed: [], deferred: [], failed: [] })),
  expire: vi.fn(async () => 0),
}));

vi.mock("../../jobs/process-ingest-queue.js", () => ({
  processBrainIngestQueueOnce: sweep.queue,
}));
vi.mock("../jobs/sync-sources.js", () => ({
  syncDueBrainSourcesOnce: sweep.sync,
}));
vi.mock("../lib/brain.js", () => ({
  expireSensitivityQuarantines: sweep.expire,
}));

import queueHandler from "../routes/api/brain/queue/run.post.js";
import authPlugin from "./auth.js";

describe("brain auth plugin", () => {
  it("keeps workspace pages private while allowing the public home", () => {
    expect(authPlugin).toMatchObject({ kind: "auth-plugin" });
    expect(mocks.createAuthPlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceAppAudience: "internal",
        workspaceAppPublicPaths: ["/"],
        publicPaths: [
          "/api/_agent-native/brain/ingest",
          "/api/brain/queue/run",
        ],
      }),
    );
  });
});

async function queueApp() {
  const app = new H3();
  const options = mocks.createAuthPlugin.mock.calls[0]![0];
  await autoMountAuth(getH3App({ h3: app }), {
    getSession: async () => null,
    publicPaths: options.publicPaths,
  });
  app.post("/api/brain/queue/run", queueHandler);
  app.post("/api/brain/private-probe", () => ({ private: true }));
  return app;
}

function queueRequest(authorization?: string, path = "/api/brain/queue/run") {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      ...(authorization ? { authorization } : {}),
    },
  });
}

describe("Brain queue sweep authentication", () => {
  beforeEach(() => {
    sweep.sync.mockClear();
    sweep.queue.mockClear();
    sweep.expire.mockClear();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_DISABLED", "");
    vi.stubEnv("ACCESS_TOKEN", "");
    vi.stubEnv("BRAIN_JOBS_SECRET", "");
    globalThis.__AGENT_NATIVE_BRAIN_SCHEDULED_RUNTIME__ = undefined;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    globalThis.__AGENT_NATIVE_BRAIN_SCHEDULED_RUNTIME__ = undefined;
  });

  it("lets the trusted scheduled runtime sync without a browser session", async () => {
    globalThis.__AGENT_NATIVE_BRAIN_SCHEDULED_RUNTIME__ = true;
    const app = await queueApp();

    const response = await app.request(queueRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(sweep.sync).toHaveBeenCalledWith({ system: true, limit: 5 });
    expect(sweep.queue).toHaveBeenCalledOnce();
    expect(sweep.expire).toHaveBeenCalledOnce();
  });

  it("rejects public calls when no scheduler secret is configured", async () => {
    const app = await queueApp();

    const response = await app.request(queueRequest());

    expect(response.status).toBe(503);
    expect(sweep.sync).not.toHaveBeenCalled();
    expect(sweep.queue).not.toHaveBeenCalled();
    expect(sweep.expire).not.toHaveBeenCalled();
  });

  it.each([undefined, "Bearer wrong-secret", "Bearer test-scheduler-secrex"])(
    "rejects an untrusted scheduler call with authorization %s",
    async (authorization) => {
      vi.stubEnv("BRAIN_JOBS_SECRET", "test-scheduler-secret");
      const app = await queueApp();

      const response = await app.request(queueRequest(authorization));

      expect(response.status).toBe(401);
      expect(sweep.sync).not.toHaveBeenCalled();
      expect(sweep.queue).not.toHaveBeenCalled();
      expect(sweep.expire).not.toHaveBeenCalled();
    },
  );

  it("accepts a valid scheduler secret without a browser session", async () => {
    vi.stubEnv("BRAIN_JOBS_SECRET", "test-scheduler-secret");
    const app = await queueApp();

    const response = await app.request(
      queueRequest("Bearer test-scheduler-secret"),
    );

    expect(response.status).toBe(200);
    expect(sweep.sync).toHaveBeenCalledOnce();
  });

  it("keeps unrelated Brain API routes behind session authentication", async () => {
    globalThis.__AGENT_NATIVE_BRAIN_SCHEDULED_RUNTIME__ = true;
    const app = await queueApp();

    const response = await app.request(
      queueRequest(undefined, "/api/brain/private-probe"),
    );

    expect(response.status).toBe(401);
    expect(sweep.sync).not.toHaveBeenCalled();
  });
});
