import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchLocalPlanBridgeBundle } from "./plan-local-bridge";

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
});
