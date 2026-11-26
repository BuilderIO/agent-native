// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ACTION_BATCH_ACTION_NAME } from "../shared/action-batch.js";
import { ACTION_SELF_REFRESHING_META_KEY } from "./action-query-scope.js";
import { useActionMutation, useActionQuery } from "./use-action.js";

const reads: Record<string, number> = {};
const roots: ReturnType<typeof createRoot>[] = [];

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots.length = 0;
  for (const key of Object.keys(reads)) delete reads[key];
  vi.unstubAllGlobals();
});

async function mountWrite(resources?: string[]) {
  const ok = (body: unknown) =>
    new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
    });
  const count = (name: string) => {
    reads[name] = (reads[name] ?? 0) + 1;
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (
        init?.method === "POST" &&
        url.endsWith(`/${ACTION_BATCH_ACTION_NAME}`)
      ) {
        const { requests } = JSON.parse(String(init.body));
        return ok({
          results: requests.map((request: { action: string }) => {
            count(request.action);
            return { status: 200, body: { ok: true } };
          }),
        });
      }
      if (init?.method !== "POST") {
        const name = /actions\/([\w-]+)/.exec(url)?.[1];
        if (name) count(name);
      }
      return ok({ ok: true });
    }),
  );
  let write: () => Promise<unknown> = () =>
    Promise.reject(new Error("probe not rendered"));
  function Probe() {
    useActionQuery("plain-read" as never, undefined, {
      retry: false,
      resources: ["tables"],
    } as never);
    useActionQuery("other-read" as never, undefined, {
      retry: false,
      resources: ["views"],
    } as never);
    useActionQuery("unscoped-read" as never, undefined, { retry: false });
    useActionQuery("self-read" as never, undefined, {
      retry: false,
      meta: { [ACTION_SELF_REFRESHING_META_KEY]: true },
    });
    const mutation = useActionMutation(
      "save-thing" as never,
      resources ? ({ resources } as never) : undefined,
    );
    write = () => mutation.mutateAsync({} as never);
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <Probe />
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() => {
    for (const name of [
      "plain-read",
      "other-read",
      "unscoped-read",
      "self-read",
    ])
      expect(reads[name]).toBe(1);
  });
  return write;
}

describe("action write invalidation and self-refreshing reads", () => {
  it("refetches every read except a self-refreshing one when a write names no resources", async () => {
    const write = await mountWrite();
    await act(async () => {
      await write();
    });
    await vi.waitFor(() => {
      expect(reads["plain-read"]).toBe(2);
      expect(reads["other-read"]).toBe(2);
      expect(reads["unscoped-read"]).toBe(2);
    });
    expect(reads["self-read"]).toBe(1);
  });

  it("refetches only reads that name a changed resource, plus unscoped reads, when a write names resources", async () => {
    const write = await mountWrite(["tables"]);
    await act(async () => {
      await write();
    });
    await vi.waitFor(() => {
      expect(reads["plain-read"]).toBe(2);
      expect(reads["unscoped-read"]).toBe(2);
    });
    expect(reads["other-read"]).toBe(1);
    expect(reads["self-read"]).toBe(1);
  });
});
