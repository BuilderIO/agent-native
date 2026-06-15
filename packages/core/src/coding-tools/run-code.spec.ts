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
          pagination: { cursorPath: "has_more", cursorParam: "starting_after" },
          saveToFile: "analysis/charges.json",
          fetchAllPages: { cursorPath: "paging.next.after", cursorParam: "after", maxPages: 2 },
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
    expect(result).toContain('"saveToFile":"analysis/charges.json"');
    expect(result).toContain('"maxBytes":1000');
  });
});
