import type { H3Event } from "h3";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchMarkdownMirror,
  isMarkdownMirrorFetch,
} from "../server/lib/markdown-mirror";

function eventWithHeaders(
  headers: Record<string, string>,
  url = "https://www.agent-native.com/docs/actions-overview.md",
): H3Event {
  return {
    url: new URL(url),
    req: new Request(url, { headers }),
  } as unknown as H3Event;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("markdown mirror recursion guard", () => {
  it("never fetches when the request is itself the mirror fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const event = eventWithHeaders({
      "x-agent-native-md-mirror": "1",
    });

    expect(isMarkdownMirrorFetch(event)).toBe(true);
    await expect(
      fetchMarkdownMirror("docs/actions-overview.md", event),
    ).resolves.toEqual({ kind: "absent" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("marks its own origin fetch so the nested handler stops", async () => {
    vi.stubEnv("APP_URL", "https://docs.example.test");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("# Actions", {
        status: 200,
        headers: { "content-type": "text/markdown" },
      }),
    );
    const event = eventWithHeaders(
      { "x-forwarded-host": "attacker.example.test" },
      "https://attacker.example.test/docs/actions-overview.md",
    );

    await expect(
      fetchMarkdownMirror("docs/actions-overview.md", event),
    ).resolves.toEqual({ kind: "found", content: "# Actions" });

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      "https://docs.example.test/docs/actions-overview.md",
    );
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["x-agent-native-md-mirror"]).toBe("1");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("fetches the public docs origin when no app URL is configured", async () => {
    for (const key of [
      "APP_URL",
      "WORKSPACE_OAUTH_ORIGIN",
      "VITE_WORKSPACE_OAUTH_ORIGIN",
      "BETTER_AUTH_URL",
      "VITE_BETTER_AUTH_URL",
      "URL",
      "DEPLOY_URL",
      "WORKSPACE_GATEWAY_URL",
      "VITE_WORKSPACE_GATEWAY_URL",
    ]) {
      vi.stubEnv(key, "");
    }
    vi.stubEnv("NODE_ENV", "production");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("# Actions", {
        status: 200,
        headers: { "content-type": "text/markdown" },
      }),
    );
    const event = eventWithHeaders(
      { "x-forwarded-host": "attacker.example.test" },
      "https://attacker.example.test/docs/actions-overview.md",
    );

    await expect(
      fetchMarkdownMirror("docs/actions-overview.md", event),
    ).resolves.toEqual({ kind: "found", content: "# Actions" });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      "https://www.agent-native.com/docs/actions-overview.md",
    );
  });

  it("reports a missing mirror as absent, not as a failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 404 }),
    );
    const event = eventWithHeaders({});

    await expect(
      fetchMarkdownMirror("docs/actions-overview.md", event),
    ).resolves.toEqual({
      kind: "absent",
    });
  });

  it.each([
    "examples/self-hosted-chat/README.md",
    "examples/self-hosted-chat/%52EADME.md",
    "llms.txt",
  ])("still fetches public asset %s", async (relativePath) => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("timed out"));
    await expect(
      fetchMarkdownMirror(relativePath, eventWithHeaders({})),
    ).resolves.toMatchObject({
      kind: "unreadable",
      reason: expect.stringContaining("timed out"),
    });
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("keeps an unreadable mirror distinct from an absent one", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("timed out"));
    const event = eventWithHeaders({});

    const result = await fetchMarkdownMirror("docs/actions-overview.md", event);
    expect(result.kind).toBe("unreadable");
    expect(result).toMatchObject({
      reason: expect.stringContaining("timed out"),
    });
  });
});
