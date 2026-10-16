import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Resolved by the plugin through the shared vitest base config.
import fixtureSource from "../collab/__fixtures__/live-copy-tasks.ts?bounded-task";
import { createBoundedTaskRunner } from "../collab/bounded-tasks.js";
import { LIVE_COPY_TASK } from "../collab/live-copy-tasks.js";
import { boundedTaskSourcePlugin } from "./bounded-task-plugin.js";

const fixture = fileURLToPath(
  new URL("../collab/__fixtures__/live-copy-tasks.ts", import.meta.url),
);

function context() {
  const watched: string[] = [];
  return {
    watched,
    async resolve(source: string) {
      return { id: source === "./live-copy-tasks.ts" ? fixture : source };
    },
    addWatchFile(file: string) {
      watched.push(file);
    },
  };
}

describe("boundedTaskSourcePlugin", () => {
  it("turns a ?bounded-task import into a runnable task source", async () => {
    const plugin = boundedTaskSourcePlugin();
    const ctx = context();
    const id = await plugin.resolveId.call(
      ctx,
      "./live-copy-tasks.ts?bounded-task",
      "/app/server/live-copy.ts",
    );
    expect(id).toBe(`\0agent-native-bounded-task:${fixture}`);
    await expect(
      plugin.resolveId.call(ctx, "./live-copy-tasks.ts", undefined),
    ).resolves.toBeNull();

    const code = await plugin.load.call(ctx, id!);
    const prefix = "export default Object.freeze(";
    expect(code?.startsWith(prefix)).toBe(true);
    const source = JSON.parse(
      code!.slice(prefix.length, code!.lastIndexOf(")")),
    );
    expect(source).toMatchObject({
      kind: "bounded-task-source",
      name: "live-copy-tasks",
    });
    expect(ctx.watched).toContain(fixture);

    const runner = createBoundedTaskRunner({ source });
    try {
      await expect(
        runner.run(LIVE_COPY_TASK.read, {
          state: new Uint8Array(0),
          derive: false,
          field: "default",
          maxStateBytes: 1024,
        }),
      ).resolves.toEqual({ kind: "unseeded" });
    } finally {
      await runner.close();
    }
  });

  it("resolves ?bounded-task imports in app tests through the vitest base config", async () => {
    expect(fixtureSource).toMatchObject({
      kind: "bounded-task-source",
      name: "live-copy-tasks",
    });
    const runner = createBoundedTaskRunner({ source: fixtureSource });
    try {
      await expect(
        runner.run(LIVE_COPY_TASK.read, {
          state: new Uint8Array(0),
          derive: false,
          field: "default",
          maxStateBytes: 1024,
        }),
      ).resolves.toEqual({ kind: "unseeded" });
    } finally {
      await runner.close();
    }
  });

  it("fails the build when the task module cannot be resolved", async () => {
    const plugin = boundedTaskSourcePlugin();
    const ctx = { ...context(), resolve: async () => null };
    await expect(
      plugin.resolveId.call(ctx, "./missing.ts?bounded-task", "/app/x.ts"),
    ).rejects.toThrow(/Cannot resolve bounded task module \.\/missing\.ts/);
  });
});
