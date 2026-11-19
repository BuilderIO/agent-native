import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  emitNetlifyWorkspaceKeepWarmFunction,
  NETLIFY_WORKSPACE_KEEP_WARM_FUNCTION_NAME,
  renderWorkspaceKeepWarmEntry,
  resolveKeepWarmConcurrency,
} from "./workspace-keep-warm.js";

const KEEP_WARM_ENV = [
  "AGENT_NATIVE_ENABLE_KEEP_WARM",
  "AGENT_NATIVE_DISABLE_KEEP_WARM",
  "AGENT_NATIVE_KEEP_WARM_SCHEDULE",
  "AGENT_NATIVE_KEEP_WARM_CONCURRENCY",
] as const;

describe("workspace keep-warm", () => {
  let tmp: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "an-ws-keep-warm-"));
    for (const key of KEEP_WARM_ENV) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    for (const key of KEEP_WARM_ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.unstubAllGlobals();
  });

  it("defaults to one instance per app and rejects invalid concurrency", () => {
    expect(resolveKeepWarmConcurrency({})).toBe(1);
    expect(
      resolveKeepWarmConcurrency({ AGENT_NATIVE_KEEP_WARM_CONCURRENCY: "12" }),
    ).toBe(12);
    for (const raw of ["0", "51", "2.5", "many"]) {
      expect(() =>
        resolveKeepWarmConcurrency({ AGENT_NATIVE_KEEP_WARM_CONCURRENCY: raw }),
      ).toThrow(/AGENT_NATIVE_KEEP_WARM_CONCURRENCY/);
    }
  });

  it("emits nothing unless keep-warm is enabled", () => {
    expect(emitNetlifyWorkspaceKeepWarmFunction(tmp, ["mail"])).toBe(false);
    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  it("emits one scheduled function covering every app", () => {
    process.env.AGENT_NATIVE_ENABLE_KEEP_WARM = "1";
    process.env.AGENT_NATIVE_KEEP_WARM_SCHEDULE = "*/3 * * * *";
    process.env.AGENT_NATIVE_KEEP_WARM_CONCURRENCY = "4";

    expect(
      emitNetlifyWorkspaceKeepWarmFunction(tmp, ["dispatch", "fleet"]),
    ).toBe(true);
    const entry = fs.readFileSync(
      path.join(
        tmp,
        NETLIFY_WORKSPACE_KEEP_WARM_FUNCTION_NAME,
        `${NETLIFY_WORKSPACE_KEEP_WARM_FUNCTION_NAME}.mjs`,
      ),
      "utf8",
    );
    expect(entry).toContain(
      `["/dispatch/_agent-native/health","/fleet/_agent-native/health"]`,
    );
    expect(entry).toContain("const CONCURRENCY = 4;");
    expect(entry).toContain(`schedule: "*/3 * * * *"`);
  });

  it("warms the health route under a custom framework route prefix", () => {
    process.env.AGENT_NATIVE_ENABLE_KEEP_WARM = "1";
    expect(
      emitNetlifyWorkspaceKeepWarmFunction(tmp, ["fleet"], "/_platform"),
    ).toBe(true);
    const entry = fs.readFileSync(
      path.join(
        tmp,
        NETLIFY_WORKSPACE_KEEP_WARM_FUNCTION_NAME,
        `${NETLIFY_WORKSPACE_KEEP_WARM_FUNCTION_NAME}.mjs`,
      ),
      "utf8",
    );
    expect(entry).toContain(`["/fleet/_platform/health"]`);
  });

  it("respects the keep-warm kill switch", () => {
    process.env.AGENT_NATIVE_ENABLE_KEEP_WARM = "1";
    process.env.AGENT_NATIVE_DISABLE_KEEP_WARM = "1";
    expect(emitNetlifyWorkspaceKeepWarmFunction(tmp, ["fleet"])).toBe(false);
  });

  it("sends overlapping health requests to every app when it runs", async () => {
    const file = path.join(tmp, "entry.mjs");
    fs.writeFileSync(
      file,
      renderWorkspaceKeepWarmEntry({
        apps: ["dispatch", "fleet", "qr"],
        concurrency: 3,
        schedule: "* * * * *",
      }),
    );
    let inFlight = 0;
    let peakInFlight = 0;
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        urls.push(url.toString());
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return new Response("{}", {
          status: url.pathname.startsWith("/qr") ? 503 : 200,
        });
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const mod = await import(pathToFileURL(file).href);
    const response = await mod.default(
      new Request("https://workspace.example.com/.netlify/functions/x"),
    );

    expect(response.status).toBe(204);
    expect(
      urls.filter((u) => u.endsWith("/fleet/_agent-native/health")),
    ).toHaveLength(3);
    expect(
      urls.filter((u) => u.endsWith("/dispatch/_agent-native/health")),
    ).toHaveLength(3);
    expect(
      urls.every((u) => u.startsWith("https://workspace.example.com/")),
    ).toBe(true);
    // The requests for one app overlap, so they land on separate instances.
    expect(peakInFlight).toBeGreaterThanOrEqual(3);
    expect(mod.config.schedule).toBe("* * * * *");
    // A short pool is reported, not counted as warm.
    expect(log).toHaveBeenCalledWith(
      "[agent-native-keep-warm] Warmed",
      "6/9",
      "health requests across",
      3,
      "apps",
    );
    expect(warn).toHaveBeenCalledWith(
      "[agent-native-keep-warm] Pools below target:",
      "/qr/_agent-native/health 0/3",
    );
  });

  it("skips apps it can't reach before the run deadline", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const file = path.join(tmp, "entry-deadline.mjs");
    fs.writeFileSync(
      file,
      renderWorkspaceKeepWarmEntry({
        apps: Array.from({ length: 30 }, (_, i) => `app${i}`),
        concurrency: 1,
        schedule: "* * * * *",
      }),
    );
    // Each request "takes" 13s, so two waves of 12 apps fit in 25s.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const startedAt = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 0));
        vi.setSystemTime(Math.max(Date.now(), startedAt + 13_000));
        return new Response("{}", { status: 200 });
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const mod = await import(pathToFileURL(file).href);
      const response = await mod.default(
        new Request("https://workspace.example.com/x"),
      );
      expect(response.status).toBe(204);
      expect(fetch).toHaveBeenCalledTimes(24);
      const skippedCall = warn.mock.calls.find(
        (call) =>
          call[0] === "[agent-native-keep-warm] Skipped at the run deadline:",
      );
      expect(String(skippedCall?.[1]).split(", ")).toHaveLength(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails the run only when no app could be warmed", async () => {
    const file = path.join(tmp, "entry-fail.mjs");
    fs.writeFileSync(
      file,
      renderWorkspaceKeepWarmEntry({
        apps: ["fleet"],
        concurrency: 2,
        schedule: "* * * * *",
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 503 })),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const mod = await import(pathToFileURL(file).href);
    await expect(
      mod.default(new Request("https://workspace.example.com/x")),
    ).rejects.toThrow(/Every app failed to warm/);
  });
});
