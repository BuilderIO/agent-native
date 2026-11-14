import type { H3Event } from "h3";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("virtual:docs-markdown-inventory", () => ({ default: null }));

import { fetchMarkdownMirror } from "../server/lib/markdown-mirror";

afterEach(() => vi.restoreAllMocks());

it("fetches an unlisted path when the inventory is unknown", async () => {
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("timed out"));
  const url = "https://www.agent-native.com/mcp.md";
  const event = {
    url: new URL(url),
    req: new Request(url),
  } as unknown as H3Event;
  await expect(fetchMarkdownMirror("mcp.md", event)).resolves.toMatchObject({
    kind: "unreadable",
    reason: expect.stringContaining("timed out"),
  });
  expect(fetchSpy).toHaveBeenCalledOnce();
});
