import { afterEach, describe, expect, it, vi } from "vitest";

import * as dbClient from "../db/client.js";
import {
  installDevDatabaseCloseHook,
  listenForDevDatabaseLifecycle,
} from "./dev-database-lifecycle.js";

function workerHot() {
  const listeners = new Map<string, (payload?: unknown) => void>();
  const sent: Array<{ event: string; payload?: unknown }> = [];
  let listenersAtFirstReady: string[] | undefined;
  const sentEvent = new EventTarget();
  return {
    sent,
    listenersAtFirstReady: () => listenersAtFirstReady,
    on(event: string, listener: (payload?: unknown) => void) {
      listeners.set(event, listener);
    },
    send(event: string, payload?: unknown) {
      if (event === "agent-native:dev-database-ready") {
        listenersAtFirstReady ??= [...listeners.keys()];
      }
      sent.push(payload === undefined ? { event } : { event, payload });
      sentEvent.dispatchEvent(new Event(event));
    },
    emit(event: string, payload?: unknown) {
      const listener = listeners.get(event);
      if (!listener) throw new Error(`No worker listener for ${event}`);
      listener(payload);
    },
    nextSent(event: string) {
      return new Promise<void>((resolve) =>
        sentEvent.addEventListener(event, () => resolve(), { once: true }),
      );
    },
  };
}

function stubPgliteClient() {
  vi.spyOn(dbClient, "beginPgliteClientShutdown").mockImplementation(() => {});
  vi.spyOn(dbClient, "waitForPgliteClientOperations").mockResolvedValue(
    undefined,
  );
  vi.spyOn(dbClient, "closeDbExec").mockResolvedValue(undefined);
}

describe("dev database lifecycle listeners", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reports ready once its close and resume listeners exist, and on every check", () => {
    const hot = workerHot();

    listenForDevDatabaseLifecycle(hot);

    expect(hot.sent).toEqual([{ event: "agent-native:dev-database-ready" }]);
    expect(hot.listenersAtFirstReady()).toEqual(
      expect.arrayContaining([
        "agent-native:dev-database-close",
        "agent-native:dev-database-resume",
      ]),
    );

    hot.emit("agent-native:dev-database-ready-check");

    expect(hot.sent).toEqual([
      { event: "agent-native:dev-database-ready" },
      { event: "agent-native:dev-database-ready" },
    ]);
  });

  it("announces that it is closing before it acknowledges a close request", async () => {
    stubPgliteClient();
    const hot = workerHot();
    listenForDevDatabaseLifecycle(hot);
    const closed = hot.nextSent("agent-native:dev-database-closed");

    hot.emit("agent-native:dev-database-close", { requestId: "close-1" });
    await closed;

    expect(hot.sent.slice(1)).toEqual([
      {
        event: "agent-native:dev-database-closing",
        payload: { requestId: "close-1" },
      },
      {
        event: "agent-native:dev-database-closed",
        payload: { requestId: "close-1" },
      },
    ]);
  });

  it("closes the dev database on Nitro shutdown, where no request asked for it", async () => {
    vi.stubEnv("NODE_ENV", "development");
    stubPgliteClient();
    const closeHooks: Array<() => Promise<void>> = [];
    installDevDatabaseCloseHook({
      hooks: {
        hook(name: string, handler: () => Promise<void>) {
          if (name === "close") closeHooks.push(handler);
        },
      },
    });
    expect(closeHooks).toHaveLength(1);
    const [closeHook] = closeHooks;

    await expect(closeHook()).resolves.toBeUndefined();
    expect(dbClient.beginPgliteClientShutdown).toHaveBeenCalledOnce();
  });
});
