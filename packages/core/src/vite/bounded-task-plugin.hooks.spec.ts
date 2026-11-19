import { beforeEach, describe, expect, it, vi } from "vitest";

import { boundedTaskSourcePlugin } from "./bounded-task-plugin.js";

const bundleBoundedTaskSource = vi.hoisted(() => vi.fn());
vi.mock("../collab/bounded-task-bundle.js", () => ({
  bundleBoundedTaskSource,
}));

const RESOLVED_PREFIX = "\0agent-native-bounded-task:";

function context(resolved: { id: string; external?: boolean } | null) {
  const watched: string[] = [];
  const resolve = vi.fn(async () => resolved);
  return {
    watched,
    resolve,
    addWatchFile(file: string) {
      watched.push(file);
    },
  };
}

describe("boundedTaskSourcePlugin hooks", () => {
  beforeEach(() => {
    bundleBoundedTaskSource.mockReset();
  });

  it("lets the bundler skip every import that is not a ?bounded-task request", () => {
    const { resolveId, load } = boundedTaskSourcePlugin();
    expect(resolveId.filter.id.test("./tasks.ts?bounded-task")).toBe(true);
    expect(resolveId.filter.id.test("./tasks.ts")).toBe(false);
    expect(resolveId.filter.id.test("./tasks.ts?bounded-tasks")).toBe(false);
    expect(resolveId.filter.id.test("./tasks.ts?bounded-task&raw")).toBe(false);
    expect(resolveId.filter.id.test("./tasks.ts?raw")).toBe(false);
    expect(load.filter.id.test(`${RESOLVED_PREFIX}/app/tasks.ts`)).toBe(true);
    expect(load.filter.id.test("/app/tasks.ts")).toBe(false);
    expect(load.filter.id.test(`/app/${RESOLVED_PREFIX}tasks.ts`)).toBe(false);
  });

  it("resolves the module without the query and through the other resolvers", async () => {
    const { resolveId } = boundedTaskSourcePlugin();
    const ctx = context({ id: "/app/server/tasks.ts?v=3" });
    await expect(
      resolveId.handler.call(
        ctx,
        "./tasks.ts?bounded-task",
        "/app/server/live.ts",
      ),
    ).resolves.toBe(`${RESOLVED_PREFIX}/app/server/tasks.ts`);
    expect(ctx.resolve).toHaveBeenCalledExactlyOnceWith(
      "./tasks.ts",
      "/app/server/live.ts",
      { skipSelf: true },
    );
  });

  it("leaves other imports alone even where the bundler ignores filters", async () => {
    const { resolveId, load } = boundedTaskSourcePlugin();
    const ctx = context({ id: "/app/tasks.ts" });
    await expect(
      resolveId.handler.call(ctx, "./tasks.ts", undefined),
    ).resolves.toBeNull();
    await expect(load.handler.call(ctx, "/app/tasks.ts")).resolves.toBeNull();
    expect(ctx.resolve).not.toHaveBeenCalled();
    expect(bundleBoundedTaskSource).not.toHaveBeenCalled();
  });

  it("fails on a task module that is missing or external", async () => {
    const { resolveId } = boundedTaskSourcePlugin();
    await expect(
      resolveId.handler.call(
        context(null),
        "./missing.ts?bounded-task",
        "/app/x.ts",
      ),
    ).rejects.toThrow(
      new Error(
        "Cannot resolve bounded task module ./missing.ts from /app/x.ts",
      ),
    );
    await expect(
      resolveId.handler.call(
        context({ id: "tasks-pkg", external: true }),
        "tasks-pkg?bounded-task",
        undefined,
      ),
    ).rejects.toThrow(
      new Error("Cannot resolve bounded task module tasks-pkg"),
    );
  });

  it("loads the bundled source, watching each of its inputs", async () => {
    bundleBoundedTaskSource.mockResolvedValue({
      kind: "bounded-task-source",
      name: "live.copy-tasks",
      code: "export const tasks = {};",
      inputs: ["/app/live.copy-tasks.ts", "/app/shared.ts"],
    });
    const { load } = boundedTaskSourcePlugin();
    const ctx = context(null);
    const code = await load.handler.call(
      ctx,
      `${RESOLVED_PREFIX}/app/live.copy-tasks.ts`,
    );
    expect(bundleBoundedTaskSource).toHaveBeenCalledExactlyOnceWith(
      "/app/live.copy-tasks.ts",
      { name: "live.copy-tasks" },
    );
    expect(ctx.watched).toEqual(["/app/live.copy-tasks.ts", "/app/shared.ts"]);
    expect(code).toBe(
      `export default Object.freeze(${JSON.stringify({
        kind: "bounded-task-source",
        name: "live.copy-tasks",
        code: "export const tasks = {};",
      })});\n`,
    );
  });
});
