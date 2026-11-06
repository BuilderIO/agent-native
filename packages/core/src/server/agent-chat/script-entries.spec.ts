import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ActionContractError,
  DEFAULT_TOOL_RESULT_CHARS,
} from "../../action.js";
import type { ActionEntry } from "../../agent/production-agent.js";
import * as resourceStore from "../../resources/store.js";
import { runWithRequestContext } from "../request-context.js";
import {
  createAgentEngineScriptEntries,
  createCallAgentScriptEntry,
  createChatScriptEntries,
  createDocsScriptEntries,
  createResourceScriptEntries,
} from "./script-entries.js";

describe("resources action reads", () => {
  let entry: ActionEntry;
  let fixture: resourceStore.Resource;
  let fixtures: resourceStore.Resource[];
  beforeEach(async () => {
    fixture = {
      id: "range-fixture",
      owner: "reader@example.test",
      path: "notes/read.md",
      content: "A😀BC",
      mimeType: "text/markdown",
      size: 7,
      createdAt: 0,
      updatedAt: 0,
      createdBy: "user",
      visibility: "workspace",
      threadId: null,
      runId: null,
      expiresAt: null,
      metadata: null,
    };
    fixtures = [fixture];
    vi.spyOn(resourceStore, "ensurePersonalDefaults").mockResolvedValue();
    vi.spyOn(resourceStore, "resourceGetByPath").mockImplementation(
      async (owner, path) =>
        fixtures.find(
          (resource) => resource.owner === owner && resource.path === path,
        ) ?? null,
    );
    entry = (await createResourceScriptEntries()).resources;
    expect(entry).toBeDefined();
  });
  afterEach(() => vi.restoreAllMocks());
  const read = (args: Record<string, unknown> = {}, maxResultChars?: number) =>
    runWithRequestContext({ userEmail: "reader@example.test" }, () =>
      entry.run(
        { action: "read", path: "notes/read.md", ...args },
        maxResultChars === undefined ? undefined : { maxResultChars },
      ),
    );

  it("returns an explicit range through the real factory and checked resolver", async () => {
    const output = await read({ scope: "personal", offset: 2, limit: 1 });
    expect(output).toBe(
      "😀\n\n...[Returned 2 characters; 5 total; next offset 3]",
    );
    expect(await read({ offset: 3, limit: 100 })).toBe(
      "BC\n\n[Returned 2 characters; end of resource]",
    );
  });

  it.each([
    ["shared", "Shared"],
    ["workspace", "Workspace"],
  ])(
    "forwards the requested path and %s scope for range reads",
    async (scope, content) => {
      for (const [owner, text] of [
        [fixture.owner, "Personal"],
        [resourceStore.SHARED_OWNER, "Shared"],
        [resourceStore.WORKSPACE_OWNER, "Workspace"],
      ]) {
        fixtures.push(
          { ...fixture, owner, content: `Other ${text}` },
          { ...fixture, owner, path: "notes/selected.md", content: text },
        );
      }
      expect(
        await read({ path: "notes/selected.md", scope, offset: 0, limit: 100 }),
      ).toBe(
        `${content}\n\n[Returned ${content.length} characters; end of resource]`,
      );
    },
  );

  it.each([
    {
      content: "---\nname: test\n---\r\n" + "A😀é👩‍👧\ud800\t ".repeat(20),
      limit: Number.MAX_SAFE_INTEGER,
    },
    { content: "A\udc00B", limit: 1 },
    { content: "😀\udc00B", limit: 2 },
  ])(
    "reconstructs unchanged text from actual delivered counts within a supplied allowance: %j",
    async ({ content, limit }) => {
      fixture.content = content;
      const chunks: string[] = [];
      let offset = 0;
      for (let page = 0; page <= fixture.content.length; page++) {
        const output = await read({ offset, limit }, 90);
        expect(output.length).toBeLessThanOrEqual(90);
        const match =
          /\n\n(?:\.\.\.)?\[Returned ([\d,]+) characters; (?:(\d[\d,]*) total; next offset ([\d,]+)|end of resource)\]$/.exec(
            output,
          );
        expect(match).not.toBeNull();
        if (!match) throw new Error("Missing continuation footer");
        const count = Number(match[1].replaceAll(",", ""));
        const body = output.slice(0, match.index);
        expect(body).toHaveLength(count);
        chunks.push(body);
        if (!match[3]) {
          expect(match[0].startsWith("\n\n[Returned")).toBe(true);
          break;
        }
        expect(match[0].startsWith("\n\n...[Returned")).toBe(true);
        expect(Number(match[2].replaceAll(",", ""))).toBe(
          fixture.content.length,
        );
        expect(count).toBeGreaterThan(0);
        const next = Number(match[3].replaceAll(",", ""));
        expect(
          next,
          "Continuation must advance beyond the incoming offset",
        ).toBeGreaterThan(offset);
        expect(next).toBe(offset + count);
        offset = next;
      }
      expect(chunks.join("")).toBe(fixture.content);
      expect(chunks.length).toBeGreaterThan(1);
    },
  );

  it("uses the existing default allowance when invoked without context", async () => {
    fixture.content = "a".repeat(DEFAULT_TOOL_RESULT_CHARS + 100);
    const output = await read({ offset: 0, limit: 1_000_000 });
    expect(output.length).toBe(DEFAULT_TOOL_RESULT_CHARS);
    expect(output).toBe(
      "a".repeat(49933) +
        "\n\n...[Returned 49,933 characters; 50,100 total; next offset 49,933]",
    );
  });

  it.each([
    { offset: 0 },
    { limit: 1 },
    { offset: "0", limit: "1" },
    { offset: null, limit: false },
    { offset: undefined, limit: undefined },
    { offset: 0, limit: 0 },
    { offset: -1, limit: 1 },
    { offset: 0.5, limit: 1 },
    { offset: 0, limit: Number.MAX_SAFE_INTEGER + 1 },
    { path: 12, offset: 0, limit: 1 },
    { path: {}, offset: 0, limit: 1 },
    { path: "", offset: 0, limit: 1 },
    { scope: null, offset: 0, limit: 1 },
    { scope: false, offset: 0, limit: 1 },
    { scope: {}, offset: 0, limit: 1 },
    ...["list", "effective", "write", "promote", "delete"].map((action) => ({
      action,
      offset: 0,
      limit: 1,
    })),
  ])("rejects malformed direct range calls %j", async (args) => {
    await expect(read(args)).rejects.toMatchObject({
      errorCode: "invalid_resource_range",
    });
    expect(resourceStore.resourceGetByPath).not.toHaveBeenCalled();
  });

  it("keeps legacy raw, empty and diagnostic capture output", async () => {
    expect(await read()).toBe(fixture.content);
    fixture.content = "";
    expect(await read()).toBe("(no output)");
    expect(await read({ offset: 0, limit: 1 })).toBe(
      "\n\n[Returned 0 characters; end of resource]",
    );
    vi.mocked(resourceStore.resourceGetByPath).mockResolvedValue(null);
    expect(await read()).toBe(
      "Resource not found: notes/read.md. You can create it with resource-write.",
    );
    await expect(read({ offset: 0, limit: 1 })).rejects.toMatchObject({
      errorCode: "resource_not_found",
      statusCode: 404,
    });
    expect(await read({ path: undefined })).toBe(
      "Error: path is required for read",
    );
    await expect(
      read({ path: undefined, offset: 0, limit: 1 }),
    ).rejects.toMatchObject({ errorCode: "invalid_resource_range" });
  });

  it("checks the complete skill before a range beyond its restrictive frontmatter", async () => {
    const labs = await import("../agents-bundle.js");
    vi.spyOn(labs, "getEnabledSkillLabsForUser").mockResolvedValue(new Set());
    fixture.path = "skills/private/SKILL.md";
    fixture.content = "---\nrequires-lab: private.preview\n---\nPrivate body";
    await expect(
      read({ path: fixture.path, offset: 40, limit: 1 }),
    ).rejects.toMatchObject({
      errorCode: "skill_lab_required",
      statusCode: 403,
    });
  });

  it("preserves a typed unavailable-Lab-settings failure from the checked resolver", async () => {
    const labs = await import("../agents-bundle.js");
    vi.spyOn(labs, "getEnabledSkillLabsForUser").mockRejectedValue(
      new Error("Settings unavailable"),
    );
    fixture.path = "skills/private/SKILL.md";
    fixture.content = "---\nrequires-lab: private.preview\n---\nPrivate body";
    await expect(
      read({ path: fixture.path, offset: 40, limit: 1 }),
    ).rejects.toEqual(
      expect.objectContaining({
        constructor: ActionContractError,
        errorCode: "skill_lab_check_failed",
        statusCode: 503,
      }),
    );
  });

  it("denies an image subfile under a disabled Lab-gated skill before exposing its URL", async () => {
    const labs = await import("../agents-bundle.js");
    vi.spyOn(labs, "getEnabledSkillLabsForUser").mockResolvedValue(new Set());
    fixtures.push({
      ...fixture,
      path: "skills/private/SKILL.md",
      content: "---\nrequires-lab: private.preview\n---\nPrivate body",
    });
    fixture.path = "skills/private/image.png";
    fixture.mimeType = "image/png";
    fixture.content = "https://example.test/private.png";
    await expect(
      read({ path: fixture.path, offset: 1, limit: 1 }, fixture.content.length),
    ).rejects.toEqual(
      expect.objectContaining({
        constructor: ActionContractError,
        errorCode: "skill_lab_required",
        statusCode: 403,
      }),
    );
  });

  it("propagates a native storage rejection without capturing it or reporting a missing resource", async () => {
    const error = new Error("Resource storage unavailable");
    vi.mocked(resourceStore.resourceGetByPath).mockRejectedValue(error);
    await expect(read({ offset: 0, limit: 1 })).rejects.toBe(error);
  });

  it("returns non-inline content whole after checked resolution", async () => {
    fixture.mimeType = "application/xml";
    fixture.content = "<root>stored 😀 text</root>";
    expect(
      await read(
        { scope: "personal", offset: 10, limit: 1 },
        fixture.content.length,
      ),
    ).toBe(fixture.content);
  });
});

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
      "Shared writes, promotions, and deletions require per-action approval",
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
