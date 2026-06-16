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
      'write-users: Tool "write-users" is not an agent-exposed read-only action',
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
