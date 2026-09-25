import fs from "fs";
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
  (
    plugin.configResolved as (config: {
      command: "build";
      mode: string;
      root: string;
    }) => void
  )({ command: "build", mode: "development", root });
  await (plugin.configureServer as (server: unknown) => Promise<void> | void)(
    fake.server,
  );
  const fire = (event: string, file: string) => {
    for (const handler of fake.handlers.get(event) ?? []) handler(file);
  };
  return { fake, fire };
}

it("loads mode-specific environment aliases for the agents bundle", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-bundle-env-"));
  const instructionPath = path.join(root, "custom", "AGENTS.md");
  fs.mkdirSync(path.dirname(instructionPath), { recursive: true });
  fs.writeFileSync(instructionPath, "# Custom runtime instructions\n");
  fs.writeFileSync(
    path.join(root, ".env.production"),
    "AGENT_NATIVE_CONFIG_INSTRUCTIONS_RUNTIME=custom/AGENTS.md\n",
  );

  const plugin = agentsBundlePlugin();
  const fake = createFakeServer();
  (
    plugin.configResolved as (config: {
      command: "build";
      mode: string;
      root: string;
    }) => void
  )({ command: "build", mode: "production", root });
  await (plugin.configureServer as (server: unknown) => Promise<void> | void)(
    fake.server,
  );

  expect(fake.server.watcher.add).toHaveBeenCalledWith(instructionPath);
  fs.rmSync(root, { recursive: true, force: true });
});

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

    vi.advanceTimersByTime(600);
    expect(fake.invalidateModule).not.toHaveBeenCalled();
    expect(fake.send).not.toHaveBeenCalled();
  });

  it("invalidates on non-SKILL.md reference files inside a skills directory", async () => {
    // Reference sub-files (e.g. references/*.md) are now read into the
    // bundle alongside SKILL.md, so editing one in dev must rebuild the
    // bundle the same way production build does — narrower matching here
    // would let dev silently serve stale reference content.
    const { fake, fire } = await setupPlugin(root);

    fire(
      "change",
      path.join(root, ".agents", "skills", "alpha", "references", "notes.md"),
    );

    expect(fake.invalidateModule).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(600);
    expect(fake.send).toHaveBeenCalledTimes(1);
  });
});
