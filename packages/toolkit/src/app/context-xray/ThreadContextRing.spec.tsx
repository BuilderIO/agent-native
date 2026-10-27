// @vitest-environment happy-dom

import type { ContextManifest } from "@agent-native/core/shared/context-xray";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { threadHasFinishedReply } from "./use-thread-context-usage.js";

const queries = vi.hoisted(
  () =>
    new Map<string, { data?: unknown; isError?: boolean; error?: unknown }>(),
);
const queryCalls = vi.hoisted(
  () => [] as Array<{ name: string; params: unknown; enabled?: boolean }>,
);
const compactMutate = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/use-action", () => ({
  useActionQuery: (
    name: string,
    params: unknown,
    options?: { enabled?: boolean },
  ) => {
    queryCalls.push({ name, params, enabled: options?.enabled });
    return params === undefined
      ? { data: undefined, refetch: vi.fn() }
      : { ...queries.get(name), refetch: vi.fn() };
  },
  useActionMutation: (name: string) => ({
    mutate: name === "context-compact" ? compactMutate : vi.fn(),
  }),
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : undefined,
}));
vi.mock("@agent-native/core/client/i18n", async () => {
  const { fallbackContextTranslate } =
    await import("../../context-ui/types.js");
  return { useT: () => fallbackContextTranslate };
});

const { ThreadContextRing } = await import("./ThreadContextRing.js");
const {
  summarizeThreadContextUsage,
  contextUsageSegments,
  useThreadContextUsage,
} = await import("./use-thread-context-usage.js");

