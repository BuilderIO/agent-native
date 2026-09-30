// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMentionSearch } from "./use-mention-search.js";

const resolvePath = (path: string) => `/design${path}`;
const file = {
  id: "file:one",
  label: "Plan",
  source: "resource:personal",
  refType: "file",
  refPath: "plan.md",
};
let result: ReturnType<typeof useMentionSearch>;
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
function Harness({
  query = "",
  enabled = true,
}: {
  query?: string;
  enabled?: boolean;
}) {
  result = useMentionSearch(query, enabled, resolvePath);
  return null;
}
async function render(props: { query?: string; enabled?: boolean } = {}) {
  await act(async () => root.render(<Harness {...props} />));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, props.query ? 180 : 20));
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
describe("shared launcher mention discovery", () => {
  it("does not load until the launcher opens", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await render({ enabled: false });
    expect(fetch).not.toHaveBeenCalled();
    expect(result.items).toEqual([]);
  });
  it("reads a final unterminated batch and deduplicates results", async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ items: [file, file] })),
    );
    vi.stubGlobal("fetch", fetch);
    await render({ query: "Plan & brief" });
    expect(fetch).toHaveBeenCalledWith(
      "/design/_agent-native/agent-chat/mentions?q=Plan%20%26%20brief",
      { signal: expect.any(AbortSignal) },
    );
    expect(result.items).toEqual([file]);
    expect(result.error).toBeNull();
    expect(result.isLoading).toBe(false);
  });
  it.each([
    new Response("{}"),
    new Response("{broken"),
    new Response("", { status: 503 }),
  ])(
    "reports malformed and failed discovery instead of empty success",
    async (response) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response),
      );
      await render();
      expect(result.error).toBeInstanceOf(Error);
      expect(result.isLoading).toBe(false);
    },
  );
  it("retries a failed discovery and clears stale errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce(new Response(JSON.stringify({ items: [file] }))),
    );
    await render();
    expect(result.error).toBeInstanceOf(Error);
    await act(async () => result.retry());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(result.error).toBeNull();
    expect(result.items).toEqual([file]);
  });
  it("aborts closing discovery and ignores its late response", async () => {
    let complete!: (response: Response) => void;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetch);
    await render();
    const signal = (
      fetch.mock.calls[0] as unknown as [string, { signal: AbortSignal }]
    )[1].signal;
    await render({ enabled: false });
    expect(signal.aborted).toBe(true);
    await act(async () =>
      complete(new Response(JSON.stringify({ items: [file] }))),
    );
    expect(result.items).toEqual([]);
    expect(result.error).toBeNull();
  });
});
