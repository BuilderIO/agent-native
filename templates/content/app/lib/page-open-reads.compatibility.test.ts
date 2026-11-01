// @vitest-environment happy-dom

import { defineAction } from "@agent-native/core/action";
import { mountActionRoutes } from "@agent-native/core/server";
import { H3 } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { startupPageReadScript, takeStartupPageRead } from "./page-open-reads";

const ACTION_URL = "/_agent-native/actions/get-document";

// Content's build stamps this version (vite.config.ts) into its client and
// server alike, and the action routes require it of every in-app request.
const CONTENT_COMPATIBILITY = "content-video-block-ids-v1";

type BuildGlobals = typeof globalThis & {
  __AGENT_NATIVE_CLIENT_COMPATIBILITY_VERSION__?: string;
};

describe("the head script's page read against Content's action routes", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    // The shell's build defines this, as it does for the app code it loads.
    (globalThis as BuildGlobals).__AGENT_NATIVE_CLIENT_COMPATIBILITY_VERSION__ =
      CONTENT_COMPATIBILITY;
    window.history.replaceState(null, "", "/page/doc-1");
    document.cookie = "an_session_hint=1; path=/";
  });

  afterEach(() => {
    void takeStartupPageRead("", {});
    delete (globalThis as BuildGlobals)
      .__AGENT_NATIVE_CLIENT_COMPATIBILITY_VERSION__;
    document.cookie = "an_session_hint=; path=/; max-age=0";
    vi.unstubAllGlobals();
  });

  it("is answered by the action, not refused as an older build", async () => {
    new Function(startupPageReadScript(ACTION_URL))();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit & { headers: HeadersInit },
    ];

    const run = vi.fn(async ({ id }: { id: string }) => ({ id }));
    const h3 = new H3();
    mountActionRoutes(
      { h3, hooks: { hook: () => {} } },
      {
        "get-document": defineAction({
          description: "Read a page.",
          schema: z.object({
            id: z.string(),
            includePreviewDraft: z.coerce.boolean().optional(),
          }),
          http: { method: "GET" },
          readOnly: true,
          run,
        }) as never,
      },
      {
        appId: "content",
        clientCompatibilityVersion: CONTENT_COMPATIBILITY,
        getOwnerFromEvent: async () => "owner@example.com",
      },
    );
    const response = await h3.fetch(
      new Request(new URL(url, "https://content.example.test"), {
        method: "GET",
        headers: init.headers,
      }),
    );

    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ id: "doc-1", includePreviewDraft: true }),
      expect.anything(),
    );
  });
});
