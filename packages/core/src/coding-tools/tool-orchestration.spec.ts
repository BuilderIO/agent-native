import { describe, expect, it } from "vitest";

import type { ActionEntry } from "../agent/production-agent.js";
import { createToolOrchestrationEntry } from "./tool-orchestration.js";

const tool = {
  description: "test action",
  parameters: { type: "object", properties: {} },
};

describe("tool-orchestration bridge", () => {
  it("discovers and calls read-only tools without exposing workspace writes", async () => {
    let writeRan = false;
    const readCalls: Record<string, unknown>[] = [];
    const actions: Record<string, ActionEntry> = {
      "tool-search": {
        tool,
        readOnly: true,
        run: async (args) => {
          expect(args).toMatchObject({
            query: "users",
            includeSchemas: true,
            readOnlyOnly: true,
          });
          return {
            count: 1,
            results: [{ name: "read-users", planAvailability: "read" }],
          };
        },
      },
      "read-users": {
        tool,
        readOnly: true,
        run: async (args) => {
          readCalls.push(args);
          return { users: [{ id: "user-1" }], received: args };
        },
      },
      "write-users": {
        tool,
        readOnly: false,
        run: async () => {
          writeRan = true;
          return { ok: true };
        },
      },
    };
    const entry = createToolOrchestrationEntry(() => actions);

    const result = await entry.run({
      code: `
        const found = await toolSearch("users");
        const users = await toolCall(found.results[0].name, { limit: 2 });
        let blocked = "";
        try {
          await toolCall("write-users", {});
        } catch (err) {
          blocked = err.message;
        }
        console.log(JSON.stringify({
          foundCount: found.count,
          users,
          blocked,
          workspaceWrite: typeof workspaceWrite,
        }));
      `,
      maxToolCalls: 3,
      timeoutMs: 30_000,
    });

    expect(result).toContain('"foundCount":1');
    expect(result).toContain('"id":"user-1"');
    expect(result).toContain("not permitted by tool-orchestration");
    expect(result).toContain('"workspaceWrite":"undefined"');
    expect(readCalls).toEqual([{ limit: 2 }]);
    expect(writeRan).toBe(false);
  });

  it("allows only read-shaped provider, web, and workspace bridge calls", async () => {
    const providerCalls: Record<string, unknown>[] = [];
    const webCalls: Record<string, unknown>[] = [];
    const workspaceCalls: Record<string, unknown>[] = [];
    const actions: Record<string, ActionEntry> = {
      "provider-api-request": {
        tool,
        planMode: {
          effect: (args: Record<string, unknown>): "read" | "write" => {
            const method = String(args.method ?? "GET").toUpperCase();
            if (method !== "GET" && method !== "HEAD") return "write";
            if (args.stageAs || args.saveToFile) return "write";
            return "read";
          },
          allowedValues: { method: ["GET", "HEAD"] },
          omittedProperties: ["stageAs", "saveToFile"],
        },
        run: async (args) => {
          providerCalls.push(args);
          return { provider: "read" };
        },
      },
      "web-request": {
        tool,
        readOnly: true,
        planMode: {
          effect: (args: Record<string, unknown>): "read" | "write" => {
            const method = String(args.method ?? "GET").toUpperCase();
            if (method !== "GET" && method !== "HEAD") return "write";
            return args.saveToFile == null ? "read" : "write";
          },
          allowedValues: { method: ["GET", "HEAD"] },
          omittedProperties: ["saveToFile"],
        },
        run: async (args) => {
          webCalls.push(args);
          return "HTTP 200 OK\n\nread";
        },
      },
      "workspace-files": {
        tool,
        agentTool: false,
        readOnly: false,
        run: async (args) => {
          workspaceCalls.push(args);
          return { files: [] };
        },
      },
    };
    const entry = createToolOrchestrationEntry(() => actions);

    const result = await entry.run({
      code: `
        const outputs = [];
        for (const [name, args] of [
          ["provider-api-request", { method: "GET" }],
          ["provider-api-request", { method: "POST" }],
          ["provider-api-request", { method: "GET", stageAs: "records" }],
          [
            "provider-api-request",
            {
              method: "GET",
              fetchAllPages: {
                cursorPath: "paging.next",
                cursorParam: "cursor",
                maxPages: 999,
              },
            },
          ],
          ["web-request", { method: "HEAD" }],
          ["web-request", { method: "POST" }],
          ["web-request", { saveToFile: "scratch/page.html" }],
          ["workspace-files", { action: "read" }],
          ["workspace-files", { action: "write" }],
        ]) {
          try {
            outputs.push(await toolCall(name, args));
          } catch (err) {
            outputs.push("blocked: " + err.message);
          }
        }
        console.log(JSON.stringify(outputs));
      `,
      maxToolCalls: 8,
      timeoutMs: 30_000,
    });

    expect(result).toContain('"provider":"read"');
    expect(result).toContain("HTTP 200 OK");
    expect(result).toContain('"files":[]');
    expect(result).toContain("not permitted by tool-orchestration");
    expect(providerCalls).toEqual([
      { method: "GET" },
      {
        method: "GET",
        fetchAllPages: {
          cursorPath: "paging.next",
          cursorParam: "cursor",
          maxPages: 20,
        },
      },
    ]);
    expect(webCalls).toEqual([{ method: "HEAD" }]);
    expect(workspaceCalls).toEqual([{ action: "read" }]);
  });

  it("rejects recursive run-code and tool-orchestration calls", async () => {
    let runCodeCalls = 0;
    let orchestrationCalls = 0;
    const actions: Record<string, ActionEntry> = {
      "run-code": {
        tool,
        readOnly: true,
        allowInPlanMode: false,
        run: async () => {
          runCodeCalls++;
          return "should not run";
        },
      },
      "tool-orchestration": {
        tool,
        readOnly: true,
        allowInPlanMode: false,
        run: async () => {
          orchestrationCalls++;
          return "should not run";
        },
      },
    };
    const entry = createToolOrchestrationEntry(() => actions);

    const result = await entry.run({
      code: `
        const errors = [];
        for (const name of ["run-code", "tool-orchestration"]) {
          try {
            await toolCall(name, { code: "console.log('nested')" });
          } catch (err) {
            errors.push(err.message);
          }
        }
        console.log(JSON.stringify(errors));
      `,
      maxToolCalls: 2,
      timeoutMs: 30_000,
    });

    expect(result).toContain("not permitted by tool-orchestration");
    expect(runCodeCalls).toBe(0);
    expect(orchestrationCalls).toBe(0);
  });

  it("enforces a strict child-tool-call budget", async () => {
    let calls = 0;
    const actions: Record<string, ActionEntry> = {
      "read-record": {
        tool,
        readOnly: true,
        run: async () => ({ index: ++calls }),
      },
    };
    const entry = createToolOrchestrationEntry(() => actions);

    const result = await entry.run({
      code: `
        const values = [];
        for (let i = 0; i < 4; i++) {
          try {
            values.push(await toolCall("read-record", { i }));
          } catch (err) {
            values.push("blocked: " + err.message);
          }
        }
        console.log(JSON.stringify(values));
      `,
      maxToolCalls: 2,
      timeoutMs: 30_000,
    });

    expect(calls).toBe(2);
    expect(result).toContain('"index":1');
    expect(result).toContain('"index":2');
    expect(result).toContain("child-call budget exceeded (2)");
  });

  it("does not accept durable background arguments", async () => {
    const entry = createToolOrchestrationEntry(() => ({}));

    await expect(
      entry.run({ code: "console.log('no-op')", background: true }),
    ).resolves.toContain("foreground-only");
  });
});
