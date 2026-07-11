import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchLocalPlanBridgeBundle,
  localNetworkAccessPermissionState,
  LocalPlanBridgePermissionError,
  shouldRetryLocalPlanBridgeBundle,
  shouldShowLocalPlanLoadError,
} from "./plan-local-bridge";

describe("local plan bridge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps valid plan blocks visible when local MDX contains malformed blocks", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            source: "agent-native-local-bridge",
            localOnly: true,
            slug: "partially-valid-plan",
            kind: "plan",
            mdx: {
              "plan.mdx": `---
title: "Partially valid plan"
version: 2
---

This valid introduction stays visible.

<Table id="empty-table" />

<Callout id="empty-callout" />
`,
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    const bundle = await fetchLocalPlanBridgeBundle(
      "http://127.0.0.1:60166/local-plan.json?token=test-token",
      "partially-valid-plan",
    );

    expect(bundle.plan.content.blocks).toHaveLength(3);
    expect(bundle.plan.content.blocks[0]).toMatchObject({
      type: "rich-text",
      data: { markdown: "This valid introduction stays visible." },
    });
    expect(bundle.plan.content.blocks.slice(1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "empty-table",
          type: "callout",
          data: expect.objectContaining({
            tone: "warning",
            body: expect.stringContaining("__unknown_block__:table"),
          }),
        }),
        expect.objectContaining({
          id: "empty-callout",
          type: "callout",
          data: expect.objectContaining({
            tone: "warning",
            body: expect.stringContaining("__unknown_block__:callout"),
          }),
        }),
      ]),
    );
  });

  it.each(["prompt", "granted", "denied"] as const)(
    "reads the %s local network access permission through the legacy alias",
    async (state) => {
      const query = vi.fn().mockResolvedValue({ state });
      vi.stubGlobal("navigator", { permissions: { query } });

      await expect(localNetworkAccessPermissionState()).resolves.toBe(state);
      expect(query).toHaveBeenCalledWith({ name: "local-network-access" });
    },
  );

  it("falls back to unsupported when the browser cannot query local network access", async () => {
    vi.stubGlobal("navigator", {
      permissions: {
        query: vi.fn().mockRejectedValue(new TypeError("unknown")),
      },
    });

    await expect(localNetworkAccessPermissionState()).resolves.toBe(
      "unsupported",
    );
  });

  it("classifies a denied localhost fetch and does not retry it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    vi.stubGlobal("navigator", {
      permissions: {
        query: vi.fn().mockResolvedValue({ state: "denied" }),
      },
    });

    const request = fetchLocalPlanBridgeBundle(
      "http://127.0.0.1:60166/local-plan.json?token=test-token",
      "blocked-plan",
    );
    await expect(request).rejects.toMatchObject({
      name: "LocalPlanBridgePermissionError",
      permissionState: "denied",
    });

    const error = new LocalPlanBridgePermissionError("denied");
    expect(shouldRetryLocalPlanBridgeBundle(0, error)).toBe(false);
  });

  it.each(["checking", "prompt", "denied"] as const)(
    "keeps the generic load error hidden while permission is %s",
    (permissionState) => {
      expect(
        shouldShowLocalPlanLoadError({
          localPlanMode: true,
          hasBundle: false,
          hasBridgeUrl: true,
          bridgeFetchEnabled: false,
          error: null,
          loading: false,
          fetching: false,
          permissionState,
        }),
      ).toBe(false);
    },
  );

  it("keeps a stale permission error hidden while a newly granted fetch starts", () => {
    expect(
      shouldShowLocalPlanLoadError({
        localPlanMode: true,
        hasBundle: false,
        hasBridgeUrl: true,
        bridgeFetchEnabled: true,
        error: new LocalPlanBridgePermissionError("denied"),
        loading: false,
        fetching: true,
        permissionState: "granted",
      }),
    ).toBe(false);
  });
});
