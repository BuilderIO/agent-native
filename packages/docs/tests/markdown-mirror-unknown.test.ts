import type { H3Event } from "h3";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("virtual:docs-markdown-inventory", () => ({ default: null }));

import { fetchMarkdownMirror } from "../server/lib/markdown-mirror";

afterEach(() => vi.restoreAllMocks());

it.each([
  () => new Response("missing", { status: 404 }),
  () =>
    new Response("<html></html>", { headers: { "content-type": "text/html" } }),
])(
  "treats missing or non-markdown responses as absent when inventory is unknown",
  async (response) => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(response());
    const url = "https://www.agent-native.com/mcp.md";
    const event = {
      url: new URL(url),
      req: new Request(url),
    } as unknown as H3Event;

    await expect(fetchMarkdownMirror("mcp.md", event)).resolves.toEqual({
      kind: "absent",
    });
    expect(fetchSpy).toHaveBeenCalledOnce();
  },
);

it.each(["mcp.md", "docs/%6dissing.md"])(
  "fetches unlisted path %s when the inventory is unknown",
  async (relativePath) => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("timed out"));
    const url = "https://www.agent-native.com/mcp.md";
    const event = {
      url: new URL(url),
      req: new Request(url),
    } as unknown as H3Event;
    await expect(
      fetchMarkdownMirror(relativePath, event),
    ).resolves.toMatchObject({
      kind: "unreadable",
      reason: expect.stringContaining("timed out"),
    });
    expect(fetchSpy).toHaveBeenCalledOnce();
  },
);
