import assert from "node:assert/strict";

import type { BrowserContext, Page } from "@playwright/test";
import { test } from "vitest";

import { Daily } from "../../e2e/daily/fixtures.js";

test("settles admitted creations and attempts all cleanup after failures", async () => {
  let release: () => void = () => {
    throw new Error("delay was not initialized");
  };
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const removed: string[] = [];
  let closed = false;
  const page = {
    close: async () => {
      closed = true;
      throw new Error("page close failed");
    },
  } as unknown as Page;
  const context = {
    request: {
      post: async (_url: string, { data }: { data: { title: string } }) => {
        if (data.title === "failed") throw new Error("creation failed");
        if (data.title === "delayed") await delayed;
        return {
          ok: () => true,
          status: () => 200,
          text: async () => JSON.stringify({ id: data.title }),
        };
      },
    },
  } as unknown as BrowserContext;
  const daily = new Daily(page, context, {
    base: "http://example.test",
    fake: "",
    cookie: "",
  });
  daily.cleanupProject = async (id) => {
    removed.push(id);
    if (id === "first") throw new Error("cleanup failed");
  };
  await daily.createProject("before");
  await daily.createProject("first");
  const creates = Promise.all([
    daily.createProject("failed"),
    daily.createProject("delayed"),
  ]);
  await assert.rejects(creates, /creation failed/);
  const cleanup = daily.cleanup();
  release();
  let cleanupError: unknown;
  try {
    await cleanup;
  } catch (error) {
    cleanupError = error;
  }
  assert.equal(closed, true);
  assert.deepEqual(removed, ["before", "first", "delayed"]);
  assert.ok(cleanupError instanceof AggregateError);
  assert.deepEqual(
    cleanupError.errors.map((item: Error) => item.message),
    ["page close failed", "cleanup failed"],
  );
});

test("waits for a late creation before deleting projects", async () => {
  let release: () => void = () => {
    throw new Error("delay was not initialized");
  };
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const removed: string[] = [];
  const page = { close: async () => {} } as unknown as Page;
  const context = {
    request: {
      post: async (_url: string, { data }: { data: { title: string } }) => {
        if (data.title === "failed") throw new Error("creation failed");
        await delayed;
        return {
          ok: () => true,
          status: () => 200,
          text: async () => JSON.stringify({ id: "late" }),
        };
      },
    },
  } as unknown as BrowserContext;
  const daily = new Daily(page, context, {
    base: "http://example.test",
    fake: "",
    cookie: "",
  });
  daily.cleanupProject = async (id) => {
    removed.push(id);
  };
  await assert.rejects(
    Promise.all([
      daily.createProject("failed"),
      daily.createProject("delayed"),
    ]),
    /creation failed/,
  );
  const cleanup = daily.cleanup();
  await new Promise<void>((resolve) => setImmediate(resolve));
  release();
  await cleanup;
  assert.deepEqual(removed, ["late"]);
});

test("reports a creation that fails while cleanup waits", async () => {
  let release: () => void = () => {
    throw new Error("delay was not initialized");
  };
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const page = { close: async () => {} } as unknown as Page;
  const context = {
    request: {
      post: async () => {
        await delayed;
        throw new Error("late creation failed");
      },
    },
  } as unknown as BrowserContext;
  const daily = new Daily(page, context, {
    base: "http://example.test",
    fake: "",
    cookie: "",
  });
  const creation = daily.createProject("late");
  const cleanup = daily.cleanup();
  release();
  await assert.rejects(creation, /late creation failed/);
  await assert.rejects(cleanup, (error: AggregateError) => {
    assert.deepEqual(
      error.errors.map((item: Error) => item.message),
      ["late creation failed"],
    );
    return true;
  });
});
