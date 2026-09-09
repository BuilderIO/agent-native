import type { H3Event } from "h3";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchMarkdownMirror,
  isMarkdownMirrorFetch,
} from "../server/lib/markdown-mirror";

/**
 * The mirror fetch re-enters the same Nitro handler, because the function owns
 * `/*`. Before the marker header existed, that recursed until Netlify killed
 * the request: every `.md` twin returned 502 after ~40s with no `cache-status`,
 * so nothing cached and each retry burned another container for 40s.
 */
function eventWithHeaders(headers: Record<string, string>): H3Event {
  const url = "https://www.agent-native.com/docs/actions.md";
  return {
    url: new URL(url),
    req: new Request(url, { headers }),
  } as unknown as H3Event;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("markdown mirror recursion guard", () => {
  it("never fetches when the request is itself the mirror fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const event = eventWithHeaders({
      "x-agent-native-md-mirror": "1",
    });

    expect(isMarkdownMirrorFetch(event)).toBe(true);
    await expect(
      fetchMarkdownMirror("docs/actions.md", event),
    ).resolves.toEqual({ kind: "absent" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("marks its own origin fetch so the nested handler stops", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("# Actions", {
        status: 200,
        headers: { "content-type": "text/markdown" },
      }),
    );
    const event = eventWithHeaders({});

    await expect(
      fetchMarkdownMirror("docs/actions.md", event),
    ).resolves.toEqual({ kind: "found", content: "# Actions" });

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["x-agent-native-md-mirror"]).toBe("1");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports a missing mirror as absent, not as a failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 404 }),
    );
    const event = eventWithHeaders({});

    await expect(fetchMarkdownMirror("docs/nope.md", event)).resolves.toEqual({
      kind: "absent",
    });
  });

  it("keeps an unreadable mirror distinct from an absent one", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("timed out"));
    const event = eventWithHeaders({});

    const result = await fetchMarkdownMirror("docs/actions.md", event);
    expect(result.kind).toBe("unreadable");
    expect(result).toMatchObject({
      reason: expect.stringContaining("timed out"),
    });
  });
});
