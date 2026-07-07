import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { agentsBundlePlugin } from "./agents-bundle-plugin.js";

type WatcherHandler = (file: string) => void;

function createFakeServer() {
  const handlers = new Map<string, WatcherHandler[]>();
  const send = vi.fn();
  const invalidateModule = vi.fn();
  const module = { id: "\0virtual:agents-bundle" };
  return {
    handlers,
    send,
    invalidateModule,
    server: {
      watcher: {
        add: vi.fn(),
        on: (event: string, handler: WatcherHandler) => {
          const list = handlers.get(event) ?? [];
          list.push(handler);
          handlers.set(event, list);
        },
      },
      moduleGraph: {
        getModuleById: vi.fn(() => module),
        invalidateModule,
      },
      ws: { send },
      httpServer: { once: vi.fn() },
    },
  };
}

async function setupPlugin(root: string) {
  const plugin = agentsBundlePlugin();
  const fake = createFakeServer();
  (plugin.configResolved as (config: { root: string }) => void)({ root });
  await (plugin.configureServer as (server: unknown) => Promise<void> | void)(
    fake.server,
  );
  const fire = (event: string, file: string) => {
    for (const handler of fake.handlers.get(event) ?? []) handler(file);
  };
  return { fake, fire };
}

describe("agentsBundlePlugin full-reload coalescing", () => {
  const root = path.join(os.tmpdir(), "agents-bundle-plugin-spec-root");
  const skillFile = (name: string) =>
    path.join(root, ".agents", "skills", name, "SKILL.md");

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces rapid skill-file writes into a single full-reload", async () => {
    const { fake, fire } = await setupPlugin(root);

    fire("change", path.join(root, "AGENTS.md"));
    fire("unlink", skillFile("alpha"));
    fire("add", skillFile("alpha"));
    fire("change", skillFile("beta"));

    // Module invalidation happens per event; the browser reload does not.
    expect(fake.invalidateModule).toHaveBeenCalledTimes(4);
    expect(fake.send).not.toHaveBeenCalled();

    vi.advanceTimersByTime(600);
    expect(fake.send).toHaveBeenCalledTimes(1);
    expect(fake.send).toHaveBeenCalledWith({ type: "full-reload" });
  });

  it("sends another full-reload for a later, separate write burst", async () => {
    const { fake, fire } = await setupPlugin(root);

    fire("change", skillFile("alpha"));
    vi.advanceTimersByTime(600);
    expect(fake.send).toHaveBeenCalledTimes(1);

    fire("change", skillFile("beta"));
    vi.advanceTimersByTime(600);
    expect(fake.send).toHaveBeenCalledTimes(2);
  });

  it("ignores files outside AGENTS.md and the skills directories", async () => {
    const { fake, fire } = await setupPlugin(root);

    fire("change", path.join(root, "app", "root.tsx"));
    fire("change", path.join(root, ".agents", "skills", "alpha", "notes.md"));

    vi.advanceTimersByTime(600);
    expect(fake.invalidateModule).not.toHaveBeenCalled();
    expect(fake.send).not.toHaveBeenCalled();
  });
});
