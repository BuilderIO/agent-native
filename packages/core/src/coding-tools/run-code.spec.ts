import { describe, expect, it } from "vitest";

import type { ActionEntry } from "../agent/production-agent.js";
import { createRunCodeEntry } from "./run-code.js";

const tool = {
  description: "test action",
  parameters: { type: "object", properties: {} },
};

describe("run-code bridge", () => {
  it("allows sandbox code to call agent-exposed read-only actions", async () => {
    const actions: Record<string, ActionEntry> = {
      "read-users": {
        tool,
        readOnly: true,
        run: async (args) => ({
          ok: true,
          received: args,
        }),
      },
    };
    const entry = createRunCodeEntry(() => actions);

    const result = await entry.run({
      code: `
        const result = await appAction("read-users", { limit: 2 });
        console.log(JSON.stringify(result));
      `,
      timeoutMs: 30_000,
    });

    expect(result).toContain('"ok":true');
    expect(result).toContain('"limit":2');
  });

  it("blocks mutating or explicitly hidden actions from appAction", async () => {
    let mutatingRan = false;
    let hiddenRan = false;
    const actions: Record<string, ActionEntry> = {
      "write-users": {
        tool,
        readOnly: false,
        run: async () => {
          mutatingRan = true;
          return { ok: true };
        },
      },
      "hidden-reader": {
        tool,
        readOnly: true,
        agentTool: false,
        run: async () => {
          hiddenRan = true;
          return { ok: true };
        },
      },
    };
    const entry = createRunCodeEntry(() => actions);

    const result = await entry.run({
      code: `
        for (const name of ["write-users", "hidden-reader"]) {
          try {
            await appAction(name, {});
          } catch (err) {
            console.log(name + ": " + err.message);
          }
        }
      `,
      timeoutMs: 30_000,
    });

    expect(result).toContain(
      'write-users: Tool "write-users" is a mutating action and cannot be called from run-code',
    );
    expect(result).toContain(
      'hidden-reader: Tool "hidden-reader" is not an agent-exposed read-only action',
    );
    expect(mutatingRan).toBe(false);
    expect(hiddenRan).toBe(false);
  });

  it("forwards structured providerFetch options to provider-api-request", async () => {
    const actions: Record<string, ActionEntry> = {
      "provider-api-request": {
        tool,
        readOnly: true,
        run: async (args) =>
          JSON.stringify({
            response: {
              status: 200,
              json: { captured: args },
            },
          }),
      },
    };
    const entry = createRunCodeEntry(() => actions);

    const result = await entry.run({
      code: `
        const result = await providerFetch("stripe", "/v1/charges", {
          query: { limit: 3, created: { gte: 123 } },
          body: { expand: ["data.customer"] },
          headers: { "X-Test": "yes" },
          stageAs: "charges",
          itemsPath: "data",
          pagination: { cursorPath: "has_more", cursorParam: "starting_after", cursorBodyPath: "cursor" },
          saveToFile: "analysis/charges.json",
          fetchAllPages: { cursorPath: "paging.next.after", cursorBodyPath: "cursor", maxPages: 2 },
          timeoutMs: 4000,
          maxBytes: 1000,
        });
        console.log(JSON.stringify(result));
      `,
      timeoutMs: 30_000,
    });

    expect(result).toContain('"provider":"stripe"');
    expect(result).toContain('"query":{"limit":3,"created":{"gte":123}}');
    expect(result).toContain('"body":{"expand":["data.customer"]}');
    expect(result).toContain('"headers":{"X-Test":"yes"}');
    expect(result).toContain('"stageAs":"charges"');
    expect(result).toContain('"itemsPath":"data"');
    expect(result).toContain('"cursorBodyPath":"cursor"');
    expect(result).toContain('"saveToFile":"analysis/charges.json"');
    expect(result).toContain('"maxBytes":1000');
  });

  it("forwards webFetch extraction and search options to web-request", async () => {
    const calls: Record<string, any>[] = [];
    const actions: Record<string, ActionEntry> = {
      "web-request": {
        tool,
        readOnly: true,
        run: async (args) => {
          calls.push(args);
          return 'HTTP 200 OK\n\nMatches: 1 shown of 1\n1. query "pagination" at 12: API pagination docs';
        },
      },
    };
    const entry = createRunCodeEntry(() => actions);

    const result = await entry.run({
      code: `
        const result = await webRead("https://docs.example.com/api", {
          search: { query: "pagination", maxMatches: 3 },
          maxChars: 1200,
          saveToFile: "scratch/docs.html",
        });
        console.log(JSON.stringify(result));
      `,
      timeoutMs: 30_000,
    });

    expect(result).toContain('"status":200');
    expect(result).toContain("API pagination docs");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://docs.example.com/api",
      method: "GET",
      responseMode: "auto",
      includeLinks: true,
      search: { query: "pagination", maxMatches: 3 },
      maxChars: 1200,
      saveToFile: "scratch/docs.html",
    });
  });

  it("paginates provider APIs inside sandbox code", async () => {
    const calls: Record<string, any>[] = [];
    const actions: Record<string, ActionEntry> = {
      "provider-api-request": {
        tool,
        readOnly: true,
        run: async (args) => {
          calls.push(args);
          const cursor = (args.body as any)?.cursor;
          return JSON.stringify({
            response: {
              status: 200,
              json:
                cursor === "next-2"
                  ? { records: { cursor: "" }, calls: [{ id: "c" }] }
                  : {
                      records: { cursor: "next-2" },
                      calls: [{ id: "a" }, { id: "b" }],
                    },
            },
          });
        },
      },
    };
    const entry = createRunCodeEntry(() => actions);

    const result = await entry.run({
      code: `
        const result = await providerFetchAll("gong", "/calls/extensive", {
          method: "POST",
          body: { filter: { fromDateTime: "2026-01-01T00:00:00Z" } },
          pagination: {
            itemsPath: "calls",
            nextCursorPath: "records.cursor",
            cursorBodyPath: "cursor",
            maxPages: 5,
          },
        });
        console.log(JSON.stringify({
          ids: result.items.map((item) => item.id),
          pageCount: result.pageCount,
          itemCount: result.itemCount,
          hasMore: result.hasMore,
          stoppedReason: result.stoppedReason,
        }));
      `,
      timeoutMs: 30_000,
    });

    expect(result).toContain('"ids":["a","b","c"]');
    expect(result).toContain('"pageCount":2');
    expect(result).toContain('"itemCount":3');
    expect(result).toContain('"hasMore":false');
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).toMatchObject({ cursor: "next-2" });
  });

  it("searches paginated provider records structurally with ids and coverage", async () => {
    const calls: Record<string, any>[] = [];
    const actions: Record<string, ActionEntry> = {
      "provider-api-request": {
        tool,
        readOnly: true,
        run: async (args) => {
          calls.push(args);
          const cursor = (args.body as any)?.cursor;
          return JSON.stringify({
            response: {
              status: 200,
              json:
                cursor === "next-2"
                  ? {
                      records: { cursor: "" },
                      callTranscripts: [
                        {
                          callId: "call-3",
                          transcript: [
                            {
                              speaker: "Rep",
                              sentences: [{ text: "No relevant topic here." }],
                            },
                          ],
                        },
                      ],
                    }
                  : {
                      records: { cursor: "next-2" },
                      callTranscripts: [
                        {
                          callId: "call-1",
                          title: "Design tooling follow-up",
                          transcript: [
                            {
                              speaker: "Customer",
                              sentences: [
                                {
                                  text: "We should revisit the Figma prototype path next quarter.",
                                },
                                {
                                  text: "The MCP server integration is the part to validate.",
                                },
                              ],
                            },
                          ],
                        },
                        {
                          callId: "call-2",
                          title: "Unrelated call",
                          transcript: [
                            {
                              speaker: "Rep",
                              sentences: [
                                { text: "Just implementation timing." },
                              ],
                            },
                          ],
                        },
                      ],
                    },
            },
          });
        },
      },
    };
    const entry = createRunCodeEntry(() => actions);

    const result = await entry.run({
      code: `
        const result = await providerSearchAll("gong", "/calls/transcript", {
          method: "POST",
          body: { filter: { callIds: ["call-1", "call-2", "call-3"] } },
          pagination: {
            itemsPath: "callTranscripts",
            nextCursorPath: "records.cursor",
            cursorBodyPath: "cursor",
            maxPages: 5,
          },
        }, {
          terms: ["figma", "mcp"],
          idPaths: ["callId"],
          textPaths: ["transcript"],
          metadataPaths: ["title"],
          maxHits: 10,
        });
        console.log(JSON.stringify({
          ids: result.hits.map((hit) => hit.id),
          snippets: result.hits.map((hit) => hit.snippet),
          paths: result.hits.map((hit) => hit.path),
          metadata: result.hits.map((hit) => hit.metadata),
          itemCount: result.itemCount,
          pageCount: result.pageCount,
          matchedItemCount: result.matchedItemCount,
          hasMore: result.hasMore,
          stoppedReason: result.stoppedReason,
        }));
      `,
      timeoutMs: 30_000,
    });

    expect(result).toContain('"ids":["call-1"]');
    expect(result).toContain("Figma prototype");
    expect(result).toContain('"paths":["transcript[0].sentences[0].text"]');
    expect(result).toContain(
      '"metadata":[{"title":"Design tooling follow-up"}]',
    );
    expect(result).toContain('"itemCount":3');
    expect(result).toContain('"pageCount":2');
    expect(result).toContain('"matchedItemCount":1');
    expect(result).toContain('"hasMore":false');
    expect(result).toContain('"stoppedReason":"completed"');
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).toMatchObject({ cursor: "next-2" });
  });

  it("keeps provider search total counts honest when display hits are capped", async () => {
    const actions: Record<string, ActionEntry> = {
      "provider-api-request": {
        tool,
        readOnly: true,
        run: async () =>
          JSON.stringify({
            response: {
              status: 200,
              json: {
                data: [
                  {
                    id: "record-1",
                    text: "figma ".repeat(25).trim(),
                  },
                ],
              },
            },
          }),
      },
    };
    const entry = createRunCodeEntry(() => actions);

    const result = await entry.run({
      code: `
        const result = await providerSearchAll("crm", "/records", {}, {
          query: "figma",
          maxHits: 10,
          maxHitsPerItem: 1,
        });
        console.log(JSON.stringify({
          hitCount: result.hitCount,
          totalHitCount: result.totalHitCount,
          truncatedHits: result.truncatedHits,
          matchedItemCount: result.matchedItemCount,
        }));
      `,
      timeoutMs: 30_000,
    });

    expect(result).toContain('"hitCount":1');
    expect(result).toContain('"totalHitCount":25');
    expect(result).toContain('"truncatedHits":true');
    expect(result).toContain('"matchedItemCount":1');
  });

  it("dedupes provider search hits by source id across overlapping pages", async () => {
    const calls: Record<string, any>[] = [];
    const actions: Record<string, ActionEntry> = {
      "provider-api-request": {
        tool,
        readOnly: true,
        run: async (args) => {
          calls.push(args);
          const cursor = (args.body as any)?.cursor;
          return JSON.stringify({
            response: {
              status: 200,
              json:
                cursor === "next-2"
                  ? {
                      records: { cursor: "" },
                      callTranscripts: [
                        {
                          callId: "call-1",
                          transcript: "Figma duplicate from overlap.",
                        },
                      ],
                    }
                  : {
                      records: { cursor: "next-2" },
                      callTranscripts: [
                        {
                          callId: "call-1",
                          transcript: "Figma duplicate from overlap.",
                        },
                      ],
                    },
            },
          });
        },
      },
    };
    const entry = createRunCodeEntry(() => actions);

    const result = await entry.run({
      code: `
        const result = await providerSearchAll("gong", "/calls/transcript", {
          method: "POST",
          pagination: {
            itemsPath: "callTranscripts",
            nextCursorPath: "records.cursor",
            cursorBodyPath: "cursor",
          },
        }, {
          query: "figma",
          idPaths: ["callId"],
          textPaths: ["transcript"],
        });
        console.log(JSON.stringify({
          ids: result.hits.map((hit) => hit.id),
          hitCount: result.hitCount,
          totalHitCount: result.totalHitCount,
          matchedItemCount: result.matchedItemCount,
          itemCount: result.itemCount,
          pageCount: result.pageCount,
          stoppedReason: result.stoppedReason,
        }));
      `,
      timeoutMs: 30_000,
    });

    expect(result).toContain('"ids":["call-1"]');
    expect(result).toContain('"hitCount":1');
    expect(result).toContain('"totalHitCount":1');
    expect(result).toContain('"matchedItemCount":1');
    expect(result).toContain('"itemCount":2');
    expect(result).toContain('"pageCount":2');
    expect(result).toContain('"stoppedReason":"completed"');
    expect(calls).toHaveLength(2);
  });

  it("does not process duplicate provider search pages when cursors repeat", async () => {
    const calls: Record<string, any>[] = [];
    const actions: Record<string, ActionEntry> = {
      "provider-api-request": {
        tool,
        readOnly: true,
        run: async (args) => {
          calls.push(args);
          return JSON.stringify({
            response: {
              status: 200,
              json: {
                records: { cursor: "same-cursor" },
                callTranscripts: [
                  {
                    callId: "call-1",
                    transcript: `Figma mention from page ${calls.length}.`,
                  },
                ],
              },
            },
          });
        },
      },
    };
    const entry = createRunCodeEntry(() => actions);

    const result = await entry.run({
      code: `
        const result = await providerSearchAll("gong", "/calls/transcript", {
          method: "POST",
          pagination: {
            itemsPath: "callTranscripts",
            nextCursorPath: "records.cursor",
            cursorBodyPath: "cursor",
            maxPages: 5,
          },
        }, {
          query: "figma",
          idPaths: ["callId"],
          textPaths: ["transcript"],
        });
        console.log(JSON.stringify({
          snippets: result.hits.map((hit) => hit.snippet),
          itemCount: result.itemCount,
          pageCount: result.pageCount,
          totalHitCount: result.totalHitCount,
          hasMore: result.hasMore,
          stoppedReason: result.stoppedReason,
        }));
      `,
      timeoutMs: 30_000,
    });

    expect(result).toContain("page 1");
    expect(result).not.toContain("page 2");
    expect(result).toContain('"itemCount":1');
    expect(result).toContain('"pageCount":2');
    expect(result).toContain('"totalHitCount":1');
    expect(result).toContain('"hasMore":false');
    expect(result).toContain('"stoppedReason":"repeated-cursor"');
    expect(calls).toHaveLength(2);
  });

  it("finds every provider search regex match without sticky anchoring", async () => {
    const actions: Record<string, ActionEntry> = {
      "provider-api-request": {
        tool,
        readOnly: true,
        run: async () =>
          JSON.stringify({
            response: {
              status: 200,
              json: {
                data: [
                  { id: "record-1", text: "prefix figma and figma again" },
                ],
              },
            },
          }),
      },
    };
    const entry = createRunCodeEntry(() => actions);

    const result = await entry.run({
      code: `
        const result = await providerSearchAll("crm", "/records", {}, {
          regex: "figma",
          regexFlags: "y",
          textPaths: ["text"],
          maxHitsPerItem: 10,
        });
        console.log(JSON.stringify({
          matches: result.hits.map((hit) => hit.match),
          totalHitCount: result.totalHitCount,
        }));
      `,
      timeoutMs: 30_000,
    });

    expect(result).toContain('"matches":["figma","figma"]');
    expect(result).toContain('"totalHitCount":2');
  });

  it("reports more provider search coverage when cursor destination is missing", async () => {
    const actions: Record<string, ActionEntry> = {
      "provider-api-request": {
        tool,
        readOnly: true,
        run: async () =>
          JSON.stringify({
            response: {
              status: 200,
              json: {
                records: { cursor: "next-2" },
                data: [{ id: "record-1", text: "figma" }],
              },
            },
          }),
      },
    };
    const entry = createRunCodeEntry(() => actions);

    const result = await entry.run({
      code: `
        const result = await providerSearchAll("crm", "/records", {
          pagination: {
            itemsPath: "data",
            nextCursorPath: "records.cursor",
          },
        }, {
          query: "figma",
          textPaths: ["text"],
        });
        console.log(JSON.stringify({
          hasMore: result.hasMore,
          stoppedReason: result.stoppedReason,
          totalHitCount: result.totalHitCount,
        }));
      `,
      timeoutMs: 30_000,
    });

    expect(result).toContain('"hasMore":true');
    expect(result).toContain(
      '"stoppedReason":"cursor-found-without-destination"',
    );
    expect(result).toContain('"totalHitCount":1');
  });

  it("stops provider pagination when a cursor repeats", async () => {
    const calls: Record<string, any>[] = [];
    const actions: Record<string, ActionEntry> = {
      "provider-api-request": {
        tool,
        readOnly: true,
        run: async (args) => {
          calls.push(args);
          return JSON.stringify({
            response: {
              status: 200,
              json: {
                records: { cursor: "same-cursor" },
                calls: [{ id: `page-${calls.length}` }],
              },
            },
          });
        },
      },
    };
    const entry = createRunCodeEntry(() => actions);

    const result = await entry.run({
      code: `
        const result = await providerFetchAll("gong", "/calls/extensive", {
          method: "POST",
          pagination: {
            itemsPath: "calls",
            nextCursorPath: "records.cursor",
            cursorBodyPath: "cursor",
            maxPages: 5,
          },
        });
        console.log(JSON.stringify({
          ids: result.items.map((item) => item.id),
          pageCount: result.pageCount,
          hasMore: result.hasMore,
          stoppedReason: result.stoppedReason,
        }));
      `,
      timeoutMs: 30_000,
    });

    expect(result).toContain('"ids":["page-1","page-2"]');
    expect(result).toContain('"pageCount":2');
    expect(result).toContain('"hasMore":false');
    expect(result).toContain('"stoppedReason":"repeated-cursor"');
    expect(calls).toHaveLength(2);
  });

  it("marks page-based provider pagination as capped at maxPages", async () => {
    const calls: Record<string, any>[] = [];
    const actions: Record<string, ActionEntry> = {
      "provider-api-request": {
        tool,
        readOnly: true,
        run: async (args) => {
          calls.push(args);
          return JSON.stringify({
            response: {
              status: 200,
              json: { data: [{ id: `page-${(args.query as any)?.page}` }] },
            },
          });
        },
      },
    };
    const entry = createRunCodeEntry(() => actions);

    const result = await entry.run({
      code: `
        const result = await providerFetchAll("crm", "/records", {
          pagination: {
            itemsPath: "data",
            pageParam: "page",
            maxPages: 2,
          },
        });
        console.log(JSON.stringify({
          ids: result.items.map((item) => item.id),
          hasMore: result.hasMore,
          stoppedReason: result.stoppedReason,
        }));
      `,
      timeoutMs: 30_000,
    });

    expect(result).toContain('"ids":["page-1","page-2"]');
    expect(result).toContain('"hasMore":true');
    expect(result).toContain('"stoppedReason":"max-pages"');
    expect(calls).toHaveLength(2);
    expect(calls[1]?.query).toMatchObject({ page: 2 });
  });
});
