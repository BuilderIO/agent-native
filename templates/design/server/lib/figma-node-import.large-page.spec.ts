import { beforeEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./provider-api.js", () => ({
  executeProviderApiRequest: provider.request,
}));

import { resolveImportTargets } from "./figma-node-import.js";

const ok = (json: unknown) => ({ response: { ok: true, status: 200, json } });
const tooLarge = { response: { ok: true, status: 200, truncated: true } };
const frame = (id: string, name: string) => ({
  id,
  name,
  type: "FRAME",
  children: [{ id: `${id}:child`, name: "Body", type: "RECTANGLE" }],
});

beforeEach(() => {
  provider.request.mockReset();
});

describe("resolveImportTargets on a page too large to fetch whole", () => {
  it("lists the page's frames from an outline, then fetches those frames in full", async () => {
    provider.request.mockImplementation(
      async ({ query }: { query: { ids: string; depth?: number } }) => {
        if (query.ids === "6913:4184") {
          return query.depth === 2
            ? ok({
                nodes: {
                  "6913:4184": {
                    document: {
                      id: "6913:4184",
                      name: "One pager",
                      type: "CANVAS",
                      children: [
                        { id: "1:2", name: "Cover", type: "FRAME" },
                        { id: "1:3", name: "Back", type: "FRAME" },
                      ],
                    },
                  },
                },
              })
            : tooLarge;
        }
        const ids = query.ids.split(",");
        return ok({
          nodes: Object.fromEntries(
            ids.map((id) => [id, { document: frame(id, `Frame ${id}`) }]),
          ),
        });
      },
    );

    const targets = await resolveImportTargets("abcDEF12345", "6913:4184");

    expect(Object.keys(targets.nodesById)).toEqual(["1:2", "1:3"]);
    // The full frames, not the outline's childless stubs.
    expect(targets.nodesById["1:2"]?.children).toHaveLength(1);
    expect(targets).toMatchObject({ name: "One pager", truncated: false });
  });

  it("falls back to a one-level outline when two levels is still too large", async () => {
    provider.request.mockImplementation(
      async ({ query }: { query: { ids: string; depth?: number } }) => {
        if (query.ids === "6913:4184") {
          return query.depth === 1
            ? ok({
                nodes: {
                  "6913:4184": {
                    document: {
                      id: "6913:4184",
                      name: "One pager",
                      type: "CANVAS",
                      children: [{ id: "1:2", name: "Cover", type: "FRAME" }],
                    },
                  },
                },
              })
            : tooLarge;
        }
        return ok({
          nodes: { "1:2": { document: frame("1:2", "Cover") } },
        });
      },
    );

    const targets = await resolveImportTargets("abcDEF12345", "6913:4184");

    expect(Object.keys(targets.nodesById)).toEqual(["1:2"]);
  });

  it("keeps a frame too large to fetch as an error", async () => {
    provider.request.mockImplementation(
      async ({ query }: { query: { depth?: number } }) =>
        query.depth === 2
          ? ok({ nodes: { "1:2": { document: frame("1:2", "Huge") } } })
          : tooLarge,
    );

    await expect(
      resolveImportTargets("abcDEF12345", "1:2"),
    ).rejects.toMatchObject({ errorCode: "figma_payload_too_large" });
  });
});
