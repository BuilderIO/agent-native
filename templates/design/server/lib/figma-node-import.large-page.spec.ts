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

  it("opens sections a one-level outline lists without their frames", async () => {
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
                      children: [
                        { id: "5:1", name: "Launch", type: "SECTION" },
                      ],
                    },
                  },
                },
              })
            : tooLarge;
        }
        if (query.ids === "5:1") {
          return ok({
            nodes: {
              "5:1": {
                document: {
                  id: "5:1",
                  name: "Launch",
                  type: "SECTION",
                  children: [
                    { id: "1:2", name: "Cover", type: "FRAME" },
                    { id: "1:3", name: "Back", type: "FRAME" },
                  ],
                },
              },
            },
          });
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
  });

  it("stops opening sections once the page has more frames than one import takes", async () => {
    const sectionIds = Array.from({ length: 30 }, (_, index) => `5:${index}`);
    const sectionReads: string[] = [];
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
                      children: sectionIds.map((id) => ({
                        id,
                        name: `Section ${id}`,
                        type: "SECTION",
                      })),
                    },
                  },
                },
              })
            : tooLarge;
        }
        const ids = query.ids.split(",");
        if (query.depth === 1) {
          sectionReads.push(...ids);
          return ok({
            nodes: Object.fromEntries(
              ids.map((id) => [
                id,
                {
                  document: {
                    id,
                    name: `Section ${id}`,
                    type: "SECTION",
                    children: Array.from({ length: 10 }, (_, index) => ({
                      id: `${id}-${index}`,
                      name: `Frame ${index}`,
                      type: "FRAME",
                    })),
                  },
                },
              ]),
            ),
          });
        }
        return ok({
          nodes: Object.fromEntries(
            ids.map((id) => [id, { document: frame(id, `Frame ${id}`) }]),
          ),
        });
      },
    );

    const targets = await resolveImportTargets("abcDEF12345", "6913:4184");

    // One batch of ten sections already lists 100 frames, past the cap.
    expect(sectionReads).toHaveLength(10);
    expect(Object.keys(targets.nodesById)).toHaveLength(50);
    expect(targets.truncated).toBe(true);
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