function manifest(overrides: Partial<ContextManifest> = {}): ContextManifest {
  return {
    threadId: "thread-1",
    computedAt: 1,
    model: "claude-opus-5-5",
    totalTokens: 779_800,
    rawTokens: 779_800,
    reclaimedTokens: 0,
    tokenCountMethod: "estimate",
    source: "structured",
    enforceable: true,
    systemTokens: 80_000,
    conversationTokens: 699_800,
    segments: [
      {
        segmentId: "a",
        type: "tool-result",
        role: "user",
        group: "Tool results",
        label: "Search",
        tokenCount: 500_000,
        tokenMethod: "estimate",
        status: "active",
      },
      {
        segmentId: "b",
        type: "text",
        role: "user",
        group: "Conversation",
        label: "Message",
        tokenCount: 150_000,
        tokenMethod: "estimate",
        status: "active",
      },
      {
        segmentId: "c",
        type: "tool-result",
        role: "user",
        group: "Tool results",
        label: "Old",
        tokenCount: 90_000,
        tokenMethod: "estimate",
        status: "evicted",
      },
    ],
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  queries.clear();
  queryCalls.length = 0;
  compactMutate.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const ring = () =>
  container.querySelector<HTMLButtonElement>(
    '[data-agent-composer-slot="context-ring"]',
  );

describe("summarizeThreadContextUsage", () => {
  it("is unknown before a model call is measured or without a known window", () => {
    expect(
      summarizeThreadContextUsage(undefined, "claude-opus-5-5").status,
    ).toBe("unknown");
    expect(
      summarizeThreadContextUsage(
        manifest({ totalTokens: 0, rawTokens: 0 }),
        "claude-opus-5-5",
      ).status,
    ).toBe("unknown");
    expect(
      summarizeThreadContextUsage(
        manifest({ model: "my-custom-model" }),
        "my-custom-model",
      ).status,
    ).toBe("unknown");
  });

  it("measures against the selected model, falling back to the manifest's", () => {
    expect(
      summarizeThreadContextUsage(manifest(), "claude-haiku-4-5"),
    ).toMatchObject({
      status: "ready",
      usedTokens: 779_800,
      windowTokens: 200_000,
    });
    expect(summarizeThreadContextUsage(manifest(), "auto")).toMatchObject({
      windowTokens: 1_000_000,
    });
  });

  it("splits tokens by kind and leaves evicted segments out", () => {
    expect(contextUsageSegments(manifest())).toEqual([
      { kind: "System", tokens: 80_000 },
      { kind: "Tool results", tokens: 500_000 },
      { kind: "Conversation", tokens: 199_800 },
    ]);
  });
});

describe("useThreadContextUsage", () => {
  function readUsage(props: Parameters<typeof useThreadContextUsage>[0]) {
    let usage: ReturnType<typeof useThreadContextUsage> | undefined;
    function Probe() {
      usage = useThreadContextUsage(props);
      return null;
    }
    act(() => root.render(<Probe />));
    return usage!;
  }

  const manifestRequests = () =>
    queryCalls.filter(
      (call) =>
        call.name === "context-manifest-get" &&
        call.params !== undefined &&
        call.enabled !== false,
    );

  it("asks for nothing while the thread is still a draft", () => {
    queries.set("context-manifest-get", { data: manifest() });
    const usage = readUsage({
      threadId: "draft-1",
      model: "claude-opus-5-5",
      enabled: false,
    });
    expect(manifestRequests()).toEqual([]);
    expect(usage.status).toBe("unknown");
  });

  it("reads a thread the server has not saved as absent, not as an error", () => {
    queries.set("context-manifest-get", {
      isError: true,
      error: Object.assign(new Error("Thread not found."), { status: 404 }),
    });
    const usage = readUsage({ threadId: "thread-1", model: "claude-opus-5-5" });
    expect(usage.status).toBe("absent");
    expect(usage.error).toBeUndefined();
  });

  it("keeps a failed read an error", () => {
    const failure = Object.assign(new Error("Server error"), { status: 500 });
    queries.set("context-manifest-get", { isError: true, error: failure });
    const usage = readUsage({ threadId: "thread-1", model: "claude-opus-5-5" });
    expect(usage.status).toBe("error");
    expect(usage.error).toBe(failure);
  });
});

describe("ThreadContextRing", () => {
  it("renders nothing without a thread or with unknown usage", () => {
    act(() => root.render(<ThreadContextRing model="claude-opus-5-5" />));
    expect(ring()).toBeNull();

    queries.set("context-manifest-get", {
      data: manifest({ totalTokens: 0, rawTokens: 0 }),
    });
    act(() =>
      root.render(
        <ThreadContextRing threadId="thread-1" model="claude-opus-5-5" />,
      ),
    );
    expect(ring()).toBeNull();

    queries.set("context-manifest-get", { isError: true });
    act(() =>
      root.render(
        <ThreadContextRing threadId="thread-1" model="claude-opus-5-5" />,
      ),
    );
    expect(ring()).toBeNull();
  });

  it("shows usage, the auto-compact distance, and compacts on request", async () => {
    queries.set("context-manifest-get", { data: manifest() });
    queries.set("context-compaction-get", {
      data: { tokensUntilAutoCompact: 18_000 },
    });
    act(() =>
      root.render(
        <ThreadContextRing threadId="thread-1" model="claude-opus-5-5" />,
      ),
    );
    expect(ring()?.getAttribute("aria-label")).toBe("Context 78% used");
    await act(async () => ring()!.click());
    const panel = document.querySelector("[data-context-usage-panel]")!;
    expect(panel.textContent).toContain("779.8k / 1M (78%)");
    expect(panel.textContent).toContain("18k until auto-compact");

    const compact = Array.from(panel.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Compact now"),
    )!;
    await act(async () => compact.click());
    expect(compactMutate).toHaveBeenCalledWith(
      { threadId: "thread-1" },
      expect.any(Object),
    );
    expect(compact.disabled).toBe(true);

    const [, handlers] = compactMutate.mock.calls[0]!;
    await act(async () =>
      handlers.onError(new Error("Could not compact this thread: no key")),
    );
    expect(panel.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not compact this thread: no key",
    );

    await act(async () => compact.click());
    const [, retry] = compactMutate.mock.calls[1]!;
    await act(async () => retry.onSuccess({ status: "compacted" }));
    expect(panel.querySelector('[role="status"]')?.textContent).toBe(
      "Compacted. Applies from the next message.",
    );
  });

  it("shows while the thread uses little of the window", () => {
    queries.set("context-manifest-get", {
      data: manifest({ totalTokens: 12_000, rawTokens: 12_000 }),
    });
    act(() =>
      root.render(
        <ThreadContextRing threadId="thread-1" model="claude-opus-5-5" />,
      ),
    );
    expect(ring()).not.toBeNull();
  });

  it("expands the breakdown in place instead of swapping to the X-Ray", async () => {
    queries.set("context-manifest-get", { data: manifest() });
    act(() =>
      root.render(
        <ThreadContextRing threadId="thread-1" model="claude-opus-5-5" />,
      ),
    );
    await act(async () => ring()!.click());
    const panel = document.querySelector("[data-context-usage-panel]")!;
    expect(panel.textContent).not.toContain("See detailed breakdown");
    await act(async () =>
      panel
        .querySelector<HTMLButtonElement>('button[aria-label="Breakdown"]')!
        .click(),
    );
    expect(document.querySelector("[data-context-usage-panel]")).toBe(panel);
    expect(
      Array.from(panel.querySelectorAll("[data-context-usage-row]")).map(
        (row) => row.getAttribute("data-context-usage-row"),
      ),
    ).toEqual(["System", "Tool results", "Conversation", "free-space"]);
    expect(document.body.textContent).not.toContain("Context X-Ray");
  });
});

describe("threadHasFinishedReply", () => {
  it("waits for a finished assistant reply before the manifest is read", () => {
    expect(threadHasFinishedReply([])).toBe(false);
    expect(threadHasFinishedReply([{ role: "user" }])).toBe(false);
    expect(
      threadHasFinishedReply([
        { role: "user" },
        { role: "assistant", status: "streaming" },
      ]),
    ).toBe(false);
    expect(
      threadHasFinishedReply([
        { role: "user" },
        { role: "assistant", status: "complete" },
      ]),
    ).toBe(true);
    expect(threadHasFinishedReply([{ role: "assistant" }])).toBe(true);
  });
});
