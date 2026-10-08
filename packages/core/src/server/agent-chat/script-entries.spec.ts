import { describe, expect, it } from "vitest";

import {
  createAgentEngineScriptEntries,
  createCallAgentScriptEntry,
  createChatScriptEntries,
  createDocsScriptEntries,
  createResourceScriptEntries,
} from "./script-entries.js";

function classify(
  entry: { planMode?: { effect?: unknown } },
  args: Record<string, unknown>,
) {
  const effect = entry.planMode?.effect;
  expect(typeof effect).toBe("function");
  if (typeof effect !== "function") throw new Error("Missing classifier");
  return effect(args);
}

describe("cross-app script entries", () => {
  it("describes docs-search as an instruction and documentation reader", async () => {
    const entries = await createDocsScriptEntries();

    expect(entries["framework-search"]?.readOnly).toBe(true);
    expect(entries["framework-search"]?.tool.description).toContain(
      "Core, Toolkit",
    );
    expect(entries["source-search"]?.readOnly).toBe(true);
    expect(entries["source-search"]?.tool.description).toContain(
      "opt-in corpus",
    );
    const docsSearch = entries["docs-search"]?.tool;
    expect(docsSearch?.description).toContain(
      "Read bundled framework/app instructions, framework docs, and codebase skills",
    );
    expect(docsSearch?.description).toContain(
      "exact skill-<name> slug shown in the prompt",
    );
    expect(docsSearch?.description).toContain(
      "Use --query only when the page or slug is unknown",
    );
    expect(docsSearch?.description).toContain(
      "not tool discovery; use tool-search",
    );
    expect(Object.keys(docsSearch?.parameters.properties ?? {})).toEqual([
      "query",
      "slug",
      "list",
    ]);
  });

  it("keeps discovery read-only without treating delegation as read-only", async () => {
    const entries = await createCallAgentScriptEntry("analytics");

    expect(entries["describe-workspace-apps"]?.readOnly).toBe(true);
    expect(entries["call-agent"]?.readOnly).not.toBe(true);
  });

  it("allows only exact direct cross-app action reads in Plan mode", async () => {
    const entry = (await createCallAgentScriptEntry("analytics"))["call-agent"];

    expect(
      classify(entry, {
        agent: "clips",
        action: "get-recording",
        input: { id: "clip-1" },
      }),
    ).toBe("read");
    expect(
      classify(entry, {
        agent: "clips",
        action: "get-recording",
        input: {},
        message: "also summarize it",
      }),
    ).toBe("write");
    expect(
      classify(entry, {
        agent: "clips",
        action: "get-recording",
      }),
    ).toBe("unknown");
    expect(
      classify(entry, {
        agent: "clips",
        message: "summarize this clip",
      }),
    ).toBe("write");
    expect(entry.planMode?.allowedProperties).toEqual([
      "agent",
      "action",
      "input",
    ]);
    expect(entry.planMode?.requiredProperties).toEqual(["agent", "action"]);
  });
});

describe("mixed script entry Plan-mode effects", () => {
  it("limits resources, chat history, and engine management to reads", async () => {
    const resources = (await createResourceScriptEntries()).resources;
    const chats = (await createChatScriptEntries())["chat-history"];
    const engines = (await createAgentEngineScriptEntries("analytics"))[
      "manage-agent-engine"
    ];

    expect(classify(resources, { action: "list" })).toBe("read");
    expect(classify(resources, { action: "read", path: "AGENTS.md" })).toBe(
      "read",
    );
    expect(classify(resources, { action: "write" })).toBe("write");
    expect(resources.tool.description).toContain(
      "A generic request to remember something is not approval",
    );
    expect(classify(chats, { action: "search" })).toBe("read");
    expect(classify(chats, { action: "open" })).toBe("write");
    expect(classify(engines, { action: "list" })).toBe("read");
    expect(classify(engines, { action: "set" })).toBe("write");
  });

  it("requires fresh approval for shared resource mutations", async () => {
    const resources = (await createResourceScriptEntries()).resources;
    const requiresApproval = resources.needsApproval;
    expect(typeof requiresApproval).toBe("function");
    if (typeof requiresApproval !== "function") {
      throw new Error("Missing shared-resource approval gate");
    }

    expect(
      await requiresApproval({ action: "write", path: "LEARNINGS.md" }),
    ).toBe(true);
    expect(
      await requiresApproval({
        action: "write",
        path: "memory/project.md",
        scope: "shared",
      }),
    ).toBe(true);
    expect(
      await requiresApproval({
        action: "delete",
        path: "memory/project.md",
        scope: "shared",
      }),
    ).toBe(true);
    expect(
      await requiresApproval({
        action: "promote",
        path: "memory/project.md",
        scope: "shared",
      }),
    ).toBe(true);
    expect(
      await requiresApproval({
        action: "write",
        path: "LEARNINGS.md",
        scope: "personal",
      }),
    ).toBe(false);
    expect(
      await requiresApproval({
        action: "read",
        path: "LEARNINGS.md",
        scope: "shared",
      }),
    ).toBe(false);
    expect(resources.allowPersistentApproval).toBe(false);
  });

  it("requires fresh approval for organization-wide save-memory writes", async () => {
    const entries = await createResourceScriptEntries();
    const saveMemory = entries["save-memory"];
    const requiresApproval = saveMemory.needsApproval;
    expect(typeof requiresApproval).toBe("function");
    if (typeof requiresApproval !== "function") {
      throw new Error("Missing organization-memory approval gate");
    }

    expect(await requiresApproval({ scope: "current-org" })).toBe(true);
    expect(await requiresApproval({ scope: "personal" })).toBe(false);
    expect(await requiresApproval({})).toBe(false);
    expect(saveMemory.allowPersistentApproval).toBe(false);
    expect(saveMemory.tool.parameters.properties.scope.enum).toEqual([
      "personal",
      "current-org",
    ]);
  });
});
