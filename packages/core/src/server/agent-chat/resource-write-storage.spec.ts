import { expect, it } from "vitest";

import type { AgentEngine, EngineEvent } from "../../agent/engine/types.js";
import { runAgentLoop } from "../../agent/production-agent.js";
import { resourceGetByPath, resourcePut } from "../../resources/store.js";
import { runWithRequestContext } from "../request-context.js";
import { createResourceScriptEntries } from "./script-entries.js";
it("native write persists exact content/defaults, rejects null clear, cleans up", async () => {
  const owner = "qa-resource-write@example.com",
    path = "skills/qa-resource-write/SKILL.md";
  await runWithRequestContext({ userEmail: owner }, async () => {
    const write = async (input: unknown) => {
      const entries = await createResourceScriptEntries();
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
              id: "write",
              name: "write-resource",
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
            content: [{ type: "text", text: "Save a personal QA skill" }],
          },
        ],
        actions: entries,
        send: (e) => events.push(e),
        signal: new AbortController().signal,
      });
      return events;
    };
    expect(await resourceGetByPath(owner, path)).toBeNull();
    try {
      const content =
        "---\nname: qa-resource-write\ndescription: Synthetic local test.\n---\nPreserve this exact content.\n";
      const saved = await write({
        path,
        content,
        scope: "personal",
        mime: null,
        visibility: null,
      });
      expect(JSON.stringify(saved)).not.toContain("mixes invalid placeholders");
      const row = await resourceGetByPath(owner, path);
      expect(row?.content).toBe(content);
      expect(row?.visibility).toBe("workspace");
      expect(row?.createdBy).toBe("agent");
      expect(row?.mimeType).toBe("text/markdown");
      const newEntries = await createResourceScriptEntries();
      const reopened = await newEntries.resources.run({
        action: "read",
        path,
        scope: "personal",
      });
      expect(reopened).toContain("Preserve this exact content.");
      await write({ path, content: null, scope: "personal" });
      expect((await resourceGetByPath(owner, path))?.content).toBe(content);
      await write({
        path,
        content: "",
        scope: "personal",
        mime: "",
        visibility: "",
      });
      expect((await resourceGetByPath(owner, path))?.content).toBe("");
    } finally {
      const entries = await createResourceScriptEntries();
      await entries.resources.run({
        action: "delete",
        path,
        scope: "personal",
      });
      expect(await resourceGetByPath(owner, path)).toBeNull();
    }
  });
});
it("a write with the read's revision keeps a save made since the read", async () => {
  const owner = "qa-resource-revision@example.com",
    path = "notes/qa-resource-revision.md";
  await runWithRequestContext({ userEmail: owner }, async () => {
    const entries = await createResourceScriptEntries();
    const read = async () => {
      const out = String(
        await entries.resources.run({
          action: "read",
          path,
          scope: "personal",
        }),
      );
      const line = out.match(/^\[revision (\S+), scope personal\]\n/);
      expect(line).not.toBeNull();
      if (!line) throw new Error(`Missing revision line: ${out}`);
      return { revision: line[1], content: out.slice(line[0].length) };
    };
    const write = (input: Record<string, unknown>) =>
      entries["write-resource"].run({
        path,
        scope: "personal",
        visibility: "workspace",
        ...input,
      });
    expect(await resourceGetByPath(owner, path)).toBeNull();
    try {
      await write({ content: "first" });
      const first = await read();
      expect(first.content).toBe("first");

      await resourcePut(owner, path, "theirs");
      const refused = String(
        await write({ content: "mine", expectedRevision: first.revision }),
      );
      expect(refused).toContain("changed after you read it");
      expect((await resourceGetByPath(owner, path))?.content).toBe("theirs");

      const second = await read();
      expect(second.content).toBe("theirs");
      expect(second.revision).not.toBe(first.revision);
      const written = String(
        await write({
          content: "theirs and mine",
          expectedRevision: second.revision,
        }),
      );
      expect(written).toContain("Wrote resource");
      const row = await resourceGetByPath(owner, path);
      expect(row?.content).toBe("theirs and mine");
      expect(row?.visibility).toBe("workspace");
      expect((await read()).revision).not.toBe(second.revision);
    } finally {
      await entries.resources.run({
        action: "delete",
        path,
        scope: "personal",
      });
      expect(await resourceGetByPath(owner, path)).toBeNull();
    }
  });
});
