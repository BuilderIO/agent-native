import { describe, expect, it, vi } from "vitest";

import type { AgentEngine, EngineEvent } from "../../agent/engine/types.js";
import {
  runAgentLoop,
  createPlanModeActionRegistry,
} from "../../agent/production-agent.js";
import { createResourceScriptEntries } from "./script-entries.js";
async function call(name: string, input: unknown) {
  const entries = await createResourceScriptEntries();
  const entry = entries[name];
  expect(entry).toBeDefined();
  const run = vi.fn(async (_args: any, _context?: any) => "saved");
  entries.resources.run = run;
  let calls = 0;
  const events: any[] = [];
  const engine = {
    name: "test",
    label: "Test",
    defaultModel: "test-model",
    supportedModels: ["test-model"],
    capabilities: {
      thinking: false,
      promptCaching: false,
      vision: false,
      computerUse: false,
      parallelToolCalls: true,
    },
    async *stream(): AsyncIterable<EngineEvent> {
      if (calls++ === 0) {
        yield {
          type: "tool-call",
          id: "resource-write",
          name,
          input,
        } as EngineEvent;
        yield { type: "stop", reason: "tool_use" };
      } else {
        yield { type: "text", text: "done" };
        yield { type: "stop", reason: "end_turn" };
      }
    },
  } as AgentEngine;
  await runAgentLoop({
    engine,
    model: "test-model",
    systemPrompt: "system",
    tools: [],
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "Save a personal skill" }],
      },
    ],
    actions: { [name]: entry },
    send: (e) => events.push(e),
    signal: new AbortController().signal,
  });
  return { run, events };
}
describe("resource write native operation", () => {
  it("reproduces generic mixed-placeholder refusal without writing", async () => {
    const { run, events } = await call("resources", {
      action: "write",
      path: "skills/qa-synthetic/SKILL.md",
      content: "Synthetic instruction",
      scope: "personal",
      prefix: "",
      format: null,
    });
    expect(run).not.toHaveBeenCalled();
    expect(JSON.stringify(events)).toContain("mixes invalid placeholders");
  });
  it("exposes only write fields", async () => {
    const e = (await createResourceScriptEntries())["write-resource"];
    expect(e).toBeDefined();
    expect(Object.keys(e.tool.parameters.properties).sort()).toEqual(
      ["path", "content", "scope", "mime", "visibility"].sort(),
    );
    expect(e.tool.parameters.required).toEqual(["path", "content"]);
  });
  it.each([null, ""])(
    "runs personal skill write with optional padding %j",
    async (blank) => {
      const { run } = await call("write-resource", {
        path: "skills/qa-synthetic/SKILL.md",
        content: "Synthetic instruction",
        scope: "personal",
        mime: blank,
        visibility: blank,
      });
      expect(run).toHaveBeenCalledExactlyOnceWith(
        {
          action: "write",
          path: "skills/qa-synthetic/SKILL.md",
          content: "Synthetic instruction",
          scope: "personal",
        },
        expect.any(Object),
      );
    },
  );
  it("preserves explicit empty content with padded optionals", async () => {
    const { run } = await call("write-resource", {
      path: "notes/qa-synthetic.md",
      content: "",
      scope: "personal",
      mime: null,
      visibility: null,
    });
    expect(run).toHaveBeenCalledExactlyOnceWith(
      {
        action: "write",
        path: "notes/qa-synthetic.md",
        content: "",
        scope: "personal",
      },
      expect.any(Object),
    );
  });
  it("retains default and explicit shared approval", async () => {
    const e = (await createResourceScriptEntries())["write-resource"];
    expect(e).toBeDefined();
    expect(e.allowPersistentApproval).toBe(false);
    const approve = e.needsApproval;
    expect(typeof approve).toBe("function");
    if (typeof approve !== "function") throw Error("approval missing");
    expect(
      await approve({
        path: "skills/qa/SKILL.md",
        content: "QA",
        scope: "shared",
      }),
    ).toBe(true);
    expect(await approve({ path: "LEARNINGS.md", content: "QA" })).toBe(true);
    expect(
      await approve({ path: "LEARNINGS.md", content: "QA", scope: "personal" }),
    ).toBe(false);
    expect(
      await approve({
        path: "skills/qa/SKILL.md",
        content: "QA",
        scope: "personal",
      }),
    ).toBe(false);
  });
  it("remains write in plan mode", async () => {
    const e = (await createResourceScriptEntries())["write-resource"];
    expect(e).toBeDefined();
    const run = vi.fn(async () => "saved");
    const registry = createPlanModeActionRegistry({
      "write-resource": { ...e, run },
    });
    await registry["write-resource"].run({
      path: "skills/qa/SKILL.md",
      content: "QA",
      scope: "personal",
    });
    expect(run).not.toHaveBeenCalled();
  });
  it.each([null, false, 0, undefined])(
    "refuses nonstring required content %j",
    async (content) => {
      const { run } = await call("write-resource", {
        path: "notes/qa-synthetic.md",
        content,
        scope: "personal",
      });
      expect(run).not.toHaveBeenCalled();
    },
  );
  it.each(["expiresAt", "threadId", "runId", "createdBy", "action"])(
    "refuses unexpected field %s",
    async (key) => {
      const { run } = await call("write-resource", {
        path: "notes/qa-synthetic.md",
        content: "QA",
        scope: "personal",
        [key]: "unexpected",
      });
      expect(run).not.toHaveBeenCalled();
    },
  );

  it.each([null, ""])(
    "normalizes blank scope %j before default shared approval",
    async (scope) => {
      const e = (await createResourceScriptEntries())["write-resource"];
      if (typeof e.needsApproval !== "function")
        throw Error("approval missing");
      expect(
        await e.needsApproval({ path: "LEARNINGS.md", content: "QA", scope }),
      ).toBe(true);
    },
  );
  it("fails closed for invalid direct approval and rejects invalid direct execution", async () => {
    const e = (await createResourceScriptEntries())["write-resource"];
    if (typeof e.needsApproval !== "function") throw Error("approval missing");
    expect(
      await e.needsApproval({
        path: "notes/qa.md",
        content: null,
        scope: "personal",
      }),
    ).toBe(true);
    expect(() =>
      e.run({ path: "notes/qa.md", content: null, scope: "personal" }),
    ).toThrow("string content");
  });
  it("names the exact discovery operation in the generic entry", async () => {
    const e = (await createResourceScriptEntries()).resources;
    expect(e.tool.description).toContain(
      "load write-resource with tool-search",
    );
  });
});
