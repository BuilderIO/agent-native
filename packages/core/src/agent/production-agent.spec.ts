import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { AgentActionStopError } from "../action.js";
import { MCP_ACTION_RESULT_MARKER } from "../mcp-client/app-result.js";
import { __resetAgentsBundleCache } from "../server/agents-bundle.js";
import {
  getRequestRunContext,
  runWithRequestContext,
} from "../server/request-context.js";
import type {
  AgentEngine,
  EngineEvent,
  EngineStreamOptions,
} from "./engine/types.js";
import { EngineError } from "./engine/types.js";
import {
  AGENT_INTERNAL_CONTINUE_PROMPT,
  appendAgentLoopContinuation,
  backgroundContinuationReasonForRun,
  buildFirstRequestPayloadDetail,
  buildUserContentWithAttachments,
  claimBackgroundWorkerRunEarly,
  createPlanModeActionRegistry,
  isPlanModeToolCallAllowed,
  isContextTooLongError,
  isRetryableError,
  actionsToEngineTools,
  filterInitialEngineTools,
  MAX_BACKGROUND_RUN_CONTINUATIONS,
  lastUnfinishedPreparingActionToolFromEvents,
  markBackgroundContinuationChunkTerminal,
  resolveAgentOwnerEmail,
  resolveBackgroundDispatchOutcome,
  resolveFinalResponseGuardRequestText,
  resolveAgentRequestReasoningEffort,
  resolveSkillReferenceContent,
  runAgentLoop,
  runAgentLoopWithMainChatInternalContinuations,
  shouldChainBackgroundContinuation,
  shouldGuardRepeatedSourceSweep,
  structuredHistoryToEngineMessages,
  trimOldToolResults,
  type ActionEntry,
  type AgentLoopFinalResponseGuardContext,
} from "./production-agent.js";
import type { ActiveRun } from "./run-manager.js";
import { attachToolSearch, searchToolRegistry } from "./tool-search.js";
import type { AgentChatEvent, RunEvent } from "./types.js";

function actionEntry(opts: {
  description?: string;
  readOnly?: boolean;
  allowInPlanMode?: boolean;
  parallelSafe?: boolean;
  actions?: string[];
}): ActionEntry {
  return {
    tool: {
      description: opts.description ?? "Test action",
      parameters: opts.actions
        ? {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: opts.actions,
              },
            },
            required: ["action"],
          }
        : {
            type: "object",
            properties: {},
          },
    },
    ...(typeof opts.readOnly === "boolean" ? { readOnly: opts.readOnly } : {}),
    ...(typeof opts.allowInPlanMode === "boolean"
      ? { allowInPlanMode: opts.allowInPlanMode }
      : {}),
    ...(typeof opts.parallelSafe === "boolean"
      ? { parallelSafe: opts.parallelSafe }
      : {}),
    run: async (args) => `ran:${JSON.stringify(args)}`,
  };
}

describe("resolveAgentRequestReasoningEffort", () => {
  it("defaults missing reasoning to Medium", () => {
    expect(
      resolveAgentRequestReasoningEffort({ model: "claude-sonnet-5" }),
    ).toBe("medium");
  });

  it("preserves explicit none through the production request path", () => {
    expect(
      resolveAgentRequestReasoningEffort({
        model: "claude-sonnet-5",
        requestEffort: "none",
        configuredEffort: "high",
      }),
    ).toBe("none");
  });
});

describe("resolveSkillReferenceContent", () => {
  it("does not resolve scope: dev codebase skills for runtime agent references", async () => {
    const previousCwd = process.cwd();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-skill-ref-"));
    try {
      fs.mkdirSync(path.join(root, ".agents", "skills", "runtime-skill"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(root, ".agents", "skills", "runtime-skill", "SKILL.md"),
        "---\nname: runtime-skill\n---\nRuntime content.",
      );
      fs.mkdirSync(path.join(root, ".agents", "skills", "dev-skill"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(root, ".agents", "skills", "dev-skill", "SKILL.md"),
        "---\nname: dev-skill\nscope: dev\n---\nDev content.",
      );

      process.chdir(root);
      __resetAgentsBundleCache();

      await expect(
        resolveSkillReferenceContent({
          type: "skill",
          name: "runtime-skill",
          path: ".agents/skills/runtime-skill/SKILL.md",
          source: "codebase",
        }),
      ).resolves.toContain("Runtime content.");
      await expect(
        resolveSkillReferenceContent({
          type: "skill",
          name: "dev-skill",
          path: ".agents/skills/dev-skill/SKILL.md",
          source: "codebase",
        }),
      ).resolves.toBeNull();
    } finally {
      process.chdir(previousCwd);
      __resetAgentsBundleCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("buildUserContentWithAttachments", () => {
  it("preserves the prompt text when there are no attachments", () => {
    expect(buildUserContentWithAttachments({ text: "Hello" })).toEqual([
      { type: "text", text: "Hello" },
    ]);
  });

  it("adds supported image attachments before the prompt text", () => {
    expect(
      buildUserContentWithAttachments({
        text: "Describe this",
        attachments: [
          {
            type: "image",
            name: "screen.png",
            contentType: "image/png",
            data: "data:image/png;base64,aW1hZ2U=",
          },
        ],
      }),
    ).toEqual([
      { type: "image", mediaType: "image/png", data: "aW1hZ2U=" },
      { type: "text", text: "Describe this" },
    ]);
  });

  it("keeps hosted image URLs in text context instead of sending malformed URL image parts", () => {
    const att = {
      type: "image",
      name: "screen.png",
      contentType: "image/png",
      data: "data:image/png;base64,aW1hZ2U=",
    };
    (att as any).url = "https://cdn.example.com/screen.png";

    expect(
      buildUserContentWithAttachments({
        text: "Embed this image",
        attachments: [att as any],
      }),
    ).toEqual([
      { type: "image", mediaType: "image/png", data: "aW1hZ2U=" },
      { type: "text", text: "Embed this image" },
    ]);
  });

  it("includes text and file attachments in the text sent to the engine", () => {
    const content = buildUserContentWithAttachments({
      text: "Summarize the attachment",
      attachments: [
        {
          type: "file",
          name: 'notes "qa".txt',
          contentType: "text/plain",
          text: "Line one\nLine two",
        },
        {
          type: "file",
          name: "empty.txt",
          contentType: "text/plain",
          text: "",
        },
      ],
    });

    expect(content).toHaveLength(1);
    expect(content[0]).toMatchObject({ type: "text" });
    expect(content[0].type === "text" ? content[0].text : "").toBe(
      '<attachment name="notes &quot;qa&quot;.txt" contentType="text/plain" type="file">\n' +
        "Line one\nLine two\n" +
        "</attachment>\n\n" +
        "Summarize the attachment",
    );
  });

  it("unwraps and truncates oversized text attachments before model input", () => {
    const longBody = "A".repeat(60_010);
    const content = buildUserContentWithAttachments({
      text: "Summarize the transcript",
      attachments: [
        {
          type: "file",
          name: "transcript.txt",
          contentType: "text/plain",
          text: `<attachment name=transcript.txt>\n${longBody}\n</attachment>`,
        },
      ],
    });

    const text = content[0].type === "text" ? content[0].text : "";
    expect(text).toContain("A".repeat(60_000));
    expect(text).toContain(
      "[Attachment truncated after 60,000 characters; 10 characters omitted",
    );
    expect(text).not.toContain("<attachment name=transcript.txt>");
    expect(text).toContain("Summarize the transcript");
  });

  it("caps the aggregate text from multiple attachments", () => {
    const content = buildUserContentWithAttachments({
      text: "Compare these files",
      attachments: [
        {
          type: "file",
          name: "first.md",
          contentType: "text/markdown",
          text: "A".repeat(60_000),
        },
        {
          type: "file",
          name: "second.md",
          contentType: "text/markdown",
          text: "B".repeat(60_000),
        },
        {
          type: "file",
          name: "third.md",
          contentType: "text/markdown",
          text: "C".repeat(10_000),
        },
      ],
    });

    const text = content[0].type === "text" ? content[0].text : "";
    expect(text).toContain("A".repeat(60_000));
    expect(text).toContain("B".repeat(20_000));
    expect(text).not.toContain("B".repeat(20_001));
    expect(text).toContain(
      "[Attachment content omitted from the initial request; 10,000 characters available.",
    );
    expect(text).toContain(
      'Use the `read-attachment` tool with name="third.md" to read the rest.',
    );
  });

  it("adds binary file attachments before the prompt text", () => {
    expect(
      buildUserContentWithAttachments({
        text: "Use this reference",
        attachments: [
          {
            type: "file",
            name: "reference.pdf",
            contentType: "application/pdf",
            data: "data:application/pdf;base64,JVBERi0x",
          },
        ],
      }),
    ).toEqual([
      {
        type: "file",
        mediaType: "application/pdf",
        filename: "reference.pdf",
        data: "JVBERi0x",
      },
      { type: "text", text: "Use this reference" },
    ]);
  });

  it("injects a text placeholder for unsupported image media types instead of silently dropping them", () => {
    const result = buildUserContentWithAttachments({
      text: "Can you read this SVG?",
      attachments: [
        {
          type: "image",
          name: "icon.svg",
          contentType: "image/svg+xml",
          data: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
        },
      ],
    });
    // Should be a single text part that contains both the placeholder and the user prompt
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
    const text = (result[0] as { type: "text"; text: string }).text;
    expect(text).toContain('"icon.svg"');
    expect(text).toContain("image/svg+xml");
    expect(text).toContain("unsupported image format");
    expect(text).toContain("Can you read this SVG?");
  });

  it("injects a placeholder for HEIC images (common iPhone format)", () => {
    const result = buildUserContentWithAttachments({
      text: "Here is my photo",
      attachments: [
        {
          type: "image",
          name: "photo.heic",
          contentType: "image/heic",
          data: "data:image/heic;base64,abc123",
        },
      ],
    });
    expect(result).toHaveLength(1);
    const text = (result[0] as { type: "text"; text: string }).text;
    expect(text).toContain("image/heic");
    expect(text).toContain("unsupported image format");
  });

  it("keeps uploaded SVGs as text references instead of vision image parts", () => {
    const att = {
      type: "image",
      name: "logo.svg",
      contentType: "image/svg+xml",
      data: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    };
    (att as any).url = "https://cdn.example.com/logo.svg";

    const result = buildUserContentWithAttachments({
      text: "Use this logo in the deck",
      attachments: [att as any],
    });

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
    const text = (result[0] as { type: "text"; text: string }).text;
    expect(text).toContain("logo.svg");
    expect(text).toContain("https://cdn.example.com/logo.svg");
    expect(text).toContain("SVG reference");
    expect(text).toContain("reference-only vector files");
    expect(text).not.toContain("unsupported image format");
    expect(text).not.toContain("ask them to convert");
    expect(text).toContain("Use this logo in the deck");
  });

  it("does not send reference-only uploaded SVGs as raw file parts", () => {
    const att = {
      type: "file",
      name: "logo.svg",
      contentType: "image/svg+xml",
      data: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    };
    (att as any).url = "https://cdn.example.com/logo.svg";
    (att as any).referenceOnly = true;

    const result = buildUserContentWithAttachments({
      text: "Use this logo in the deck",
      attachments: [att as any],
    });

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
    const text = (result[0] as { type: "text"; text: string }).text;
    expect(text).toContain("reference-only file");
    expect(text).toContain("https://cdn.example.com/logo.svg");
    expect(text).toContain("Use this logo in the deck");
  });

  it("preserves orphan tool-results as text so history is not lost before backfill", () => {
    // No assistant tool-call ever exists for `t1`. Emitting a synthetic
    // `tool-result` would be stripped later anyway; converting to text keeps
    // the payload visible and lets `backfillEngineMessagesToolResults` run on
    // the full engine message list consistently.
    expect(
      structuredHistoryToEngineMessages([
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "t1",
              content: "stale tool output",
            },
          ],
        },
      ]),
    ).toEqual([
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "(Omitted unmatched tool results from replayed history.) [tool_use_id=t1] stale tool output",
          },
        ],
      },
    ]);
  });

  it("appends a text note when a sibling tool-result is orphaned", () => {
    expect(
      structuredHistoryToEngineMessages([
        {
          role: "user",
          content: [
            { type: "text", text: "Here's some context." },
            {
              type: "tool-result",
              toolCallId: "ghost",
              content: "stale",
            },
          ],
        },
      ]),
    ).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Here's some context." },
          {
            type: "text",
            text: "(Omitted unmatched tool results from replayed history.) [tool_use_id=ghost] stale",
          },
        ],
      },
    ]);
  });

  it("coerces non-string tool_result fields from older DB JSON", () => {
    expect(
      structuredHistoryToEngineMessages([
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "99",
              toolName: "search",
              args: { q: "x" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: 99 as any,
              toolName: "search",
              content: { hits: 3 } as any,
            },
          ],
        },
      ]),
    ).toEqual([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            id: "99",
            name: "search",
            input: { q: "x" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "99",
            toolName: "search",
            toolInput: '{"q":"x"}',
            content: '{"hits":3}',
          },
        ],
      },
    ]);
  });

  it("synthesizes interrupted results for replayed tool calls without results", () => {
    expect(
      structuredHistoryToEngineMessages([
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "history_tc_1",
              toolName: "chat-history",
              args: { action: "search" },
            },
          ],
        },
      ]),
    ).toEqual([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            id: "history_tc_1",
            name: "chat-history",
            input: { action: "search" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "history_tc_1",
            toolName: "chat-history",
            toolInput: '{"action":"search"}',
            content: "Interrupted before this tool returned a result.",
          },
        ],
      },
    ]);
  });

  it("normalizes structured chat history with tool calls and results", () => {
    expect(
      structuredHistoryToEngineMessages([
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "tc_1",
              toolName: "get-document",
              args: { id: "doc-1" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "tc_1",
              toolName: "get-document",
              toolInput: '{"id":"doc-1"}',
              content: '{"title":"Offsite rambles"}',
            },
          ],
        },
      ]),
    ).toEqual([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            id: "tc_1",
            name: "get-document",
            input: { id: "doc-1" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc_1",
            toolName: "get-document",
            toolInput: '{"id":"doc-1"}',
            content: '{"title":"Offsite rambles"}',
          },
        ],
      },
    ]);
  });

  it("builds a plan-mode registry with read-only tools and blocked stubs", async () => {
    const registry = attachToolSearch({
      read: actionEntry({ readOnly: true }),
      "read-but-act-only": actionEntry({
        readOnly: true,
        allowInPlanMode: false,
      }),
      write: actionEntry({ readOnly: false }),
      bash: actionEntry({ readOnly: false }),
      "set-url-path": actionEntry({ readOnly: true }),
      resources: actionEntry({
        actions: ["list", "read", "write", "delete"],
      }),
    });

    const planRegistry = createPlanModeActionRegistry(registry);

    expect(
      actionsToEngineTools(planRegistry)
        .map((tool) => tool.name)
        .sort(),
    ).toEqual([
      "bash",
      "read",
      "read-but-act-only",
      "resources",
      "set-url-path",
      "tool-search",
      "write",
    ]);
    await expect(planRegistry.write.run({})).resolves.toContain(
      "Plan mode blocked `write`",
    );
    await expect(planRegistry["read-but-act-only"].run({})).resolves.toContain(
      "Plan mode blocked `read-but-act-only`",
    );
    expect(
      planRegistry.resources.tool.parameters?.properties.action.enum,
    ).toEqual(["list", "read"]);
    await expect(
      planRegistry.resources.run({ action: "read" }),
    ).resolves.toContain('"action":"read"');
    await expect(
      planRegistry.resources.run({ action: "write" }),
    ).resolves.toContain("Plan mode blocked");
    await expect(
      planRegistry.bash.run({ command: "rg button src" }),
    ).resolves.toContain('"command":"rg button src"');
    await expect(
      planRegistry.bash.run({ command: "echo hi > notes.txt" }),
    ).resolves.toContain("Plan mode blocked");
    await expect(
      planRegistry.bash.run({ command: "rg button; node -e '1'" }),
    ).resolves.toContain("Plan mode blocked");

    const searchResult = await planRegistry["tool-search"].run({
      query: "write file",
    } as any);
    expect(searchResult.results.map((tool: any) => tool.name)).toContain(
      "write",
    );
    const writeTool = searchResult.results.find(
      (tool: any) => tool.name === "write",
    );
    expect(writeTool.description).toContain("Plan mode blocked");
  });

  it("keeps the default initial catalog to discovery/runtime tools", () => {
    const tools = actionsToEngineTools(
      attachToolSearch({
        starter: actionEntry({ readOnly: true }),
        "provider-api-request": actionEntry({ readOnly: true }),
        "provider-api-docs": actionEntry({ readOnly: true }),
        "run-code": actionEntry({ readOnly: true }),
        "get-extension": actionEntry({ readOnly: true }),
        "update-extension": actionEntry({ readOnly: false }),
        "account-deep-dive": actionEntry({ readOnly: true }),
        "hubspot-deals": actionEntry({ readOnly: true }),
        "hubspot-metrics": actionEntry({ readOnly: true }),
        "gong-calls": actionEntry({ readOnly: true }),
        gcloud: actionEntry({ readOnly: true }),
        "ordinary-rare-tool": actionEntry({ readOnly: true }),
      }),
    );

    const initialTools = filterInitialEngineTools(tools, ["starter"]).map(
      (tool) => tool.name,
    );

    expect(initialTools).toContain("starter");
    expect(initialTools).toContain("tool-search");
    expect(initialTools).not.toContain("provider-api-request");
    expect(initialTools).not.toContain("provider-api-docs");
    expect(initialTools).not.toContain("run-code");
    expect(initialTools).not.toContain("get-extension");
    expect(initialTools).not.toContain("update-extension");
    expect(initialTools).not.toContain("account-deep-dive");
    expect(initialTools).not.toContain("hubspot-deals");
    expect(initialTools).not.toContain("hubspot-metrics");
    expect(initialTools).not.toContain("gong-calls");
    expect(initialTools).not.toContain("gcloud");
    expect(initialTools).not.toContain("ordinary-rare-tool");
  });

  it("adds universal discovery tools to a configured starter list", () => {
    const tools = actionsToEngineTools(
      attachToolSearch({
        resources: actionEntry({ readOnly: true }),
        "docs-search": actionEntry({ readOnly: true }),
        "get-framework-context": actionEntry({ readOnly: true }),
        "read-attachment": actionEntry({ readOnly: true }),
        "mcp__huge__rare-tool": actionEntry({ readOnly: true }),
      }),
    );

    expect(
      filterInitialEngineTools(tools, ["mcp__huge__rare-tool"]).map(
        (tool) => tool.name,
      ),
    ).toEqual([
      "resources",
      "docs-search",
      "get-framework-context",
      "read-attachment",
      "mcp__huge__rare-tool",
      "tool-search",
    ]);
  });

  it("records first-request prompt and tool payload sizes without content", () => {
    const detail = buildFirstRequestPayloadDetail({
      isFirstRequest: true,
      systemPrompt: "system",
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      tools: [
        {
          name: "hello",
          description: "Say hello",
          inputSchema: { type: "object", properties: {} },
        },
      ],
      availableToolCount: 500,
    });

    expect(detail).toContain("first_request_system_chars=6");
    expect(detail).toContain("first_request_tool_count=1");
    expect(detail).toContain("first_request_available_tool_count=500");
    expect(detail).not.toContain("hello");
  });

  it("compacts repeated identical tool-search calls within one agent run", async () => {
    const registry = attachToolSearch({
      "hubspot-deals": actionEntry({
        readOnly: true,
        description: "Search HubSpot deals",
      }),
      "hubspot-records": actionEntry({
        readOnly: true,
        description: "Read HubSpot records",
      }),
    });

    await runWithRequestContext(
      { userEmail: "agent@example.com", run: {} },
      () => {
        const first = searchToolRegistry(registry, {
          query: "hubspot",
        } as any);
        const second = searchToolRegistry(registry, {
          query: "hubspot",
        } as any) as any;

        expect(first.results.map((result) => result.name)).toEqual([
          "hubspot-deals",
          "hubspot-records",
        ]);
        expect(second.repeated).toBe(true);
        expect(second.message).toContain("already ran");
        expect(second.results.map((result: any) => result.name)).toEqual([
          "hubspot-deals",
          "hubspot-records",
        ]);
      },
    );
  });

  it("does not compact repeated includeSchemas tool-search calls", async () => {
    const registry = attachToolSearch({
      "hubspot-deals": actionEntry({
        readOnly: true,
        description: "Search HubSpot deals",
      }),
    });

    await runWithRequestContext(
      { userEmail: "agent@example.com", run: {} },
      () => {
        const first = searchToolRegistry(registry, {
          query: "hubspot",
          includeSchemas: true,
        } as any) as any;
        const second = searchToolRegistry(registry, {
          query: "hubspot",
          includeSchemas: true,
        } as any) as any;

        expect(first.repeated).toBeUndefined();
        expect(second.repeated).toBeUndefined();
        expect(second.results[0].inputSchema).toBeDefined();
      },
    );
  });

  it("warns that no-query tool-search menu results do not load schemas", () => {
    const registry = attachToolSearch({
      "hubspot-deals": actionEntry({
        readOnly: true,
        description: "Search HubSpot deals",
      }),
    });

    const result = searchToolRegistry(registry, {});

    expect(result.results.map((tool) => tool.name)).toContain("hubspot-deals");
    expect(result.message).toContain("does not load schemas");
    expect(result.message).toContain("tool-search again with a specific query");
  });

  it("treats mixed tools as read-only only for allowed arguments", () => {
    const webRequest = actionEntry({ readOnly: true });
    expect(
      isPlanModeToolCallAllowed("web-request", { method: "GET" }, webRequest),
    ).toBe(true);
    expect(
      isPlanModeToolCallAllowed("web-request", { method: "POST" }, webRequest),
    ).toBe(false);

    const urlTool = actionEntry({ readOnly: true });
    expect(isPlanModeToolCallAllowed("set-url-path", {}, urlTool)).toBe(false);

    const readOnlyActOnlyTool = actionEntry({
      readOnly: true,
      allowInPlanMode: false,
    });
    expect(
      isPlanModeToolCallAllowed("deep-analysis", {}, readOnlyActOnlyTool),
    ).toBe(false);

    const bashTool = actionEntry({ readOnly: false });
    expect(
      isPlanModeToolCallAllowed("bash", { command: "rg button src" }, bashTool),
    ).toBe(true);
    expect(
      isPlanModeToolCallAllowed(
        "bash",
        { command: "echo hi > notes.txt" },
        bashTool,
      ),
    ).toBe(false);
    expect(
      isPlanModeToolCallAllowed(
        "bash",
        { command: "rg button; node -e '1'" },
        bashTool,
      ),
    ).toBe(false);
  });
});

describe("resolveAgentOwnerEmail", () => {
  it("uses the explicit owner resolver when provided", async () => {
    const owner = await runWithRequestContext(
      { userEmail: "context@example.com", run: {} },
      () =>
        resolveAgentOwnerEmail(
          { resolveOwnerEmail: async () => "resolved@example.com" },
          {},
        ),
    );

    expect(owner).toBe("resolved@example.com");
  });

  it("falls back to the request context owner", async () => {
    const owner = await runWithRequestContext(
      { userEmail: "context@example.com", run: {} },
      () => resolveAgentOwnerEmail({}, {}),
    );

    expect(owner).toBe("context@example.com");
  });
});

describe("runAgentLoop", () => {
  it("does not expand the active tool list after no-query tool-search menu results", async () => {
    const actions = attachToolSearch({
      starter: actionEntry({
        description: "Starter tool",
        readOnly: true,
      }),
      "hidden-tool": {
        ...actionEntry({
          description: "Hidden forms sharing tool",
          readOnly: true,
        }),
        run: async () => "hidden ran",
      },
    });
    const allTools = actionsToEngineTools(actions);
    const initialTools = allTools.filter((tool) =>
      ["starter", "tool-search"].includes(tool.name),
    );
    const seenTools: string[][] = [];
    let streamCalls = 0;

    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(opts): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        seenTools.push(opts.tools.map((tool) => tool.name));
        if (streamCalls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "tool-search-menu",
                name: "tool-search",
                input: {},
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "done" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: initialTools,
      availableTools: allTools,
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions,
      send: () => {},
      signal: new AbortController().signal,
    });

    expect(seenTools[0]).toEqual(["starter", "tool-search"]);
    expect(seenTools[1]).toEqual(["starter", "tool-search"]);
  });

  it("expands the provider tool list after tool-search returns matches", async () => {
    const actions = attachToolSearch({
      starter: actionEntry({
        description: "Starter tool",
        readOnly: true,
      }),
      "hidden-tool": {
        ...actionEntry({
          description: "Hidden forms sharing tool",
          readOnly: true,
        }),
        run: async () => "hidden ran",
      },
    });
    const allTools = actionsToEngineTools(actions);
    const initialTools = allTools.filter((tool) =>
      ["starter", "tool-search"].includes(tool.name),
    );
    const seenTools: string[][] = [];
    let streamCalls = 0;

    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(opts): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        seenTools.push(opts.tools.map((tool) => tool.name));
        if (streamCalls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "tool-search-1",
                name: "tool-search",
                input: { query: "hidden sharing" },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        if (streamCalls === 2) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "hidden-1",
                name: "hidden-tool",
                input: {},
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "done" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: initialTools,
      availableTools: allTools,
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions,
      send: () => {},
      signal: new AbortController().signal,
    });

    expect(seenTools[0]).toEqual(["starter", "tool-search"]);
    expect(seenTools[1]).toContain("hidden-tool");
    expect(seenTools[2]).toContain("hidden-tool");
  });

  it("expands the full authorized tool surface for a guarded corrective retry", async () => {
    const actions = attachToolSearch({
      starter: actionEntry({
        description: "Starter tool",
        readOnly: true,
      }),
      "query-data": {
        ...actionEntry({
          description: "Query the real data source",
          readOnly: true,
        }),
        run: async () => ({ rows: [{ count: 3 }] }),
      },
    });
    const allTools = actionsToEngineTools(actions);
    const initialTools = filterInitialEngineTools(allTools, ["starter"]);
    const seenTools: string[][] = [];
    let streamCalls = 0;

    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(opts): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        seenTools.push(opts.tools.map((tool) => tool.name));
        if (streamCalls === 1) {
          yield { type: "text-delta", text: "No data source was queried." };
          yield {
            type: "assistant-content",
            parts: [
              { type: "text" as const, text: "No data source was queried." },
            ],
          };
          yield { type: "stop", reason: "end_turn" };
          return;
        }
        if (streamCalls === 2) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "query-data-1",
                name: "query-data",
                input: { sql: "select count(*)" },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield { type: "text-delta", text: "The real count is 3." };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "The real count is 3." }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const guard = vi.fn((context: AgentLoopFinalResponseGuardContext) =>
      context.toolResults.some((result) => result.name === "query-data")
        ? null
        : {
            retryMessage: "Query the real data source before answering.",
            fallbackMessage: "No grounded result is available.",
            maxRetries: 1,
            expandToolSurface: true,
          },
    );

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: initialTools,
      availableTools: allTools,
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions,
      send: () => {},
      signal: new AbortController().signal,
      finalResponseGuard: guard,
    });

    expect(seenTools[0]).not.toContain("query-data");
    expect(seenTools[1]).toContain("query-data");
    expect(streamCalls).toBe(3);
    expect(guard).toHaveBeenCalledTimes(2);
  });

  it("passes the central default max output token cap to the engine", async () => {
    let seenMaxOutputTokens: number | undefined;
    const engine: AgentEngine = {
      name: "ai-sdk:openrouter",
      label: "OpenRouter",
      defaultModel: "openai/gpt-5.5",
      supportedModels: ["openai/gpt-5.5"],
      capabilities: {
        thinking: true,
        promptCaching: true,
        vision: true,
        computerUse: false,
        parallelToolCalls: true,
      },
      async *stream(opts): AsyncIterable<EngineEvent> {
        seenMaxOutputTokens = opts.maxOutputTokens;
        yield { type: "text-delta", text: "done" };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "done" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };

    await runAgentLoop({
      engine,
      model: "openai/gpt-5.5",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {},
      send: () => {},
      signal: new AbortController().signal,
    });

    // OpenRouter default was raised from 1024 to 8192 to avoid truncation.
    expect(seenMaxOutputTokens).toBe(8192);
  });

  it("continues internally when a response reaches the output token cap", async () => {
    let streamCalls = 0;
    const seenMessages: any[] = [];
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(opts): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        seenMessages.push(JSON.stringify(opts.messages));
        if (streamCalls === 1) {
          yield { type: "text-delta", text: "partial " };
          yield {
            type: "assistant-content",
            parts: [{ type: "text" as const, text: "partial " }],
          };
          yield { type: "stop", reason: "max_tokens" };
          return;
        }
        yield { type: "text-delta", text: "finish" };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "finish" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const events: any[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {},
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    expect(streamCalls).toBe(2);
    expect(seenMessages.at(-1)).toContain("output-token cap");
    expect(events).toContainEqual({ type: "text", text: "partial " });
    expect(events).toContainEqual({ type: "text", text: "finish" });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("emits activity while a tool input is being assembled", async () => {
    let streamCalls = 0;
    let now = 1_000_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    const engine: AgentEngine = {
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
        streamCalls += 1;
        if (streamCalls === 1) {
          yield {
            type: "tool-input-start",
            id: "tool-create",
            name: "create-document",
          };
          now += 2_000;
          yield {
            type: "tool-input-delta",
            id: "tool-create",
            text: '{"title"',
          };
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "tool-create",
                name: "create-document",
                input: { title: "New doc" },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield { type: "text-delta", text: "done" };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "done" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const events: any[] = [];

    try {
      await runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {
          "create-document": actionEntry({ readOnly: false }),
        },
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      });
    } finally {
      dateNow.mockRestore();
    }

    expect(events).toContainEqual({
      type: "activity",
      label: "Preparing create-document action",
      tool: "create-document",
      id: "tool-create",
    });
    expect(events).toContainEqual({
      type: "activity",
      label: "Preparing create-document action",
      tool: "create-document",
      id: "tool-create",
      progressBytes: 8,
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_start",
        tool: "create-document",
      }),
    );
  });

  it("checkpoints when action input preparation stops streaming bytes", async () => {
    let now = 1_000_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    const engine: AgentEngine = {
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
        yield {
          type: "tool-input-start",
          id: "tool-edit",
          name: "edit-design",
        };
        now += 91_000;
        yield { type: "gateway-heartbeat" };
        yield { type: "text-delta", text: "should not continue" };
      },
    };
    const events: AgentChatEvent[] = [];

    try {
      await runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {
          "edit-design": actionEntry({ readOnly: false }),
        },
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      });
    } finally {
      dateNow.mockRestore();
    }

    expect(events).toContainEqual({
      type: "activity",
      label: "Preparing edit-design action",
      tool: "edit-design",
      id: "tool-edit",
    });
    expect(events.at(-1)).toEqual({
      type: "auto_continue",
      reason: "no_progress",
    });
    expect(events).not.toContainEqual({ type: "stream_keepalive" });
    expect(events).not.toContainEqual({ type: "done" });
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "text", text: "should not continue" }),
    );
  });

  it("continues main chat internally after a no-progress action preparation checkpoint", async () => {
    let now = 1_000_000;
    let attempts = 0;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    const engine: AgentEngine = {
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
        attempts++;
        if (attempts === 1) {
          yield {
            type: "tool-input-start",
            id: "tool-edit",
            name: "edit-design",
          };
          now += 91_000;
          yield { type: "gateway-heartbeat" };
          yield { type: "text-delta", text: "should not continue" };
          return;
        }
        yield { type: "text-delta", text: "continued" };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "continued" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const events: AgentChatEvent[] = [];
    const guard = vi.fn(() => null);
    const messages = [
      {
        role: "user" as const,
        content: [{ type: "text" as const, text: "go" }],
      },
    ];

    try {
      await runAgentLoopWithMainChatInternalContinuations({
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages,
        actions: {
          "edit-design": actionEntry({ readOnly: false }),
        },
        send: (event) => events.push(event),
        signal: new AbortController().signal,
        finalResponseGuard: guard,
      });
    } finally {
      dateNow.mockRestore();
    }

    expect(attempts).toBe(2);
    const continuationText = messages
      .map((message) =>
        message.content[0]?.type === "text" ? message.content[0].text : "",
      )
      .find((text) => text.includes(AGENT_INTERNAL_CONTINUE_PROMPT));
    expect(continuationText).toContain(AGENT_INTERNAL_CONTINUE_PROMPT);
    expect(continuationText).toContain(
      "preparing the `edit-design` action input",
    );
    expect(events).toContainEqual({ type: "clear" });
    expect(events).toContainEqual({ type: "text", text: "continued" });
    expect(events).toContainEqual({ type: "done" });
    expect(guard).toHaveBeenCalledTimes(1);
    expect(guard.mock.calls[0]?.[0].requestText).toBe("go");
    expect(events).not.toContainEqual({
      type: "auto_continue",
      reason: "no_progress",
    });
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "text", text: "should not continue" }),
    );
  });

  it("checkpoints when zero-byte action input preparation goes silent", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const engine: AgentEngine = {
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
        yield {
          type: "tool-input-delta",
          id: "tool-edit",
          name: "edit-design",
          text: "",
        };
        await new Promise(() => {});
      },
    };
    const events: AgentChatEvent[] = [];

    try {
      const run = runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {
          "edit-design": actionEntry({ readOnly: false }),
        },
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(events).toContainEqual({
        type: "activity",
        label: "Preparing edit-design action",
        tool: "edit-design",
        id: "tool-edit",
        progressBytes: 0,
      });

      await vi.advanceTimersByTimeAsync(90_000);
      await run;
    } finally {
      vi.useRealTimers();
    }

    expect(events.at(-1)).toEqual({
      type: "auto_continue",
      reason: "no_progress",
    });
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "tool_start" }),
    );
  });

  it("clears the action-preparation timeout when the stream rejects", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const engine: AgentEngine = {
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
        yield {
          type: "tool-input-start",
          id: "tool-edit",
          name: "edit-design",
        };
        throw new Error("fatal stream exploded");
      },
    };
    const events: AgentChatEvent[] = [];

    try {
      await expect(
        runAgentLoop({
          engine,
          model: "test-model",
          systemPrompt: "system",
          tools: [],
          messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
          actions: {
            "edit-design": actionEntry({ readOnly: false }),
          },
          send: (event) => events.push(event),
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow("fatal stream exploded");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }

    expect(events).toContainEqual({
      type: "activity",
      label: "Preparing edit-design action",
      tool: "edit-design",
      id: "tool-edit",
    });
  });

  // ─── FIX 2: foreground first-model-event no-progress cap ───────────────────
  // A hung FIRST engine-stream event previously rode the full 90s
  // MODEL_STREAM_NO_PROGRESS_TIMEOUT_MS watchdog before auto_continue could
  // fire — but the clamped ~40s HOSTED foreground runtime is killed before
  // that watchdog ever gets a chance, so the run died as a silent platform
  // kill instead of a recoverable checkpoint.
  // FOREGROUND_FIRST_MODEL_EVENT_TIMEOUT_MS (25s) closes that gap — gated on
  // `isHostedRuntime() && !isInBackgroundFunctionRuntime()`, so local dev /
  // self-hosted runtimes (no soft-timeout regime, no platform wall) and
  // proven background-function workers keep the full 90s window. See
  // production-agent.ts for the ordering invariant.

  // Every env var the two runtime predicates read (`isHostedRuntime` in
  // run-manager.ts; `isInBackgroundFunctionRuntime` in durable-background.ts).
  // Snapshot + clear them all so each test pins BOTH predicates explicitly,
  // regardless of the machine/CI environment the suite happens to run on.
  function snapshotAndClearRuntimePredicateEnv(): () => void {
    // Keep each deployment flag explicit. Dynamic process.env indexing is
    // forbidden in credential-adjacent agent code, including tests, because it
    // can conceal an unscoped credential read. Vitest restores the original
    // host values when the test finishes.
    vi.stubEnv("NETLIFY", "");
    vi.stubEnv("NETLIFY_LOCAL", "");
    vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", "");
    vi.stubEnv("AGENT_CHAT_FORCE_BACKGROUND_RUNTIME", "");
    vi.stubEnv("CF_PAGES", "");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("RENDER", "");
    vi.stubEnv("FLY_APP_NAME", "");
    vi.stubEnv("K_SERVICE", "");
    return () => vi.unstubAllEnvs();
  }
  const hangingFirstEventEngine = (): AgentEngine => ({
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
      // Zero tokens, ever — mirrors the incident's hung first model call.
      await new Promise(() => {});
    },
  });

  it("FIX 2: a hung FIRST model event triggers auto_continue at 25s on the HOSTED foreground runtime", async () => {
    const restoreEnv = snapshotAndClearRuntimePredicateEnv();
    // Hosted (non-background Lambda name, e.g. the regular `server` function)
    // + not a background-function runtime: the exact clamped runtime from the
    // incident.
    process.env.AWS_LAMBDA_FUNCTION_NAME = "server";
    vi.useFakeTimers({ now: 1_000_000 });
    const events: AgentChatEvent[] = [];

    try {
      const run = runAgentLoop({
        engine: hangingFirstEventEngine(),
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {},
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      });

      // Just past the 25s foreground cap, comfortably under the normal 90s
      // watchdog — only the tightened first-event deadline explains a fire
      // this early.
      await vi.advanceTimersByTimeAsync(26_000);
      await run;
    } finally {
      vi.useRealTimers();
      restoreEnv();
    }

    expect(events.at(-1)).toEqual({
      type: "auto_continue",
      reason: "no_progress",
    });
  });

  it("FIX 2: a hung FIRST model event keeps the full 90s window on a NON-HOSTED runtime (local dev / self-hosted)", async () => {
    // All hosted markers cleared — resolveRunSoftTimeoutMs resolves to 0
    // here (no soft-timeout regime, no platform wall), so a genuinely slow
    // first token (large local contexts, slow local providers) must NOT be
    // chopped at 25s.
    const restoreEnv = snapshotAndClearRuntimePredicateEnv();
    vi.useFakeTimers({ now: 1_000_000 });
    const events: AgentChatEvent[] = [];

    try {
      const run = runAgentLoop({
        engine: hangingFirstEventEngine(),
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {},
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      });

      // Past the 25s cap — a non-hosted runtime must be unaffected by it.
      await vi.advanceTimersByTimeAsync(26_000);
      expect(events).toHaveLength(0);

      // The normal 90s in-loop watchdog still applies and eventually fires.
      await vi.advanceTimersByTimeAsync(90_000 - 26_000);
      await run;
    } finally {
      vi.useRealTimers();
      restoreEnv();
    }

    expect(events.at(-1)).toEqual({
      type: "auto_continue",
      reason: "no_progress",
    });
  });

  it("FIX 2: a hung FIRST model event does NOT fire early when proven to be running inside a background function", async () => {
    const restoreEnv = snapshotAndClearRuntimePredicateEnv();
    // Hosted AND proven background-function runtime (`-background` Lambda
    // name) — the 15-min budget applies, so the cap must stay off.
    process.env.AWS_LAMBDA_FUNCTION_NAME = "server-agent-background";
    vi.useFakeTimers({ now: 1_000_000 });
    const events: AgentChatEvent[] = [];

    try {
      const run = runAgentLoop({
        engine: hangingFirstEventEngine(),
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {},
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      });

      // Past the 25s foreground cap — a proven background-function worker
      // must be unaffected by it.
      await vi.advanceTimersByTimeAsync(26_000);
      expect(events).toHaveLength(0);

      // The normal 90s watchdog still applies and eventually fires.
      await vi.advanceTimersByTimeAsync(90_000 - 26_000);
      await run;
    } finally {
      vi.useRealTimers();
      restoreEnv();
    }

    expect(events.at(-1)).toEqual({
      type: "auto_continue",
      reason: "no_progress",
    });
  });

  it("FIX 2: a gap AFTER the first event keeps the normal 90s window on the HOSTED foreground runtime", async () => {
    const restoreEnv = snapshotAndClearRuntimePredicateEnv();
    process.env.AWS_LAMBDA_FUNCTION_NAME = "server";
    vi.useFakeTimers({ now: 1_000_000 });
    const engine: AgentEngine = {
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
        // A real first event arrives promptly...
        yield { type: "text-delta", text: "thinking" };
        // ...then the stream goes silent. Only the FIRST await on a fresh
        // model call is capped at 25s — this gap must ride the normal 90s
        // watchdog even though it also exceeds 25s.
        await new Promise(() => {});
      },
    };
    const events: AgentChatEvent[] = [];

    try {
      const run = runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {},
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      });

      await vi.advanceTimersByTimeAsync(26_000);
      expect(events).not.toContainEqual(
        expect.objectContaining({ type: "auto_continue" }),
      );

      await vi.advanceTimersByTimeAsync(90_000 - 26_000);
      await run;
    } finally {
      vi.useRealTimers();
      restoreEnv();
    }

    expect(events.at(-1)).toEqual({
      type: "auto_continue",
      reason: "no_progress",
    });
  });

  it("closes the event stream after an action-preparation stall", async () => {
    let now = 1_000_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    const returnSpy = vi.fn(async () => ({ done: true, value: undefined }));
    const engine: AgentEngine = {
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
      stream(): AsyncIterable<EngineEvent> {
        let step = 0;
        return {
          [Symbol.asyncIterator]() {
            return {
              async next() {
                if (step === 0) {
                  step += 1;
                  return {
                    done: false,
                    value: {
                      type: "tool-input-start",
                      id: "tool-edit",
                      name: "edit-design",
                    },
                  };
                }
                now += 91_000;
                return {
                  done: false,
                  value: { type: "gateway-heartbeat" },
                };
              },
              return: returnSpy,
            };
          },
        };
      },
    };
    const events: AgentChatEvent[] = [];

    try {
      await runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {
          "edit-design": actionEntry({ readOnly: false }),
        },
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      });
    } finally {
      dateNow.mockRestore();
    }

    expect(returnSpy).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toEqual({
      type: "auto_continue",
      reason: "no_progress",
    });
    expect(events).not.toContainEqual({ type: "stream_keepalive" });
  });

  it("checkpoints when the model stream goes keepalive-only after a tool result", async () => {
    let now = 1_000_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    let streamCount = 0;
    const engine: AgentEngine = {
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
        streamCount += 1;
        if (streamCount === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "tool-snapshot",
                name: "get-design-snapshot",
                input: { designId: "design-1", fileId: "file-1" },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        now += 91_000;
        yield { type: "gateway-heartbeat" };
        yield { type: "text-delta", text: "should not continue" };
      },
    };
    const events: AgentChatEvent[] = [];

    try {
      await runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {
          "get-design-snapshot": actionEntry({ readOnly: true }),
        },
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      });
    } finally {
      dateNow.mockRestore();
    }

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "get-design-snapshot",
      }),
    );
    expect(events.at(-1)).toEqual({
      type: "auto_continue",
      reason: "no_progress",
    });
    expect(events).not.toContainEqual({ type: "stream_keepalive" });
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "text", text: "should not continue" }),
    );
  });

  it("keeps a model stream alive when non-heartbeat events continue", async () => {
    let now = 1_000_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    const engine: AgentEngine = {
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
        now += 45_000;
        yield { type: "gateway-heartbeat" };
        now += 44_000;
        yield { type: "text-delta", text: "still alive" };
        now += 89_000;
        yield { type: "gateway-heartbeat" };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "still alive" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const events: AgentChatEvent[] = [];

    try {
      await runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {},
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      });
    } finally {
      dateNow.mockRestore();
    }

    expect(events).toContainEqual({ type: "text", text: "still alive" });
    expect(events).toContainEqual({ type: "done" });
    expect(events).not.toContainEqual({
      type: "auto_continue",
      reason: "no_progress",
    });
  });

  it("keeps tracking a stalled action input across assistant snapshots", async () => {
    let now = 1_000_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    const engine: AgentEngine = {
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
        yield {
          type: "tool-input-start",
          id: "tool-edit",
          name: "edit-design",
        };
        yield {
          type: "assistant-content",
          parts: [{ type: "text", text: "previous assistant text snapshot" }],
        };
        now += 91_000;
        yield { type: "gateway-heartbeat" };
        yield { type: "text-delta", text: "should not continue" };
      },
    };
    const events: AgentChatEvent[] = [];

    try {
      await runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {
          "edit-design": actionEntry({ readOnly: false }),
        },
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      });
    } finally {
      dateNow.mockRestore();
    }

    expect(events).toContainEqual({
      type: "activity",
      label: "Preparing edit-design action",
      tool: "edit-design",
      id: "tool-edit",
    });
    expect(events.at(-1)).toEqual({
      type: "auto_continue",
      reason: "no_progress",
    });
    expect(events).not.toContainEqual({ type: "stream_keepalive" });
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "text", text: "should not continue" }),
    );
  });

  it("tracks a zero-byte action input delta without a start event", async () => {
    let now = 1_000_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    const engine: AgentEngine = {
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
        yield { type: "gateway-heartbeat" };
        now += 10_000;
        yield {
          type: "tool-input-delta",
          id: "tool-edit",
          name: "edit-design",
          text: "",
        };
        now += 91_000;
        yield { type: "gateway-heartbeat" };
        yield { type: "text-delta", text: "should not continue" };
      },
    };
    const events: AgentChatEvent[] = [];

    try {
      await runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {
          "edit-design": actionEntry({ readOnly: false }),
        },
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      });
    } finally {
      dateNow.mockRestore();
    }

    expect(events).toContainEqual({
      type: "activity",
      label: "Preparing edit-design action",
      tool: "edit-design",
      id: "tool-edit",
      progressBytes: 0,
    });
    expect(events.at(-1)).toEqual({
      type: "auto_continue",
      reason: "no_progress",
    });
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "text", text: "should not continue" }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "tool_start" }),
    );
  });

  it("keeps tracking stalled action input after a prepared tool-call snapshot", async () => {
    let now = 1_000_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    const engine: AgentEngine = {
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
        yield {
          type: "tool-input-start",
          id: "tool-edit",
          name: "edit-design",
        };
        now += 1_600;
        yield {
          type: "tool-input-delta",
          id: "tool-edit",
          text: '{"designId":"design-1"',
        };
        yield {
          type: "assistant-content",
          parts: [
            {
              type: "tool-call",
              id: "tool-edit",
              name: "edit-design",
              input: { designId: "design-1" },
            },
          ],
        };
        now += 91_000;
        yield { type: "gateway-heartbeat" };
        yield { type: "text-delta", text: "should not continue" };
      },
    };
    const events: AgentChatEvent[] = [];

    try {
      await runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {
          "edit-design": actionEntry({ readOnly: false }),
        },
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      });
    } finally {
      dateNow.mockRestore();
    }

    expect(events).toContainEqual({
      type: "activity",
      label: "Preparing edit-design action",
      tool: "edit-design",
      id: "tool-edit",
      progressBytes: 22,
    });
    expect(events.at(-1)).toEqual({
      type: "auto_continue",
      reason: "no_progress",
    });
    expect(events).not.toContainEqual({ type: "stream_keepalive" });
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "text", text: "should not continue" }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "tool_start" }),
    );
  });

  it("checkpoints a stalled action input before accepting a delayed progress event", async () => {
    let now = 1_000_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    const engine: AgentEngine = {
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
        yield {
          type: "tool-input-start",
          id: "tool-edit",
          name: "edit-design",
        };
        now += 91_000;
        yield {
          type: "tool-input-delta",
          id: "tool-edit",
          text: "delayed bytes",
        };
        yield {
          type: "assistant-content",
          parts: [
            {
              type: "tool-call" as const,
              id: "tool-edit",
              name: "edit-design",
              input: { replacementContent: "late" },
            },
          ],
        };
      },
    };
    const events: AgentChatEvent[] = [];

    try {
      await runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {
          "edit-design": actionEntry({ readOnly: false }),
        },
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      });
    } finally {
      dateNow.mockRestore();
    }

    expect(events).toContainEqual({
      type: "activity",
      label: "Preparing edit-design action",
      tool: "edit-design",
      id: "tool-edit",
    });
    expect(events.at(-1)).toEqual({
      type: "auto_continue",
      reason: "no_progress",
    });
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: "activity",
        progressBytes: expect.any(Number),
      }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "tool_start" }),
    );
  });

  it("checkpoints repeated zero-byte action input restarts", async () => {
    let now = 1_000_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    const engine: AgentEngine = {
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
        yield {
          type: "tool-input-start",
          id: "tool-edit-a",
          name: "edit-design",
        };
        yield {
          type: "assistant-content",
          parts: [],
        };
        now += 45_000;
        yield {
          type: "tool-input-start",
          id: "tool-edit-b",
          name: "edit-design",
        };
        yield {
          type: "assistant-content",
          parts: [],
        };
        now += 46_000;
        yield {
          type: "tool-input-start",
          id: "tool-edit-c",
          name: "edit-design",
        };
        yield { type: "text-delta", text: "should not continue" };
      },
    };
    const events: AgentChatEvent[] = [];

    try {
      await runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {
          "edit-design": actionEntry({ readOnly: false }),
        },
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      });
    } finally {
      dateNow.mockRestore();
    }

    expect(
      events.filter(
        (event) => event.type === "activity" && event.tool === "edit-design",
      ).length,
    ).toBeGreaterThanOrEqual(2);
    expect(events.at(-1)).toEqual({
      type: "auto_continue",
      reason: "no_progress",
    });
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "text", text: "should not continue" }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "tool_start" }),
    );
  });

  it("checkpoints repeated zero-byte action input deltas with fresh ids", async () => {
    let now = 1_000_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    const engine: AgentEngine = {
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
        yield {
          type: "tool-input-delta",
          id: "tool-edit-a",
          name: "edit-design",
          text: "",
        };
        yield { type: "gateway-heartbeat" };
        now += 45_000;
        yield {
          type: "tool-input-delta",
          id: "tool-edit-b",
          name: "edit-design",
          text: "",
        };
        yield { type: "gateway-heartbeat" };
        now += 46_000;
        yield {
          type: "tool-input-delta",
          id: "tool-edit-c",
          name: "edit-design",
          text: "",
        };
        yield { type: "text-delta", text: "should not continue" };
      },
    };
    const events: AgentChatEvent[] = [];

    try {
      await runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {
          "edit-design": actionEntry({ readOnly: false }),
        },
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      });
    } finally {
      dateNow.mockRestore();
    }

    expect(
      events.filter(
        (event) =>
          event.type === "activity" &&
          event.tool === "edit-design" &&
          event.progressBytes === 0,
      ).length,
    ).toBeGreaterThanOrEqual(2);
    expect(events.at(-1)).toEqual({
      type: "auto_continue",
      reason: "no_progress",
    });
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "text", text: "should not continue" }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "tool_start" }),
    );
  });

  it("does not treat fresh zero-byte action input ids as progress", async () => {
    let now = 1_000_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    const engine: AgentEngine = {
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
        yield {
          type: "tool-input-delta",
          id: "tool-edit-a",
          name: "edit-design",
          text: "",
        };
        now += 45_000;
        yield {
          type: "tool-input-delta",
          id: "tool-edit-b",
          name: "edit-design",
          text: "",
        };
        now += 44_000;
        yield {
          type: "tool-input-delta",
          id: "tool-edit-c",
          name: "edit-design",
          text: "",
        };
        now += 2_000;
        yield { type: "gateway-heartbeat" };
        yield { type: "text-delta", text: "should not continue" };
      },
    };
    const events: AgentChatEvent[] = [];

    try {
      await runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {
          "edit-design": actionEntry({ readOnly: false }),
        },
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      });
    } finally {
      dateNow.mockRestore();
    }

    expect(
      events.filter(
        (event) =>
          event.type === "activity" &&
          event.tool === "edit-design" &&
          event.progressBytes === 0,
      ).length,
    ).toBeGreaterThanOrEqual(2);
    expect(events.at(-1)).toEqual({
      type: "auto_continue",
      reason: "no_progress",
    });
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "text", text: "should not continue" }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "tool_start" }),
    );
  });

  it("keeps a fresh action-input id streaming after an abandoned zero-byte id", async () => {
    let now = 1_000_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    const engine: AgentEngine = {
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
        yield {
          type: "tool-input-delta",
          id: "tool-edit-abandoned",
          name: "edit-design",
          text: "",
        };
        now += 45_000;
        yield {
          type: "tool-input-delta",
          id: "tool-edit-replacement",
          name: "edit-design",
          text: '{"replacementContent":"first bytes',
        };
        now += 46_000;
        yield {
          type: "tool-input-delta",
          id: "tool-edit-replacement",
          name: "edit-design",
          text: ' and still streaming"}',
        };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "done" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const events: AgentChatEvent[] = [];

    try {
      await runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {
          "edit-design": actionEntry({ readOnly: false }),
        },
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      });
    } finally {
      dateNow.mockRestore();
    }

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "activity",
        tool: "edit-design",
        id: "tool-edit-replacement",
        progressBytes: 56,
      }),
    );
    expect(events).not.toContainEqual({
      type: "auto_continue",
      reason: "no_progress",
    });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("keeps a fresh read-only input id streaming after an abandoned zero-byte id", async () => {
    let now = 1_000_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    const engine: AgentEngine = {
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
        yield {
          type: "tool-input-delta",
          id: "search-abandoned",
          name: "search",
          text: "",
        };
        now += 45_000;
        yield {
          type: "tool-input-delta",
          id: "search-replacement",
          name: "search",
          text: '{"query":"first bytes',
        };
        now += 46_000;
        yield {
          type: "tool-input-delta",
          id: "search-replacement",
          name: "search",
          text: ' and still streaming"}',
        };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "done" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const events: AgentChatEvent[] = [];

    try {
      await runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {
          search: actionEntry({ readOnly: true }),
        },
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      });
    } finally {
      dateNow.mockRestore();
    }

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "activity",
        tool: "search",
        id: "search-replacement",
        progressBytes: 43,
      }),
    );
    expect(events).not.toContainEqual({
      type: "auto_continue",
      reason: "no_progress",
    });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("keeps a different tool streaming after an abandoned zero-byte tool", async () => {
    let now = 1_000_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    const engine: AgentEngine = {
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
        yield {
          type: "tool-input-delta",
          id: "edit-abandoned",
          name: "edit-design",
          text: "",
        };
        now += 89_000;
        yield {
          type: "tool-input-delta",
          id: "generate-replacement",
          name: "generate-design",
          text: '{"prompt":"fresh generated screen',
        };
        now += 2_000;
        yield { type: "text-delta", text: "still preparing" };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "done" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const events: AgentChatEvent[] = [];

    try {
      await runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {
          "edit-design": actionEntry({ readOnly: false }),
          "generate-design": actionEntry({ readOnly: false }),
        },
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      });
    } finally {
      dateNow.mockRestore();
    }

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "activity",
        tool: "generate-design",
        id: "generate-replacement",
        progressBytes: 33,
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "text", text: "still preparing" }),
    );
    expect(events).not.toContainEqual({
      type: "auto_continue",
      reason: "no_progress",
    });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("keeps parallel-safe same-action input stalls tracked while a sibling streams", async () => {
    let now = 1_000_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    const engine: AgentEngine = {
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
        yield {
          type: "tool-input-start",
          id: "parallel-search-a",
          name: "search",
        };
        now += 45_000;
        yield {
          type: "tool-input-start",
          id: "parallel-search-b",
          name: "search",
        };
        now += 2_000;
        yield {
          type: "tool-input-delta",
          id: "parallel-search-b",
          name: "search",
          text: '{"query":"healthy sibling',
        };
        now += 44_000;
        yield {
          type: "tool-input-delta",
          id: "parallel-search-b",
          name: "search",
          text: ' still streaming"}',
        };
        yield { type: "text-delta", text: "still preparing" };
        now += 91_000;
        yield { type: "gateway-heartbeat" };
        yield { type: "text-delta", text: "should not continue" };
      },
    };
    const events: AgentChatEvent[] = [];

    try {
      await runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {
          search: actionEntry({ readOnly: false, parallelSafe: true }),
        },
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      });
    } finally {
      dateNow.mockRestore();
    }

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "activity",
        tool: "search",
        id: "parallel-search-b",
        progressBytes: 25,
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "text", text: "still preparing" }),
    );
    expect(events.at(-1)).toEqual({
      type: "auto_continue",
      reason: "no_progress",
    });
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "text", text: "should not continue" }),
    );
  });

  it("keeps delta-only same-action input progress alive while a sibling is silent", async () => {
    let now = 1_000_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    const engine: AgentEngine = {
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
        yield {
          type: "tool-input-delta",
          id: "delta-search-a",
          name: "search",
          text: "",
        };
        now += 45_000;
        yield {
          type: "tool-input-delta",
          id: "delta-search-b",
          name: "search",
          text: "",
        };
        now += 2_000;
        yield {
          type: "tool-input-delta",
          id: "delta-search-c",
          name: "search",
          text: '{"query":"healthy sibling',
        };
        now += 44_000;
        yield {
          type: "tool-input-delta",
          id: "delta-search-c",
          name: "search",
          text: ' still streaming"}',
        };
        yield { type: "text-delta", text: "still preparing" };
        now += 91_000;
        yield { type: "gateway-heartbeat" };
        yield { type: "text-delta", text: "should not continue" };
      },
    };
    const events: AgentChatEvent[] = [];

    try {
      await runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {
          search: actionEntry({ readOnly: true }),
        },
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      });
    } finally {
      dateNow.mockRestore();
    }

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "activity",
        tool: "search",
        id: "delta-search-c",
        progressBytes: 25,
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "text", text: "still preparing" }),
    );
    expect(events.at(-1)).toEqual({
      type: "auto_continue",
      reason: "no_progress",
    });
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "text", text: "should not continue" }),
    );
  });

  it("tracks action-preparation stalls for multiple in-flight tool inputs", async () => {
    let now = 1_000_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    const engine: AgentEngine = {
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
        yield {
          type: "tool-input-start",
          id: "tool-a",
          name: "edit-design",
        };
        now += 30_000;
        yield {
          type: "tool-input-start",
          id: "tool-b",
          name: "generate-design",
        };
        now += 30_000;
        yield {
          type: "tool-input-delta",
          id: "tool-b",
          text: "healthy",
        };
        now += 31_000;
        yield {
          type: "tool-input-delta",
          id: "tool-b",
          text: "still healthy",
        };
        yield { type: "text-delta", text: "still preparing" };
        now += 91_000;
        yield { type: "gateway-heartbeat" };
        yield {
          type: "text-delta",
          text: "should not continue",
        };
      },
    };
    const events: AgentChatEvent[] = [];

    try {
      await runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {
          "edit-design": actionEntry({ readOnly: false }),
          "generate-design": actionEntry({ readOnly: false }),
        },
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      });
    } finally {
      dateNow.mockRestore();
    }

    expect(events).toContainEqual({
      type: "activity",
      label: "Preparing edit-design action",
      tool: "edit-design",
      id: "tool-a",
    });
    expect(events).toContainEqual({
      type: "activity",
      label: "Preparing generate-design action",
      tool: "generate-design",
      id: "tool-b",
    });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "text", text: "still preparing" }),
    );
    expect(events.at(-1)).toEqual({
      type: "auto_continue",
      reason: "no_progress",
    });
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "text", text: "should not continue" }),
    );
  });

  it("keeps assembling a large action input while bytes keep streaming", async () => {
    let now = 1_000_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);
    const engine: AgentEngine = {
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
        yield {
          type: "tool-input-start",
          id: "tool-edit",
          name: "edit-design",
        };
        for (let i = 0; i < 4; i++) {
          now += 60_000;
          yield {
            type: "tool-input-delta",
            id: "tool-edit",
            text: "x".repeat(1024),
          };
        }
        now += 60_000;
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "done" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const events: AgentChatEvent[] = [];

    try {
      await runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {},
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      });
    } finally {
      dateNow.mockRestore();
    }

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "activity",
        tool: "edit-design",
        progressBytes: 4096,
      }),
    );
    expect(events).not.toContainEqual({
      type: "auto_continue",
      reason: "no_progress",
    });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("serializes tool calls when a turn includes mutating actions", async () => {
    let streamCalls = 0;
    const engine: AgentEngine = {
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
        streamCalls += 1;
        if (streamCalls === 1) {
          const parts = [
            {
              type: "tool-call" as const,
              id: "tool-a",
              name: "write-a",
              input: {},
            },
            {
              type: "tool-call" as const,
              id: "tool-b",
              name: "write-b",
              input: {},
            },
          ];
          yield { type: "assistant-content", parts };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "done" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const order: string[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        "write-a": {
          ...actionEntry({ readOnly: false }),
          run: async () => {
            order.push("a:start");
            await new Promise((resolve) => setTimeout(resolve, 10));
            order.push("a:end");
            return "a";
          },
        },
        "write-b": {
          ...actionEntry({ readOnly: false }),
          run: async () => {
            order.push("b:start");
            order.push("b:end");
            return "b";
          },
        },
      },
      send: () => {},
      signal: new AbortController().signal,
    });

    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("runs parallel-safe mutating tool calls concurrently", async () => {
    let streamCalls = 0;
    const engine: AgentEngine = {
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
        streamCalls += 1;
        if (streamCalls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "tool-a",
                name: "write-a",
                input: {},
              },
              {
                type: "tool-call" as const,
                id: "tool-b",
                name: "write-b",
                input: {},
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "done" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    let active = 0;
    let maxActive = 0;
    const run = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return "ok";
    };

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        "write-a": {
          ...actionEntry({ readOnly: false, parallelSafe: true }),
          run,
        },
        "write-b": {
          ...actionEntry({ readOnly: false, parallelSafe: true }),
          run,
        },
      },
      send: () => {},
      signal: new AbortController().signal,
    });

    expect(maxActive).toBe(2);
  });

  it("does not re-run identical read-only tools already present in continuation history", async () => {
    let streamCalls = 0;
    const engine: AgentEngine = {
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
        streamCalls += 1;
        if (streamCalls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "tool-repeat",
                name: "get-document",
                input: { id: "doc-1" },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield { type: "text-delta", text: "answered from history" };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "answered from history" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const readAction = vi.fn(async () => "fresh document");
    const events: any[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "summarize this doc" }],
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              id: "tool-original",
              name: "get-document",
              input: { id: "doc-1" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "tool-original",
              toolName: "get-document",
              toolInput: '{"id":"doc-1"}',
              content: '{"id":"doc-1","title":"Offsite rambles"}',
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `${AGENT_INTERNAL_CONTINUE_PROMPT}\n\nInternal note: retry`,
            },
          ],
        },
      ],
      actions: {
        "get-document": {
          ...actionEntry({ readOnly: true }),
          run: readAction,
        },
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    expect(readAction).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "get-document",
        result: expect.stringContaining("Skipped duplicate read-only call"),
      }),
    );
    expect(events).toContainEqual({
      type: "text",
      text: "answered from history",
    });
  });

  it("adds stop-and-report guidance to provider rate-limit tool errors", async () => {
    let streamCalls = 0;
    const engine: AgentEngine = {
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
        streamCalls += 1;
        if (streamCalls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "tool-rate-limit",
                name: "provider-api-request",
                input: {},
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield { type: "text-delta", text: "reported the gap" };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "reported the gap" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const events: any[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        "provider-api-request": {
          ...actionEntry({ readOnly: true }),
          run: async () => {
            throw new Error("Provider request failed (429): quota exceeded");
          },
        },
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "provider-api-request",
        result: expect.stringContaining(
          "Provider rate-limit guidance: stop retrying this provider",
        ),
      }),
    );
    expect(events).toContainEqual({ type: "text", text: "reported the gap" });
  });

  it("redacts sensitive fields in normal action exception tool results", async () => {
    let streamCalls = 0;
    const seenMessages: any[] = [];
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(opts): AsyncIterable<EngineEvent> {
        seenMessages.push(opts.messages);
        streamCalls += 1;
        if (streamCalls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "tool-redact",
                name: "write-secret",
                input: { id: "row-1" },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield {
          type: "assistant-content",
          parts: [{ type: "text", text: "done" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const events: any[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        "write-secret": {
          ...actionEntry({ readOnly: true }),
          run: async () => {
            throw new Error("DB failed: token=SENSITIVE_VALUE");
          },
        },
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    const toolDone = events.find(
      (event) => event.type === "tool_done" && event.tool === "write-secret",
    );
    expect(toolDone?.result).toContain("DB failed");
    expect(toolDone?.result).toContain("token=[REDACTED]");
    expect(toolDone?.result).not.toContain("SENSITIVE_VALUE");
    expect(JSON.stringify(seenMessages.at(-1))).not.toContain(
      "SENSITIVE_VALUE",
    );
  });

  it("redacts AgentActionStopError message and tool result", async () => {
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        yield {
          type: "assistant-content",
          parts: [
            {
              type: "tool-call" as const,
              id: "tool-stop-redact",
              name: "stop-action",
              input: {},
            },
          ],
        };
        yield { type: "stop", reason: "tool_use" };
      },
    };
    const events: any[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        "stop-action": {
          ...actionEntry({ readOnly: true }),
          run: async () => {
            throw new AgentActionStopError("Stop: password=SENSITIVE_VALUE", {
              toolResult: "Tool failed: token=SENSITIVE_VALUE",
            });
          },
        },
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    expect(JSON.stringify(events)).not.toContain("SENSITIVE_VALUE");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        result: expect.stringContaining("token=[REDACTED]"),
      }),
    );
    expect(events).toContainEqual({
      type: "text",
      text: "Stop: password=[REDACTED]",
    });
  });

  it("validates raw JSON Schema parameters before running an action", async () => {
    let streamCalls = 0;
    const run = vi.fn(async () => "should not run");
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        if (streamCalls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "tool-schema",
                name: "write-sql",
                input: { sql: "UPDATE notes SET title = ?", statements: "[]" },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield {
          type: "assistant-content",
          parts: [{ type: "text", text: "done" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const events: any[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        "write-sql": {
          tool: {
            description: "Write SQL",
            parameters: {
              type: "object",
              properties: {
                sql: { type: "string" },
                statements: { type: "string" },
              },
              oneOf: [{ required: ["sql"] }, { required: ["statements"] }],
            },
          },
          run,
        },
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    expect(run).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "write-sql",
        result: expect.stringContaining(
          "must match exactly one schema in oneOf",
        ),
      }),
    );
  });

  it("rejects null raw JSON Schema parameters instead of validating as an empty object", async () => {
    const run = vi.fn(async () => "should not run");
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        yield {
          type: "assistant-content",
          parts: [
            {
              type: "tool-call" as const,
              id: "tool-schema-null",
              name: "no-args",
              input: null,
            },
          ],
        };
        yield { type: "stop", reason: "tool_use" };
      },
    };
    const events: any[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        "no-args": {
          tool: {
            description: "No args",
            parameters: { type: "object", properties: {} },
          },
          run,
        },
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    expect(run).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "no-args",
        result: expect.stringContaining("must be object"),
      }),
    );
  });

  it("coerces scalar raw JSON Schema parameters before running a tool", async () => {
    const run = vi.fn(async (args) => `includeContent=${args.includeContent}`);
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        yield {
          type: "assistant-content",
          parts: [
            {
              type: "tool-call" as const,
              id: "tool-schema-coerce",
              name: "get-extension",
              input: { id: "ext-1", includeContent: "true" },
            },
          ],
        };
        yield { type: "stop", reason: "tool_use" };
      },
    };
    const events: any[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        "get-extension": {
          tool: {
            description: "Get extension",
            parameters: {
              type: "object",
              properties: {
                id: { type: "string" },
                includeContent: { type: "boolean" },
              },
              required: ["id"],
            },
          },
          readOnly: true,
          run,
        },
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ includeContent: true }),
      expect.anything(),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "get-extension",
        result: "includeContent=true",
      }),
    );
  });

  it("does not seed read-only duplicate cache from invalid parameter results", async () => {
    const run = vi.fn(async () => "should not run");
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        yield {
          type: "assistant-content",
          parts: [
            {
              type: "tool-call" as const,
              id: "tool-schema-repeat",
              name: "get-extension",
              input: { id: "ext-1", includeContent: "yes" },
            },
          ],
        };
        yield { type: "stop", reason: "tool_use" };
      },
    };
    const events: any[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [
        { role: "user", content: [{ type: "text", text: "fix extension" }] },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              id: "prior-invalid",
              name: "get-extension",
              input: { id: "ext-1", includeContent: "yes" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "prior-invalid",
              toolName: "get-extension",
              toolInput: '{"id":"ext-1","includeContent":"yes"}',
              content:
                "Invalid action parameters for get-extension: input/includeContent must be boolean.",
            },
          ],
        },
        {
          role: "user",
          content: [{ type: "text", text: AGENT_INTERNAL_CONTINUE_PROMPT }],
        },
      ],
      actions: {
        "get-extension": {
          tool: {
            description: "Get extension",
            parameters: {
              type: "object",
              properties: {
                id: { type: "string" },
                includeContent: { type: "boolean" },
              },
              required: ["id"],
            },
          },
          readOnly: true,
          run,
        },
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    expect(run).not.toHaveBeenCalled();
    expect(JSON.stringify(events)).not.toContain("Skipped duplicate read-only");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "get-extension",
        result: expect.stringContaining(
          "Invalid action parameters for get-extension",
        ),
      }),
    );
  });

  it("stops after repeated identical tool errors", async () => {
    let streamCalls = 0;
    const run = vi.fn(async () => {
      throw new Error("DB failed: token=SENSITIVE_VALUE");
    });
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        yield {
          type: "assistant-content",
          parts: [
            {
              type: "tool-call" as const,
              id: `tool-repeat-${streamCalls}`,
              name: "flaky-write",
              input: { id: "row-1" },
            },
          ],
        };
        yield { type: "stop", reason: "tool_use" };
      },
    };
    const events: any[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        "flaky-write": {
          ...actionEntry({ readOnly: true }),
          run,
        },
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    expect(run).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(events)).not.toContain("SENSITIVE_VALUE");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "flaky-write",
        result: expect.stringContaining("Stopped after 3 identical errors"),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("failed 3 times"),
      }),
    );
  });

  it("stops after repeated identical unknown-tool errors", async () => {
    let streamCalls = 0;
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        yield {
          type: "assistant-content",
          parts: [
            {
              type: "tool-call" as const,
              id: `tool-unknown-${streamCalls}`,
              name: "missing-tool",
              input: { id: "row-1" },
            },
          ],
        };
        yield { type: "stop", reason: "tool_use" };
      },
    };
    const events: any[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {},
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    expect(streamCalls).toBe(3);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "missing-tool",
        result: expect.stringContaining("Stopped after 3 identical errors"),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("failed 3 times"),
      }),
    );
  });

  it("detects repeated read-only source sweeps but ignores ordinary helpers", () => {
    const priorToolCalls = Array.from({ length: 12 }, (_, i) => ({
      name: "gong-calls",
      input: { company: `Account ${i + 1}` },
    }));

    expect(
      shouldGuardRepeatedSourceSweep({
        toolName: "gong-calls",
        entry: actionEntry({ readOnly: true }),
        priorToolCalls,
      }),
    ).toMatchObject({
      toolName: "gong-calls",
      priorCalls: 12,
      message: expect.stringContaining("change strategy"),
    });

    expect(
      shouldGuardRepeatedSourceSweep({
        toolName: "hubspot-records",
        entry: actionEntry({}),
        priorToolCalls: priorToolCalls.map((call) => ({
          ...call,
          name: "hubspot-records",
        })),
      }),
    ).toMatchObject({
      toolName: "hubspot-records",
      priorCalls: 12,
    });

    expect(
      shouldGuardRepeatedSourceSweep({
        toolName: "read-attachment",
        entry: actionEntry({ readOnly: true }),
        priorToolCalls: priorToolCalls.map((call) => ({
          ...call,
          name: "read-attachment",
        })),
      }),
    ).toBeNull();

    expect(
      shouldGuardRepeatedSourceSweep({
        toolName: "search-records",
        entry: actionEntry({ readOnly: false }),
        priorToolCalls: priorToolCalls.map((call) => ({
          ...call,
          name: "search-records",
        })),
      }),
    ).toBeNull();
  });

  it("allows a bulk strategy change instead of continuing a repeated source sweep", async () => {
    let streamCalls = 0;
    const seenMessages: unknown[] = [];
    const engine: AgentEngine = {
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
      async *stream(opts): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        seenMessages.push(opts.messages);
        const serializedMessages = JSON.stringify(opts.messages);
        if (serializedMessages.includes("bulk coverage complete")) {
          yield {
            type: "text-delta",
            text: "Bulk coverage complete.",
          };
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "text" as const,
                text: "Bulk coverage complete.",
              },
            ],
          };
          yield { type: "stop", reason: "end_turn" };
          return;
        }
        if (serializedMessages.includes("Skipped agent-teams spawn")) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "bulk-code",
                name: "run-code",
                input: { script: "bulk corpus search" },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        if (serializedMessages.includes("convergence budget")) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "delegate-sweep",
                name: "agent-teams",
                input: {
                  action: "spawn",
                  task: "Scan Gong call transcripts for Figma MCP across the closed-won Fusion account cohort",
                },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield {
          type: "assistant-content",
          parts: [
            {
              type: "tool-call" as const,
              id: `gong-${streamCalls}`,
              name: "gong-calls",
              input: { company: `Account ${streamCalls}` },
            },
          ],
        };
        yield { type: "stop", reason: "tool_use" };
      },
    };
    const gongCalls = vi.fn(async (args) => ({
      company: args.company,
      transcriptSearch: { matchingCalls: 0, inspectedCalls: 5 },
    }));
    const runCode = vi.fn(async () => "bulk coverage complete");
    const agentTeams = vi.fn(async () => "spawned");
    const events: any[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "scan this provider cohort" }],
        },
      ],
      actions: {
        "gong-calls": {
          ...actionEntry({ readOnly: true }),
          run: gongCalls,
        },
        "run-code": {
          ...actionEntry({ readOnly: true }),
          run: runCode,
        },
        "agent-teams": {
          ...actionEntry({
            actions: ["spawn", "status", "read-result", "send", "list"],
          }),
          run: agentTeams,
        },
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    expect(gongCalls).toHaveBeenCalledTimes(12);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "gong-calls",
        result: expect.stringContaining("convergence budget"),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "agent-teams",
        result: expect.stringContaining("Skipped agent-teams spawn"),
      }),
    );
    expect(agentTeams).not.toHaveBeenCalled();
    expect(runCode).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({
      type: "text",
      text: "Bulk coverage complete.",
    });
    expect(JSON.stringify(seenMessages.at(-1))).toContain("change strategy");
    expect(JSON.stringify(seenMessages.at(-1))).toContain("Do not delegate");
  });

  it("counts repeated source sweeps from internal continuation history", async () => {
    let streamCalls = 0;
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(opts): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        const serializedMessages = JSON.stringify(opts.messages);
        if (serializedMessages.includes("convergence budget")) {
          yield {
            type: "text-delta",
            text: "summarized coverage",
          };
          yield {
            type: "assistant-content",
            parts: [{ type: "text" as const, text: "summarized coverage" }],
          };
          yield { type: "stop", reason: "end_turn" };
          return;
        }
        yield {
          type: "assistant-content",
          parts: [
            {
              type: "tool-call" as const,
              id: "gong-next",
              name: "gong-calls",
              input: { company: "Next Account" },
            },
          ],
        };
        yield { type: "stop", reason: "tool_use" };
      },
    };
    const gongCalls = vi.fn(async () => "should not run");
    const events: any[] = [];
    const priorToolMessages = Array.from({ length: 12 }, (_, i) => {
      const input = { company: `Account ${i + 1}` };
      const toolCallId = `gong-prior-${i + 1}`;
      return [
        {
          role: "assistant" as const,
          content: [
            {
              type: "tool-call" as const,
              id: toolCallId,
              name: "gong-calls",
              input,
            },
          ],
        },
        {
          role: "user" as const,
          content: [
            {
              type: "tool-result" as const,
              toolCallId,
              toolName: "gong-calls",
              toolInput: JSON.stringify(input),
              content: "no Figma MCP hits",
            },
          ],
        },
      ];
    }).flat();

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "scan this provider cohort" }],
        },
        ...priorToolMessages,
        {
          role: "user",
          content: [{ type: "text", text: AGENT_INTERNAL_CONTINUE_PROMPT }],
        },
      ],
      actions: {
        "gong-calls": {
          ...actionEntry({ readOnly: true }),
          run: gongCalls,
        },
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    expect(gongCalls).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "gong-calls",
        result: expect.stringContaining("convergence budget"),
      }),
    );
    expect(events).toContainEqual({
      type: "text",
      text: "summarized coverage",
    });
    expect(streamCalls).toBe(2);
  });

  it("retries identical read-only tools when the continuation history result was aborted", async () => {
    let streamCalls = 0;
    const engine: AgentEngine = {
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
        streamCalls += 1;
        if (streamCalls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "tool-repeat",
                name: "get-document",
                input: { id: "doc-1" },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "answered after retry" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const readAction = vi.fn(async () => "fresh document");
    const events: any[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "summarize this doc" }],
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              id: "tool-original",
              name: "get-document",
              input: { id: "doc-1" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "tool-original",
              toolName: "get-document",
              toolInput: '{"id":"doc-1"}',
              content: "Error running get-document: Run aborted",
              isError: true,
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `${AGENT_INTERNAL_CONTINUE_PROMPT}\n\nInternal note: retry`,
            },
          ],
        },
      ],
      actions: {
        "get-document": {
          ...actionEntry({ readOnly: true }),
          run: readAction,
        },
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    expect(readAction).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "get-document",
        result: "fresh document",
      }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "get-document",
        result: expect.stringContaining("Skipped duplicate read-only call"),
      }),
    );
  });

  it("stops write tool that was interrupted twice in continuation history", async () => {
    let streamCalls = 0;
    const writeAction = vi.fn(async () => ({ ok: true }));
    const engine: AgentEngine = {
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
        streamCalls += 1;
        yield {
          type: "assistant-content",
          parts: [
            {
              type: "tool-call" as const,
              id: `write-call-${streamCalls}`,
              name: "save-data",
              input: { content: "big payload" },
            },
          ],
        };
        yield { type: "stop", reason: "tool_use" };
      },
    };
    const events: any[] = [];

    // Simulate a continuation turn where save-data was interrupted twice.
    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "save this data" }],
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              id: "orig-1",
              name: "save-data",
              input: { content: "big payload" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "orig-1",
              toolName: "save-data",
              toolInput: '{"content":"big payload"}',
              content: "Interrupted before this tool returned a result.",
            },
          ],
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              id: "orig-2",
              name: "save-data",
              input: { content: "big payload" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "orig-2",
              toolName: "save-data",
              toolInput: '{"content":"big payload"}',
              content: "Interrupted before this tool returned a result.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `${AGENT_INTERNAL_CONTINUE_PROMPT}\n\nInternal note: retry`,
            },
          ],
        },
      ],
      actions: {
        "save-data": {
          ...actionEntry({ readOnly: false }),
          run: writeAction,
        },
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    // The write action must NOT run again — the guard should have blocked it.
    expect(writeAction).not.toHaveBeenCalled();
    // A tool_done event with an interruption error should be emitted.
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "save-data",
        result: expect.stringContaining("interrupted 2 time(s)"),
      }),
    );
    // The agent should stop with a helpful message.
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("interrupted 2 time(s)"),
      }),
    );
  });

  it("still runs write tools on first interruption (allows one retry)", async () => {
    const writeAction = vi.fn(async () => ({ ok: true }));
    let streamCalls = 0;
    const engine: AgentEngine = {
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
        streamCalls++;
        if (streamCalls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "write-retry",
                name: "save-data",
                input: { content: "small payload" },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "done" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "save this" }],
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              id: "orig-1",
              name: "save-data",
              input: { content: "small payload" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "orig-1",
              toolName: "save-data",
              toolInput: '{"content":"small payload"}',
              content: "Interrupted before this tool returned a result.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `${AGENT_INTERNAL_CONTINUE_PROMPT}\n\nInternal note: retry`,
            },
          ],
        },
      ],
      actions: {
        "save-data": {
          ...actionEntry({ readOnly: false }),
          run: writeAction,
        },
      },
      send: () => {},
      signal: new AbortController().signal,
    });

    // With only 1 prior interruption (below the threshold of 2), the action runs.
    expect(writeAction).toHaveBeenCalledOnce();
  });

  it("passes the turn's attachments into each tool action's run context", async () => {
    // The by-reference fix: an action (e.g. create-extension's
    // contentFromAttachment) reads the pasted/attached file from
    // ctx.attachments instead of forcing the model to re-emit it as a tool
    // argument.
    let receivedAttachments: unknown;
    const writeAction = vi.fn(async (_args: unknown, ctx: any) => {
      receivedAttachments = ctx?.attachments;
      return { ok: true };
    });
    let streamCalls = 0;
    const engine: AgentEngine = {
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
        streamCalls++;
        if (streamCalls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "host-1",
                name: "host-paste",
                input: { name: "Pasted", contentFromAttachment: "latest" },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "hosted" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };

    const turnAttachments = [
      {
        type: "file",
        name: "pasted-text-1718000000000-ab12cd.txt",
        contentType: "text/plain",
        text: "<div>pasted body</div>",
      },
    ];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "host my pasted file" }],
        },
      ],
      actions: {
        "host-paste": {
          ...actionEntry({ readOnly: false }),
          run: writeAction,
        },
      },
      send: () => {},
      signal: new AbortController().signal,
      attachments: turnAttachments as any,
    });

    expect(writeAction).toHaveBeenCalledOnce();
    expect(receivedAttachments).toEqual(turnAttachments);
  });

  it("forwards the run abort signal into each tool action's run context", async () => {
    // P1: ActionRunContext.signal must be populated so well-behaved actions can
    // cancel in-flight work when the run is soft-timed out or user-cancelled.
    let receivedSignal: unknown;
    const writeAction = vi.fn(async (_args: unknown, ctx: any) => {
      receivedSignal = ctx?.signal;
      return "done";
    });
    let streamCalls = 0;
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        streamCalls++;
        if (streamCalls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "sig-1",
                name: "do-work",
                input: {},
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "done" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };

    const runAbort = new AbortController();
    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        "do-work": {
          ...actionEntry({ readOnly: false }),
          run: writeAction,
        },
      },
      send: () => {},
      signal: runAbort.signal,
    });

    expect(writeAction).toHaveBeenCalledOnce();
    // The signal passed to the action must be the same AbortSignal given to runAgentLoop
    expect(receivedSignal).toBe(runAbort.signal);
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
  });

  it("still runs identical read-only tools on a fresh user turn", async () => {
    let streamCalls = 0;
    const engine: AgentEngine = {
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
        streamCalls += 1;
        if (streamCalls > 1) {
          yield {
            type: "assistant-content",
            parts: [{ type: "text" as const, text: "fresh answer" }],
          };
          yield { type: "stop", reason: "end_turn" };
          return;
        }
        yield {
          type: "assistant-content",
          parts: [
            {
              type: "tool-call" as const,
              id: "tool-repeat",
              name: "get-document",
              input: { id: "doc-1" },
            },
          ],
        };
        yield { type: "stop", reason: "tool_use" };
      },
    };
    const readAction = vi.fn(async () => "fresh document");

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              id: "tool-original",
              name: "get-document",
              input: { id: "doc-1" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "tool-original",
              toolName: "get-document",
              toolInput: '{"id":"doc-1"}',
              content: "old result",
            },
          ],
        },
        {
          role: "user",
          content: [{ type: "text", text: "read it again" }],
        },
      ],
      actions: {
        "get-document": {
          ...actionEntry({ readOnly: true }),
          run: readAction,
        },
      },
      send: () => {},
      signal: new AbortController().signal,
    });

    expect(readAction).toHaveBeenCalledTimes(1);
  });

  it("exposes completed tool results on the active request run context", async () => {
    let streamCalls = 0;
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        if (streamCalls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "query-1",
                name: "query-data",
                input: {},
              },
              {
                type: "tool-call" as const,
                id: "save-1",
                name: "save-analysis",
                input: {},
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "done" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    let saveSawQueryResult = false;

    await runWithRequestContext({ userEmail: "a@example.com", run: {} }, () =>
      runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {
          "query-data": {
            ...actionEntry({ readOnly: true }),
            run: async () => ({ rows: [{ count: 3 }] }),
          },
          "save-analysis": {
            ...actionEntry({ readOnly: false }),
            run: async () => {
              saveSawQueryResult =
                getRequestRunContext()?.toolResults?.some(
                  (result) => result.name === "query-data",
                ) === true;
              return "saved";
            },
          },
        },
        send: () => {},
        signal: new AbortController().signal,
      }),
    );

    expect(saveSawQueryResult).toBe(true);
  });

  it("keeps reads ordered around parallel-safe mutating batches", async () => {
    let streamCalls = 0;
    const engine: AgentEngine = {
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
        streamCalls += 1;
        if (streamCalls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "tool-a",
                name: "write-a",
                input: {},
              },
              {
                type: "tool-call" as const,
                id: "tool-read",
                name: "read-state",
                input: {},
              },
              {
                type: "tool-call" as const,
                id: "tool-b",
                name: "write-b",
                input: {},
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "done" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const order: string[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        "write-a": {
          ...actionEntry({ readOnly: false, parallelSafe: true }),
          run: async () => {
            order.push("a:start");
            await new Promise((resolve) => setTimeout(resolve, 10));
            order.push("a:end");
            return "a";
          },
        },
        "read-state": {
          ...actionEntry({ readOnly: true }),
          run: async () => {
            order.push("read:start");
            order.push("read:end");
            return "read";
          },
        },
        "write-b": {
          ...actionEntry({ readOnly: false, parallelSafe: true }),
          run: async () => {
            order.push("b:start");
            order.push("b:end");
            return "b";
          },
        },
      },
      send: () => {},
      signal: new AbortController().signal,
    });

    expect(order).toEqual([
      "a:start",
      "a:end",
      "read:start",
      "read:end",
      "b:start",
      "b:end",
    ]);
  });

  it("continues internally when the configured iteration chunk is exhausted", async () => {
    let streamCalls = 0;
    const seenMessages: any[] = [];
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(opts): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        seenMessages.push(opts.messages);
        if (streamCalls === 3) {
          yield { type: "text-delta", text: "finished" };
          yield {
            type: "assistant-content",
            parts: [{ type: "text", text: "finished" }],
          };
          yield { type: "stop", reason: "end_turn" };
          return;
        }
        const parts = [
          {
            type: "tool-call" as const,
            id: `tool-${streamCalls}`,
            name: "noop",
            input: {},
          },
        ];
        yield {
          type: "tool-call",
          id: `tool-${streamCalls}`,
          name: "noop",
          input: {},
        };
        yield { type: "assistant-content", parts };
        yield { type: "stop", reason: "tool_use" };
      },
    };
    const events: any[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: { noop: actionEntry({ readOnly: true }) },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
      maxIterations: 2,
    });

    expect(streamCalls).toBe(3);
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "loop_limit" }),
    );
    expect(JSON.stringify(seenMessages.at(-1))).toContain(
      "Continue from where you left off",
    );
    expect(events).toContainEqual({ type: "text", text: "finished" });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("stops the turn when an action throws AgentActionStopError", async () => {
    let streamCalls = 0;
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        yield {
          type: "assistant-content",
          parts: [
            {
              type: "tool-call" as const,
              id: "query-1",
              name: "bigquery",
              input: { sql: "select nope" },
            },
          ],
        };
        yield { type: "stop", reason: "tool_use" };
      },
    };
    const events: any[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        bigquery: {
          ...actionEntry({ readOnly: true }),
          run: async () => {
            throw new AgentActionStopError("BigQuery returned: nope", {
              errorCode: "bigquery_query_failed",
              toolResult: JSON.stringify({
                error: "bigquery_query_failed",
                message: "nope",
              }),
            });
          },
        },
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    expect(streamCalls).toBe(1);
    expect(events).toEqual([
      {
        type: "tool_start",
        id: "query-1",
        tool: "bigquery",
        input: { sql: "select nope" },
      },
      {
        type: "tool_done",
        id: "query-1",
        tool: "bigquery",
        input: { sql: "select nope" },
        result: JSON.stringify({
          error: "bigquery_query_failed",
          message: "nope",
        }),
        isError: true,
        completedSideEffect: false,
      },
      { type: "text", text: "BigQuery returned: nope" },
      { type: "done" },
    ]);
  });

  it("returns tool input schema failures to the model instead of ending the run", async () => {
    let streamCalls = 0;
    const seenMessages: any[] = [];
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(opts): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        seenMessages.push(structuredClone(opts.messages));
        if (streamCalls === 1) {
          yield {
            type: "tool-call-error",
            id: "bad-call",
            name: "add-slide",
            input: { deckId: "deck-1", content: "<div></div>", position: "x" },
            error: "position must be a number",
          };
          yield { type: "assistant-content", parts: [] };
          yield { type: "stop", reason: "tool_use" };
          return;
        }

        yield { type: "text-delta", text: "I fixed the arguments." };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "I fixed the arguments." }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const events: any[] = [];
    const run = vi.fn(async () => "should not execute");

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        "add-slide": {
          ...actionEntry({ readOnly: false }),
          run,
        },
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    expect(run).not.toHaveBeenCalled();
    expect(streamCalls).toBe(2);
    expect(events).toContainEqual({
      type: "tool_start",
      id: "bad-call",
      tool: "add-slide",
      input: { deckId: "deck-1", content: "<div></div>", position: "x" },
    });
    const toolDone = events.find(
      (event) => event.type === "tool_done" && event.tool === "add-slide",
    );
    expect(toolDone?.id).toBe("bad-call");
    expect(toolDone?.result).toContain("Invalid action parameters");
    expect(toolDone?.result).toContain("position must be a number");
    expect(events).toContainEqual({
      type: "text",
      text: "I fixed the arguments.",
    });
    expect(events.at(-1)).toEqual({ type: "done" });

    const secondCallMessages = seenMessages[1];
    expect(secondCallMessages.at(-2)).toMatchObject({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          id: "bad-call",
          name: "add-slide",
        },
      ],
    });
    expect(secondCallMessages.at(-1)).toMatchObject({
      role: "user",
      content: [
        {
          type: "tool-result",
          toolCallId: "bad-call",
          toolName: "add-slide",
          toolInput: expect.any(String),
          isError: true,
        },
      ],
    });
  });

  it("marks MCP isError results as errored tool results for the next model turn", async () => {
    let streamCalls = 0;
    const seenMessages: any[] = [];
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(opts): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        seenMessages.push(structuredClone(opts.messages));
        if (streamCalls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "mcp-call",
                name: "mcp__x__fail",
                input: {},
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }

        yield { type: "text-delta", text: "I handled the tool failure." };
        yield {
          type: "assistant-content",
          parts: [
            {
              type: "text" as const,
              text: "I handled the tool failure.",
            },
          ],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const events: any[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        mcp__x__fail: {
          ...actionEntry({ readOnly: true }),
          run: async () => ({
            [MCP_ACTION_RESULT_MARKER]: true,
            text: "Error calling MCP tool mcp__x__fail: boom",
            raw: {
              isError: true,
              content: [
                {
                  type: "text",
                  text: "Error calling MCP tool mcp__x__fail: boom",
                },
              ],
            },
            serverId: "x",
            toolName: "mcp__x__fail",
            originalToolName: "fail",
            input: {},
          }),
        },
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    expect(streamCalls).toBe(2);
    expect(events).toContainEqual({
      type: "tool_done",
      id: "mcp-call",
      tool: "mcp__x__fail",
      input: {},
      result: "Error calling MCP tool mcp__x__fail: boom",
      isError: true,
      completedSideEffect: false,
    });
    expect(seenMessages[1].at(-1)).toMatchObject({
      role: "user",
      content: [
        {
          type: "tool-result",
          toolCallId: "mcp-call",
          toolName: "mcp__x__fail",
          content: "Error calling MCP tool mcp__x__fail: boom",
          isError: true,
        },
      ],
    });
  });

  it("lets a final-response guard force one corrective retry before finishing", async () => {
    let streamCalls = 0;
    const seenMessages: any[] = [];
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(opts): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        seenMessages.push(structuredClone(opts.messages));
        if (streamCalls === 1) {
          yield { type: "text-delta", text: "Looks up and to the right." };
          yield {
            type: "assistant-content",
            parts: [
              { type: "text" as const, text: "Looks up and to the right." },
            ],
          };
          yield { type: "stop", reason: "end_turn" };
          return;
        }
        if (streamCalls === 2) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "query-1",
                name: "query-data",
                input: { sql: "select count(*)" },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield { type: "text-delta", text: "The real count is 3." };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "The real count is 3." }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const events: any[] = [];
    const guard = vi.fn((ctx: AgentLoopFinalResponseGuardContext) => {
      const hasQuery = ctx.toolResults.some((r) => r.name === "query-data");
      return hasQuery
        ? null
        : "This answer needs a real data-source query before it can be final.";
    });

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        "query-data": {
          ...actionEntry({ readOnly: true }),
          run: async () => ({ rows: [{ count: 3 }] }),
        },
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
      finalResponseGuard: guard,
    });

    expect(streamCalls).toBe(3);
    expect(guard).toHaveBeenCalledTimes(2);
    expect(guard.mock.calls.map(([ctx]) => ctx.executionMode)).toEqual([
      "act",
      "act",
    ]);
    expect(events.slice(0, 2)).toEqual([
      {
        type: "text",
        text: "Looks up and to the right.",
      },
      { type: "clear" },
    ]);
    expect(events).toContainEqual({
      type: "tool_start",
      id: "query-1",
      tool: "query-data",
      input: { sql: "select count(*)" },
    });
    expect(events).toContainEqual({
      type: "text",
      text: "The real count is 3.",
    });
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(JSON.stringify(seenMessages[1])).toContain(
      "This answer needs a real data-source query",
    );
  });

  it("passes plan execution mode to final-response guards", async () => {
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        yield { type: "text-delta", text: "Plan only." };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "Plan only." }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const guard = vi.fn(() => null);

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "plan" }] }],
      actions: {},
      send: () => {},
      signal: new AbortController().signal,
      executionMode: "plan",
      finalResponseGuard: guard,
    });

    expect(guard).toHaveBeenCalledTimes(1);
    expect(guard.mock.calls[0]?.[0].executionMode).toBe("plan");
  });

  it("streams guarded final-answer text before the guard accepts it", async () => {
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        yield { type: "text-delta", text: "Grounded answer." };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "Grounded answer." }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const events: any[] = [];
    let eventsAtGuard: any[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {},
      send: (event) => events.push(event),
      signal: new AbortController().signal,
      finalResponseGuard: () => {
        eventsAtGuard = [...events];
        return null;
      },
    });

    expect(eventsAtGuard).toContainEqual({
      type: "text",
      text: "Grounded answer.",
    });
    expect(events).toContainEqual({
      type: "text",
      text: "Grounded answer.",
    });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("runs the final-response guard when an engine emits text with empty content", async () => {
    let streamCalls = 0;
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        yield {
          type: "text-delta",
          text: streamCalls === 1 ? "unclear" : "grounded",
        };
        yield { type: "assistant-content", parts: [] };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const guard = vi.fn((context: AgentLoopFinalResponseGuardContext) =>
      context.text === "unclear"
        ? {
            retryMessage: "Retry with grounded evidence.",
            fallbackMessage: "No grounded result.",
          }
        : null,
    );
    const events: AgentChatEvent[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {},
      send: (event) => events.push(event),
      signal: new AbortController().signal,
      finalResponseGuard: guard,
    });

    expect(streamCalls).toBe(2);
    expect(guard).toHaveBeenCalledTimes(2);
    expect(guard.mock.calls.map(([context]) => context.text)).toEqual([
      "unclear",
      "grounded",
    ]);
    expect(events).toEqual([
      { type: "text", text: "unclear" },
      { type: "clear" },
      { type: "text", text: "grounded" },
      { type: "done" },
    ]);
  });

  it("clears streamed final-answer text when the guard throws", async () => {
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        yield { type: "text-delta", text: "Unverified answer." };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "Unverified answer." }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const events: any[] = [];

    await expect(
      runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {},
        send: (event) => events.push(event),
        signal: new AbortController().signal,
        finalResponseGuard: () => {
          throw new Error("guard unavailable");
        },
      }),
    ).rejects.toThrow("guard unavailable");

    expect(events.slice(0, 2)).toEqual([
      { type: "text", text: "Unverified answer." },
      { type: "clear" },
    ]);
  });

  it("uses the final-response guard fallback after one failed corrective retry", async () => {
    let streamCalls = 0;
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        const text = streamCalls === 1 ? "fake answer" : "still fake";
        yield { type: "text-delta", text };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const events: any[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {},
      send: (event) => events.push(event),
      signal: new AbortController().signal,
      finalResponseGuard: () => ({
        retryMessage: "Query a real source before answering.",
        fallbackMessage: "I stopped because no real data-source query ran.",
      }),
    });

    expect(streamCalls).toBe(2);
    expect(events).toEqual([
      { type: "text", text: "fake answer" },
      { type: "clear" },
      { type: "text", text: "still fake" },
      { type: "clear" },
      {
        type: "text",
        text: "I stopped because no real data-source query ran.",
      },
      { type: "done" },
    ]);
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("allows a final-response guard to request additional corrective retries", async () => {
    let streamCalls = 0;
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        const text = `ungrounded answer ${streamCalls}`;
        yield { type: "text-delta", text };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const events: any[] = [];
    const guard = vi.fn(() => ({
      retryMessage: "Query a real source before answering.",
      fallbackMessage: "No grounded result is available.",
      maxRetries: 2,
    }));

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {},
      send: (event) => events.push(event),
      signal: new AbortController().signal,
      finalResponseGuard: guard,
    });

    expect(streamCalls).toBe(3);
    expect(guard).toHaveBeenCalledTimes(3);
    expect(guard.mock.calls.map(([context]) => context.retryCount)).toEqual([
      0, 1, 2,
    ]);
    expect(events).toContainEqual({
      type: "text",
      text: "No grounded result is available.",
    });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("continues once when the engine ends with no text or tool calls", async () => {
    // Mirrors OpenAI Responses gpt-5+ producing reasoning-only content with
    // zero `output_text` items: the engine still emits a clean `end_turn`
    // stop, but parts contains only thinking. Retry once so a transient
    // reasoning-budget miss does not surface as a manual retry prompt.
    let streamCalls = 0;
    const seenMessages: any[] = [];
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: true,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(opts): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        seenMessages.push(JSON.stringify(opts.messages));
        if (streamCalls > 1) {
          yield { type: "text-delta", text: "Recovered answer." };
          yield {
            type: "assistant-content",
            parts: [{ type: "text" as const, text: "Recovered answer." }],
          };
          yield { type: "stop", reason: "end_turn" };
          return;
        }
        yield { type: "thinking-delta", text: "thinking out loud..." };
        yield {
          type: "assistant-content",
          parts: [{ type: "thinking" as const, text: "thinking out loud..." }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const events: any[] = [];
    const guard = vi.fn((context: AgentLoopFinalResponseGuardContext) =>
      context.text.trim()
        ? null
        : {
            retryMessage: "Misclassified empty response.",
            fallbackMessage: "Wrong app fallback.",
            maxRetries: 0,
          },
    );

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {},
      send: (event) => events.push(event),
      signal: new AbortController().signal,
      finalResponseGuard: guard,
    });

    expect(streamCalls).toBe(2);
    expect(seenMessages.at(-1)).toContain("output-token cap");
    expect(guard).toHaveBeenCalledTimes(1);
    expect(guard.mock.calls[0]?.[0]).toMatchObject({
      requestText: "go",
      text: "Recovered answer.",
    });
    expect(events.map((event) => event.type)).toEqual([
      "thinking",
      "clear",
      "text",
      "done",
    ]);
    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(1);
    expect(textEvents[0].text).toBe("Recovered answer.");
  });

  it("recovers repeated Luna reasoning-only turns before an app guard classifies the continuation", async () => {
    const seenReasoningEfforts: Array<EngineStreamOptions["reasoningEffort"]> =
      [];
    const engine: AgentEngine = {
      name: "builder",
      label: "Builder.io Gateway",
      defaultModel: "gpt-5-6-luna",
      supportedModels: ["gpt-5-6-luna"],
      capabilities: {
        thinking: true,
        promptCaching: true,
        vision: true,
        computerUse: false,
        parallelToolCalls: true,
      },
      async *stream(opts): AsyncIterable<EngineEvent> {
        seenReasoningEfforts.push(opts.reasoningEffort);
        if (seenReasoningEfforts.length < 3) {
          yield { type: "thinking-delta", text: "final-only reasoning" };
          yield {
            type: "assistant-content",
            parts: [
              { type: "thinking" as const, text: "final-only reasoning" },
            ],
          };
          yield { type: "stop", reason: "end_turn" };
          return;
        }
        yield { type: "text-delta", text: "Hello! How can I help?" };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "Hello! How can I help?" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const events: AgentChatEvent[] = [];
    const guard = vi.fn((context: AgentLoopFinalResponseGuardContext) =>
      context.requestText === "hello"
        ? null
        : {
            retryMessage: "Query a real source.",
            fallbackMessage: "Wrong data-source fallback.",
          },
    );

    await runAgentLoop({
      engine,
      model: "gpt-5-6-luna",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      actions: {},
      send: (event) => events.push(event),
      signal: new AbortController().signal,
      reasoningEffort: "medium",
      finalResponseGuard: guard,
    });

    expect(seenReasoningEfforts).toEqual(["medium", "low", "minimal"]);
    expect(guard).toHaveBeenCalledTimes(1);
    expect(guard.mock.calls[0]?.[0].requestText).toBe("hello");
    expect(events).toContainEqual({
      type: "text",
      text: "Hello! How can I help?",
    });
    expect(events).not.toContainEqual(
      expect.objectContaining({ text: "Wrong data-source fallback." }),
    );
  });

  it("surfaces a fallback message after an empty-response retry also ends empty", async () => {
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: true,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        yield { type: "thinking-delta", text: "thinking out loud..." };
        yield {
          type: "assistant-content",
          parts: [{ type: "thinking" as const, text: "thinking out loud..." }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const events: any[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {},
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(1);
    expect(textEvents[0].text).toMatch(/empty response/i);
    expect(textEvents[0].text).toMatch(/different model/i);
    expect(events.map((event) => event.type)).toEqual([
      "thinking",
      "clear",
      "thinking",
      "clear",
      "thinking",
      "clear",
      "text",
      "done",
    ]);
  });

  it("adapts each empty-response retry: raises maxOutputTokens and steps reasoning effort down a tier", async () => {
    const seenOpts: EngineStreamOptions[] = [];
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: true,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(opts): AsyncIterable<EngineEvent> {
        seenOpts.push(opts);
        yield { type: "thinking-delta", text: "thinking out loud..." };
        yield {
          type: "assistant-content",
          parts: [{ type: "thinking" as const, text: "thinking out loud..." }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const events: any[] = [];

    await runAgentLoop({
      engine,
      model: "claude-sonnet-5",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {},
      send: (event) => events.push(event),
      signal: new AbortController().signal,
      maxOutputTokens: 8_000,
      reasoningEffort: "high",
    });

    // Initial attempt + 2 retries: EMPTY_FINAL_RESPONSE_RETRY_LIMIT is 2 now
    // that each retry actually adapts instead of repeating the same request.
    expect(seenOpts).toHaveLength(3);

    // First attempt uses exactly what the caller asked for.
    expect(seenOpts[0].maxOutputTokens).toBe(8_000);
    expect(seenOpts[0].reasoningEffort).toBe("high");

    // First retry: tokens raised well above the first attempt, effort down
    // one tier (high -> medium).
    expect(seenOpts[1].maxOutputTokens).toBeGreaterThan(
      seenOpts[0].maxOutputTokens!,
    );
    expect(seenOpts[1].reasoningEffort).toBe("medium");

    // Second retry: effort steps down again (medium -> low); tokens stay at
    // the raised ceiling rather than climbing indefinitely.
    expect(seenOpts[2].reasoningEffort).toBe("low");
    expect(seenOpts[2].maxOutputTokens).toBe(seenOpts[1].maxOutputTokens);

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(1);
    expect(textEvents[0].text).toMatch(/empty response/i);
  });

  it("does not surface the empty-response fallback when text was streamed", async () => {
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        yield { type: "text-delta", text: "Real answer." };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "Real answer." }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const events: any[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {},
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(1);
    expect(textEvents[0].text).toBe("Real answer.");
  });

  it("executes a streamed tool call when assistant-content is missing", async () => {
    let streamCalls = 0;
    const events: AgentChatEvent[] = [];
    const run = vi.fn(async () => "recording result");
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        if (streamCalls === 1) {
          yield {
            type: "tool-call",
            id: "recording-call",
            name: "list-session-recordings",
            input: { userId: "tim@builder.io", limit: 1 },
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield { type: "text-delta", text: "Found it." };
        yield { type: "stop", reason: "end_turn" };
      },
    };

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        "list-session-recordings": {
          ...actionEntry({ readOnly: true }),
          run,
        },
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    expect(run).toHaveBeenCalledWith(
      { userId: "tim@builder.io", limit: 1 },
      expect.objectContaining({ caller: "tool" }),
    );
    expect(events).toContainEqual({ type: "text", text: "Found it." });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("does not carry streamed tool calls across a retry", async () => {
    let streamCalls = 0;
    const run = vi.fn(async () => "should not execute");
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        if (streamCalls === 1) {
          yield {
            type: "tool-call",
            id: "stale-call",
            name: "list-session-recordings",
            input: { userId: "tim@builder.io", limit: 1 },
          };
          throw new EngineError("temporary provider failure", {
            providerRetryable: true,
          });
        }
        yield { type: "text-delta", text: "Recovered." };
        yield { type: "stop", reason: "end_turn" };
      },
    };

    const events: AgentChatEvent[] = [];
    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        "list-session-recordings": {
          ...actionEntry({ readOnly: true }),
          run,
        },
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    expect(streamCalls).toBe(2);
    expect(run).not.toHaveBeenCalled();
    expect(events).toContainEqual({ type: "text", text: "Recovered." });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("does not retry Builder gateway timeouts inside one serverless run", async () => {
    let streamCalls = 0;
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        yield {
          type: "stop",
          reason: "error",
          error: "Builder gateway timed out after 45s",
          errorCode: "builder_gateway_timeout",
        };
      },
    };

    await expect(
      runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions: {},
        send: () => {},
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("Builder gateway timed out after 45s");

    expect(streamCalls).toBe(1);
  });

  it("retries Builder gateway network errors inside one serverless run", async () => {
    let streamCalls = 0;
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        if (streamCalls === 1) {
          yield {
            type: "stop",
            reason: "error",
            error: "Builder gateway network error: socket hang up",
            errorCode: "builder_gateway_network_error",
          };
          return;
        }
        yield {
          type: "text-delta",
          text: "Recovered",
        };
        yield {
          type: "assistant-content",
          parts: [{ type: "text", text: "Recovered" }],
        };
        yield {
          type: "stop",
          reason: "end_turn",
        };
      },
    };
    const events: Array<{ type: string; text?: string }> = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {},
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    expect(streamCalls).toBe(2);
    expect(events).toContainEqual({ type: "clear" });
    expect(events).toContainEqual({ type: "text", text: "Recovered" });
  });

  // ─── Human-in-the-loop approval gate (opt-in needsApproval) ──────────────
  //
  // Builds an engine that emits a single tool call to `send-email` on the
  // first stream, then a plain text completion on every subsequent stream.
  // The post-tool stream lets an *approved* re-run finish cleanly.
  const approvalEngine = (
    toolInput: Record<string, unknown> = { to: "a@b.com" },
  ): { engine: AgentEngine; streamCalls: () => number } => {
    let streamCalls = 0;
    const engine: AgentEngine = {
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
        streamCalls += 1;
        if (streamCalls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "approval-call-1",
                name: "send-email",
                input: toolInput,
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield { type: "text-delta", text: "sent the email" };
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "sent the email" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    return { engine, streamCalls: () => streamCalls };
  };

  it("runs an action WITHOUT needsApproval normally (no approval_required)", async () => {
    const { engine } = approvalEngine();
    const run = vi.fn(async () => "delivered");
    const events: any[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        "send-email": {
          ...actionEntry({ readOnly: false }),
          run,
        },
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    expect(run).toHaveBeenCalledOnce();
    expect(events.some((event) => event.type === "approval_required")).toBe(
      false,
    );
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("needsApproval:true pauses the turn, never runs the action, and emits a stable approvalKey", async () => {
    const { engine, streamCalls } = approvalEngine();
    const run = vi.fn(async () => "delivered");
    const events: any[] = [];

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        "send-email": {
          ...actionEntry({ readOnly: false }),
          needsApproval: true,
          run,
        },
      },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });

    // The side effect must NOT have happened.
    expect(run).not.toHaveBeenCalled();
    // The model was never asked to continue after the pause (only the first
    // tool-emitting stream ran).
    expect(streamCalls()).toBe(1);

    const approvalEvent = events.find(
      (event) => event.type === "approval_required",
    );
    expect(approvalEvent).toBeDefined();
    expect(approvalEvent.tool).toBe("send-email");
    expect(approvalEvent.input).toEqual({ to: "a@b.com" });
    // A stable, non-empty key that the client echoes back to approve.
    expect(typeof approvalEvent.approvalKey).toBe("string");
    expect(approvalEvent.approvalKey.length).toBeGreaterThan(0);
    expect(approvalEvent.approvalKey).toContain("send-email");
    expect(approvalEvent.toolCallId).toBe("approval-call-1");

    // A paused tool_done is emitted explaining the action did NOT execute.
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "send-email",
        result: expect.stringContaining("did NOT execute"),
      }),
    );
    // The turn stops with the approval-waiting message (how the loop surfaces a
    // requestedActionStop with errorCode "needs-approval").
    expect(events).toContainEqual({
      type: "text",
      text: "Waiting for your approval to run send-email.",
    });
  });

  it("re-running with approvedToolCalls:[approvalKey] DOES run the action", async () => {
    // Phase 1: capture the approvalKey from the pause.
    const phase1 = approvalEngine();
    const run = vi.fn(async () => "delivered");
    const events1: any[] = [];
    const actions = {
      "send-email": {
        ...actionEntry({ readOnly: false }),
        needsApproval: true,
        run,
      },
    };

    await runAgentLoop({
      engine: phase1.engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions,
      send: (event) => events1.push(event),
      signal: new AbortController().signal,
    });

    const approvalKey = events1.find(
      (event) => event.type === "approval_required",
    )?.approvalKey as string;
    expect(approvalKey).toBeTruthy();
    expect(run).not.toHaveBeenCalled();

    // Phase 2: re-issue the turn approving that specific call.
    const phase2 = approvalEngine();
    const events2: any[] = [];

    await runAgentLoop({
      engine: phase2.engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions,
      approvedToolCalls: [approvalKey],
      send: (event) => events2.push(event),
      signal: new AbortController().signal,
    });

    expect(run).toHaveBeenCalledOnce();
    expect(events2.some((event) => event.type === "approval_required")).toBe(
      false,
    );
    expect(events2).toContainEqual({ type: "text", text: "sent the email" });
    expect(events2.at(-1)).toEqual({ type: "done" });
  });

  it("predicate needsApproval gates only matching args (non-matching runs normally)", async () => {
    // Non-matching args run normally.
    const safe = approvalEngine({ x: "safe" });
    const safeRun = vi.fn(async () => "ran-safe");
    const safeEvents: any[] = [];
    const predicate = (args: { x?: string }) => args.x === "danger";

    await runAgentLoop({
      engine: safe.engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        "send-email": {
          ...actionEntry({ readOnly: false }),
          needsApproval: predicate,
          run: safeRun,
        },
      },
      send: (event) => safeEvents.push(event),
      signal: new AbortController().signal,
    });

    expect(safeRun).toHaveBeenCalledOnce();
    expect(safeEvents.some((event) => event.type === "approval_required")).toBe(
      false,
    );

    // Matching args pause for approval and never run.
    const danger = approvalEngine({ x: "danger" });
    const dangerRun = vi.fn(async () => "ran-danger");
    const dangerEvents: any[] = [];

    await runAgentLoop({
      engine: danger.engine,
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions: {
        "send-email": {
          ...actionEntry({ readOnly: false }),
          needsApproval: predicate,
          run: dangerRun,
        },
      },
      send: (event) => dangerEvents.push(event),
      signal: new AbortController().signal,
    });

    expect(dangerRun).not.toHaveBeenCalled();
    expect(
      dangerEvents.some((event) => event.type === "approval_required"),
    ).toBe(true);
  });
});

// ─── isContextTooLongError ────────────────────────────────────────────────────

describe("isContextTooLongError", () => {
  it("returns false for non-Error values", () => {
    expect(isContextTooLongError("string")).toBe(false);
    expect(isContextTooLongError(null)).toBe(false);
    expect(isContextTooLongError(429)).toBe(false);
  });

  it("matches OpenAI / Anthropic phrasing", () => {
    expect(isContextTooLongError(new Error("context_length_exceeded"))).toBe(
      true,
    );
    expect(isContextTooLongError(new Error("input_too_long"))).toBe(true);
    expect(
      isContextTooLongError(new Error("too many tokens in the prompt")),
    ).toBe(true);
    expect(isContextTooLongError(new Error("prompt is too long"))).toBe(true);
    expect(isContextTooLongError(new Error("Please reduce the length"))).toBe(
      true,
    );
  });

  it("matches Gemini phrasing", () => {
    expect(
      isContextTooLongError(new Error("input token count exceeds the limit")),
    ).toBe(true);
    expect(isContextTooLongError(new Error("Request too large"))).toBe(true);
  });

  it("matches EngineError with context_length errorCode", () => {
    const err = new EngineError("context error", {
      errorCode: "context_length_exceeded",
    });
    expect(isContextTooLongError(err)).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isContextTooLongError(new Error("rate limit reached"))).toBe(false);
    expect(isContextTooLongError(new Error("overloaded"))).toBe(false);
  });
});

// ─── isRetryableError ────────────────────────────────────────────────────────

describe("isRetryableError", () => {
  it("returns false for non-Error values", () => {
    expect(isRetryableError("string")).toBe(false);
    expect(isRetryableError(null)).toBe(false);
  });

  it("retries on HTTP 429 from statusCode field", () => {
    const err = new EngineError("rate limited", { statusCode: 429 });
    expect(isRetryableError(err)).toBe(true);
  });

  it("retries on the http_429 errorCode", () => {
    const err = new EngineError("429 status code (no body)", {
      errorCode: "http_429",
    });
    expect(isRetryableError(err)).toBe(true);
  });

  it("retries on a bare '429 status code (no body)' message with no structured status", () => {
    // The Anthropic/AI-SDK empty-body rate-limit format historically slipped
    // past retries because the keyword list matched "529"/"502" but not 429.
    expect(isRetryableError(new Error("429 status code (no body)"))).toBe(true);
  });

  it("retries on HTTP 529 (Anthropic overloaded) from statusCode field", () => {
    const err = new EngineError("overloaded", { statusCode: 529 });
    expect(isRetryableError(err)).toBe(true);
  });

  it("retries on HTTP 500/502/503 from statusCode field", () => {
    expect(isRetryableError(new EngineError("e", { statusCode: 500 }))).toBe(
      true,
    );
    expect(isRetryableError(new EngineError("e", { statusCode: 502 }))).toBe(
      true,
    );
    expect(isRetryableError(new EngineError("e", { statusCode: 503 }))).toBe(
      true,
    );
  });

  it("retries when providerRetryable is true", () => {
    const err = new EngineError("transient", { providerRetryable: true });
    expect(isRetryableError(err)).toBe(true);
  });

  it("does not retry when providerRetryable is false and no other signals", () => {
    const err = new EngineError("not retryable", { providerRetryable: false });
    expect(isRetryableError(err)).toBe(false);
  });

  it("retries on Anthropic bare 'Connection error.' transport failures", () => {
    // Anthropic SDK APIConnectionError defaults to this exact message with no
    // HTTP status. Slides prod was dying in ~3s on this and storming client
    // POSTs because neither in-run retry nor run-level resume recognized it.
    expect(isRetryableError(new Error("Connection error."))).toBe(true);
    expect(
      isRetryableError(
        new EngineError("Connection error.", {
          errorCode: "provider_network_error",
          providerRetryable: true,
        }),
      ),
    ).toBe(true);
  });

  it("retries on Anthropic 'overloaded' message keyword", () => {
    expect(isRetryableError(new Error("Anthropic API overloaded"))).toBe(true);
  });

  it("retries on OpenAI 'Rate limit reached' phrasing", () => {
    expect(
      isRetryableError(new Error("Rate limit reached for model gpt-5.5")),
    ).toBe(true);
  });

  it("retries on Google 'resource_exhausted' phrasing", () => {
    expect(
      isRetryableError(new Error("RESOURCE_EXHAUSTED: quota exceeded")),
    ).toBe(true);
  });

  it("retries on 'quota exceeded' phrasing", () => {
    expect(isRetryableError(new Error("quota exceeded for project"))).toBe(
      true,
    );
  });

  it("does NOT retry builder_gateway_timeout", () => {
    const err = new EngineError("timed out", {
      errorCode: "builder_gateway_timeout",
    });
    expect(isRetryableError(err)).toBe(false);
  });

  it("does NOT retry rate_limit_exceeded (daily cap)", () => {
    const err = new EngineError("daily cap hit", {
      errorCode: "rate_limit_exceeded",
    });
    expect(isRetryableError(err)).toBe(false);
  });

  it("does NOT retry daily gateway request cap message", () => {
    expect(
      isRetryableError(new Error("daily gateway request cap exceeded")),
    ).toBe(false);
  });

  it("retries on builder_gateway_error code", () => {
    const err = new EngineError("gateway error", {
      errorCode: "builder_gateway_error",
    });
    expect(isRetryableError(err)).toBe(true);
  });

  it("retries on 'too many requests' in message", () => {
    expect(isRetryableError(new Error("too many requests, please wait"))).toBe(
      true,
    );
  });
});

// ─── trimOldToolResults ───────────────────────────────────────────────────────

describe("trimOldToolResults", () => {
  type Msg = Parameters<typeof trimOldToolResults>[0][number];

  function userTextMsg(text: string): Msg {
    return { role: "user", content: [{ type: "text", text }] };
  }

  function assistantTextMsg(text: string): Msg {
    return { role: "assistant", content: [{ type: "text", text }] };
  }

  /** Build a user message carrying a single tool-result part (real EngineToolResultPart shape). */
  function toolResultMsg(toolCallId: string, result: string): Msg {
    return {
      role: "user",
      content: [
        {
          type: "tool-result",
          toolCallId,
          toolName: "some_tool",
          toolInput: "{}",
          content: result,
        },
      ],
    };
  }

  function toolCallMsg(id: string, name: string): Msg {
    return {
      role: "assistant",
      content: [{ type: "tool-call", id, name, input: {} }],
    };
  }

  it("returns null when there are no tool-result messages to trim", () => {
    const messages: Msg[] = [userTextMsg("hi"), assistantTextMsg("hello")];
    expect(trimOldToolResults(messages)).toBeNull();
  });

  it("returns null when all tool results are in the protected tail", () => {
    const messages: Msg[] = [
      userTextMsg("start"),
      toolCallMsg("tc1", "read_file"),
      toolResultMsg("tc1", "file content"),
    ];
    // keepTail=10 protects all 3 messages
    expect(trimOldToolResults(messages, 10)).toBeNull();
  });

  it("stubs old tool results and leaves recent tail intact", () => {
    const messages: Msg[] = [
      toolCallMsg("old-tc", "read_file"),
      toolResultMsg("old-tc", "old huge file content"),
      userTextMsg("second turn"),
      toolCallMsg("new-tc", "run_tests"),
      toolResultMsg("new-tc", "recent result"),
    ];
    const result = trimOldToolResults(messages, 3);
    expect(result).not.toBeNull();

    // Old tool result (index 1, outside protected tail of 3) must be stubbed
    const oldResultMsg = result![1];
    expect(oldResultMsg.role).toBe("user");
    const oldPart = oldResultMsg.content[0] as {
      type: string;
      content: string;
    };
    expect(oldPart.type).toBe("tool-result");
    expect(oldPart.content).toContain("trimmed");

    // Recent tool result (index 4, inside tail) must be preserved
    const newResultMsg = result![4];
    const newPart = newResultMsg.content[0] as {
      type: string;
      content: string;
    };
    expect(newPart.type).toBe("tool-result");
    expect(newPart.content).toBe("recent result");
  });

  it("preserves user text messages even outside the tail", () => {
    const messages: Msg[] = [
      userTextMsg("original user question"),
      toolCallMsg("tc1", "tool"),
      toolResultMsg("tc1", "big result"),
      assistantTextMsg("assistant reply"),
      userTextMsg("followup"),
      assistantTextMsg("final"),
    ];
    const result = trimOldToolResults(messages, 2);
    expect(result).not.toBeNull();

    // User text message at index 0 must be preserved
    const firstPart = result![0].content[0] as { type: string; text: string };
    expect(firstPart.text).toBe("original user question");

    // Assistant text at index 3 must be preserved
    const thirdPart = result![3].content[0] as { type: string; text: string };
    expect(thirdPart.text).toBe("assistant reply");
  });

  it("does not mutate the input array", () => {
    const messages: Msg[] = [
      toolCallMsg("tc1", "tool"),
      toolResultMsg("tc1", "important data"),
      userTextMsg("turn 2"),
    ];
    const original = JSON.stringify(messages);
    trimOldToolResults(messages, 1);
    expect(JSON.stringify(messages)).toBe(original);
  });

  it("returns null when there is nothing to trim (only user/assistant text)", () => {
    const messages: Msg[] = Array.from({ length: 20 }, (_, i) =>
      i % 2 === 0 ? userTextMsg(`u${i}`) : assistantTextMsg(`a${i}`),
    );
    expect(trimOldToolResults(messages, 10)).toBeNull();
  });
});

describe("shouldChainBackgroundContinuation (server-driven background chain)", () => {
  function makeRun(
    events: AgentChatEvent[],
    status: ActiveRun["status"] = "completed",
  ): ActiveRun {
    const runEvents: RunEvent[] = events.map((event, seq) => ({ seq, event }));
    return {
      runId: "r1",
      threadId: "t1",
      turnId: "turn1",
      events: runEvents,
      status,
      subscribers: new Set(),
      abort: new AbortController(),
      startedAt: Date.now(),
    };
  }

  it("does NOT chain a foreground (non-background-worker) run", () => {
    expect(
      shouldChainBackgroundContinuation({
        isBackgroundWorker: false,
        run: makeRun([{ type: "auto_continue", reason: "run_timeout" }]),
        continuationCount: 0,
      }),
    ).toBe(false);
  });

  it("does NOT chain a clean run that ended with a terminal done", () => {
    expect(
      shouldChainBackgroundContinuation({
        isBackgroundWorker: true,
        run: makeRun([{ type: "text", text: "all done" }, { type: "done" }]),
        continuationCount: 0,
      }),
    ).toBe(false);
  });

  it("CHAINS a background run that completed tools but stopped before final text", () => {
    const run = makeRun([
      { type: "text", text: "I will update it now." },
      {
        type: "tool_start",
        tool: "edit-design",
        id: "tool-1",
        input: { fileId: "f1" },
      },
      {
        type: "tool_done",
        tool: "edit-design",
        id: "tool-1",
        input: { fileId: "f1" },
        result: '{"ok":true}',
        completedSideEffect: true,
      },
      { type: "done" },
    ]);

    expect(
      shouldChainBackgroundContinuation({
        isBackgroundWorker: true,
        run,
        continuationCount: 0,
      }),
    ).toBe(true);
    expect(backgroundContinuationReasonForRun(run)).toBe("stream_ended");
  });

  it("does NOT chain a background run that sent final text after completed tools", () => {
    expect(
      shouldChainBackgroundContinuation({
        isBackgroundWorker: true,
        run: makeRun([
          {
            type: "tool_done",
            tool: "edit-design",
            result: '{"ok":true}',
            completedSideEffect: true,
          },
          { type: "text", text: "Done." },
          { type: "done" },
        ]),
        continuationCount: 0,
      }),
    ).toBe(false);
  });

  it("CHAINS a background run that ended at an auto_continue boundary", () => {
    expect(
      shouldChainBackgroundContinuation({
        isBackgroundWorker: true,
        run: makeRun([{ type: "auto_continue", reason: "run_timeout" }]),
        continuationCount: 0,
      }),
    ).toBe(true);
  });

  it("CHAINS a background run that ended at a loop_limit boundary", () => {
    expect(
      shouldChainBackgroundContinuation({
        isBackgroundWorker: true,
        run: makeRun([{ type: "loop_limit" } as AgentChatEvent]),
        continuationCount: 3,
      }),
    ).toBe(true);
  });

  // ── Foreground self-chain (AGENT_CHAT_FOREGROUND_SELF_CHAIN) ─────────────
  // The boolean passed to shouldChainBackgroundContinuation is the already
  // resolved gate (hosted + A2A_SECRET + not explicitly opted out).

  it("does NOT chain a foreground run when the resolved self-chain gate is false", () => {
    expect(
      shouldChainBackgroundContinuation({
        isBackgroundWorker: false,
        run: makeRun([{ type: "auto_continue", reason: "run_timeout" }]),
        continuationCount: 0,
        foregroundSelfChainEligible: false,
      }),
    ).toBe(false);
  });

  it("CHAINS a foreground run at a continuation boundary when self-chain is opted in", () => {
    expect(
      shouldChainBackgroundContinuation({
        isBackgroundWorker: false,
        run: makeRun([{ type: "auto_continue", reason: "run_timeout" }]),
        continuationCount: 0,
        foregroundSelfChainEligible: true,
      }),
    ).toBe(true);
  });

  it("does NOT foreground-self-chain a run that was dispatched to the durable background worker", () => {
    // A background-dispatched run's recovery is owned by the circuit-breaker
    // + isBackgroundWorker chain — the foreground flag must never double up.
    expect(
      shouldChainBackgroundContinuation({
        isBackgroundWorker: false,
        run: makeRun([{ type: "auto_continue", reason: "run_timeout" }]),
        continuationCount: 0,
        foregroundSelfChainEligible: true,
        dispatchedToBackground: true,
      }),
    ).toBe(false);
  });

  it("does NOT foreground-self-chain an aborted (user-stopped) run", () => {
    expect(
      shouldChainBackgroundContinuation({
        isBackgroundWorker: false,
        run: makeRun(
          [{ type: "auto_continue", reason: "run_timeout" }],
          "aborted",
        ),
        continuationCount: 0,
        foregroundSelfChainEligible: true,
      }),
    ).toBe(false);
  });

  it("does NOT foreground-self-chain a cleanly finished run", () => {
    expect(
      shouldChainBackgroundContinuation({
        isBackgroundWorker: false,
        run: makeRun([{ type: "text", text: "all done" }, { type: "done" }]),
        continuationCount: 0,
        foregroundSelfChainEligible: true,
      }),
    ).toBe(false);
  });

  it("foreground self-chain respects the continuation budget", () => {
    expect(
      shouldChainBackgroundContinuation({
        isBackgroundWorker: false,
        run: makeRun([{ type: "auto_continue", reason: "run_timeout" }]),
        continuationCount: MAX_BACKGROUND_RUN_CONTINUATIONS,
        foregroundSelfChainEligible: true,
      }),
    ).toBe(false);
  });

  it("preserves the specific continuation reason for recoverable background errors", () => {
    expect(
      backgroundContinuationReasonForRun(
        makeRun([
          {
            type: "error",
            error: "Builder gateway timed out after 45s",
            errorCode: "builder_gateway_timeout",
            recoverable: true,
          },
        ]),
      ),
    ).toBe("gateway_timeout");
    expect(
      backgroundContinuationReasonForRun(
        makeRun([
          {
            type: "error",
            error: "socket hang up",
            recoverable: true,
          },
        ]),
      ),
    ).toBe("network_interrupted");
  });

  it("keeps unfinished action-preparation context through recoverable errors", () => {
    expect(
      lastUnfinishedPreparingActionToolFromEvents([
        {
          type: "activity",
          label: "Preparing edit-design action",
          tool: "edit-design",
          id: "tool-1",
          progressBytes: 0,
        },
        {
          type: "error",
          error: "Builder gateway timed out after 45s",
          errorCode: "builder_gateway_timeout",
          recoverable: true,
        },
      ]),
    ).toBe("edit-design");
    expect(
      lastUnfinishedPreparingActionToolFromEvents([
        {
          type: "activity",
          label: "Preparing edit-design action",
          tool: "edit-design",
          id: "tool-1",
          progressBytes: 0,
        },
        {
          type: "error",
          error: "Missing API key",
          errorCode: "missing_credentials",
        },
      ]),
    ).toBeUndefined();
  });

  it("keeps earlier unfinished action-preparation context when a later parallel input starts and finishes", () => {
    expect(
      lastUnfinishedPreparingActionToolFromEvents([
        {
          type: "activity",
          label: "Preparing edit-design action",
          tool: "edit-design",
          id: "edit-1",
          progressBytes: 1024,
        },
        {
          type: "activity",
          label: "Preparing generate-design action",
          tool: "generate-design",
          id: "generate-1",
          progressBytes: 512,
        },
        {
          type: "tool_start",
          tool: "generate-design",
          id: "generate-1",
          input: { designId: "d1" },
        },
        {
          type: "tool_done",
          tool: "generate-design",
          id: "generate-1",
          input: { designId: "d1" },
          result: '{"ok":true}',
        },
        {
          type: "error",
          error: "Builder gateway timed out after 45s",
          errorCode: "builder_gateway_timeout",
          recoverable: true,
        },
      ]),
    ).toBe("edit-design");
  });

  it("keeps same-tool action-preparation context when id-less tool events finish one parallel input", () => {
    expect(
      lastUnfinishedPreparingActionToolFromEvents([
        {
          type: "activity",
          label: "Preparing edit-design action",
          tool: "edit-design",
          id: "edit-1",
          progressBytes: 1024,
        },
        {
          type: "activity",
          label: "Preparing edit-design action",
          tool: "edit-design",
          id: "edit-2",
          progressBytes: 2048,
        },
        {
          type: "tool_start",
          tool: "edit-design",
          input: { fileId: "file-1" },
        },
        {
          type: "tool_done",
          tool: "edit-design",
          input: { fileId: "file-1" },
          result: '{"ok":true}',
        },
        {
          type: "error",
          error: "Builder gateway timed out after 45s",
          errorCode: "builder_gateway_timeout",
          recoverable: true,
        },
      ]),
    ).toBe("edit-design");
  });

  it("does NOT chain an aborted/user-stopped background run", () => {
    expect(
      shouldChainBackgroundContinuation({
        isBackgroundWorker: true,
        run: makeRun(
          [{ type: "auto_continue", reason: "run_timeout" }],
          "aborted",
        ),
        continuationCount: 0,
      }),
    ).toBe(false);
  });

  it("does NOT chain once the continuation budget is exhausted", () => {
    expect(
      shouldChainBackgroundContinuation({
        isBackgroundWorker: true,
        run: makeRun([{ type: "auto_continue", reason: "run_timeout" }]),
        continuationCount: MAX_BACKGROUND_RUN_CONTINUATIONS,
      }),
    ).toBe(false);
    // One below the cap still chains.
    expect(
      shouldChainBackgroundContinuation({
        isBackgroundWorker: true,
        run: makeRun([{ type: "auto_continue", reason: "run_timeout" }]),
        continuationCount: MAX_BACKGROUND_RUN_CONTINUATIONS - 1,
      }),
    ).toBe(true);
  });

  it("marks a successfully chained background chunk terminal before the worker returns", async () => {
    const updateRunStatusIfRunning = vi.fn(async () => true);
    const setRunError = vi.fn(async () => {});
    const setRunTerminalReason = vi.fn(async () => {});

    await expect(
      markBackgroundContinuationChunkTerminal({
        runId: "run-old",
        continuationReason: "no_progress",
        deps: { updateRunStatusIfRunning, setRunError, setRunTerminalReason },
      }),
    ).resolves.toBe(true);

    expect(updateRunStatusIfRunning).toHaveBeenCalledWith(
      "run-old",
      "completed",
    );
    expect(setRunTerminalReason).toHaveBeenCalledWith("run-old", "no_progress");
    expect(setRunError).not.toHaveBeenCalled();
  });

  it("marks a recoverable error continuation chunk errored with its durable failure details", async () => {
    const updateRunStatusIfRunning = vi.fn(async () => true);
    const setRunError = vi.fn(async () => {});
    const setRunTerminalReason = vi.fn(async () => {});

    await expect(
      markBackgroundContinuationChunkTerminal({
        runId: "run-error-boundary",
        continuationReason: "run_timeout",
        terminalEvent: {
          type: "error",
          error: "Provider connection failed",
          errorCode: "provider_failed",
          details: "upstream returned 500",
          recoverable: true,
        },
        deps: { updateRunStatusIfRunning, setRunError, setRunTerminalReason },
      }),
    ).resolves.toBe(true);

    expect(updateRunStatusIfRunning).toHaveBeenCalledWith(
      "run-error-boundary",
      "errored",
    );
    expect(setRunTerminalReason).toHaveBeenCalledWith(
      "run-error-boundary",
      "error:provider_failed",
    );
    expect(setRunError).toHaveBeenCalledWith(
      "run-error-boundary",
      "provider_failed",
      "upstream returned 500",
    );
  });

  it("does not overwrite terminal reason when another process already finished the chunk", async () => {
    const updateRunStatusIfRunning = vi.fn(async () => false);
    const setRunError = vi.fn(async () => {});
    const setRunTerminalReason = vi.fn(async () => {});

    await expect(
      markBackgroundContinuationChunkTerminal({
        runId: "run-old",
        continuationReason: "run_timeout",
        deps: { updateRunStatusIfRunning, setRunError, setRunTerminalReason },
      }),
    ).resolves.toBe(false);

    expect(updateRunStatusIfRunning).toHaveBeenCalledWith(
      "run-old",
      "completed",
    );
    expect(setRunTerminalReason).not.toHaveBeenCalled();
    expect(setRunError).not.toHaveBeenCalled();
  });
});

describe("appendAgentLoopContinuation", () => {
  it("includes action-specific guidance for stalled action preparation", () => {
    const messages: any[] = [];

    appendAgentLoopContinuation(messages, "no_progress", {
      actionPreparationTool: "edit-design",
    });

    const text = messages[0].content[0].text;
    expect(text).toContain(AGENT_INTERNAL_CONTINUE_PROMPT);
    expect(text).toContain("preparing the `edit-design` action input");
    expect(text).toContain("smaller `edit-design` payload");
    expect(text).toContain("exact search/replace edits");
    expect(text).toContain("reuse the existing `fileId`");
    expect(text).toContain("do not call `list-files`");
    expect(text).toContain("`replacementContent`");
  });

  it("resolves the real request behind internal continuations", () => {
    const messages: any[] = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ];
    appendAgentLoopContinuation(messages, "max_tokens");

    expect(resolveFinalResponseGuardRequestText(messages)).toBe("hello");
    expect(
      resolveFinalResponseGuardRequestText([messages.at(-1)]),
    ).toBeUndefined();
  });
});

describe("claimBackgroundWorkerRunEarly", () => {
  function deps(claimResult = true) {
    const calls: string[] = [];
    return {
      calls,
      recordRunDiagnostic: vi.fn(async (_runId: string, stage: string) => {
        calls.push(`record:${stage}`);
      }),
      insertRun: vi.fn(
        async (
          _runId: string,
          _threadId: string,
          _turnId: string,
          _options?: { dispatchMode?: "foreground" | "background" },
        ) => {
          calls.push("insert");
        },
      ),
      claimBackgroundRun: vi.fn(async (_runId: string) => {
        calls.push("claim");
        return claimResult;
      }),
      updateRunHeartbeat: vi.fn(async (_runId: string) => {
        calls.push("heartbeat");
      }),
    };
  }

  it("claims the first background chunk before expensive setup can race foreground fallback", async () => {
    const d = deps();

    await expect(
      claimBackgroundWorkerRunEarly({
        runId: "run-bg",
        threadId: "thread-bg",
        markerTurnId: "turn-bg",
        continuationCount: 0,
        runsInBackgroundFunction: true,
        deps: d,
      }),
    ).resolves.toEqual({ claimed: true });

    expect(d.insertRun).not.toHaveBeenCalled();
    expect(d.calls).toEqual([
      "record:worker_entered",
      "claim",
      "record:worker_claimed",
      "heartbeat",
    ]);
    expect(d.recordRunDiagnostic).toHaveBeenNthCalledWith(
      1,
      "run-bg",
      "worker_entered",
      "runsInBackgroundFunction=true continuationCount=0",
    );
  });

  it("records background runtime marker diagnostics on worker entry", async () => {
    const d = deps();

    await expect(
      claimBackgroundWorkerRunEarly({
        runId: "run-bg-marker",
        threadId: "thread-bg-marker",
        markerTurnId: "turn-bg-marker",
        continuationCount: 0,
        runsInBackgroundFunction: true,
        backgroundRuntimeDetail:
          "markerExpected=true runtimeDetected=false globalMarker=false",
        deps: d,
      }),
    ).resolves.toEqual({ claimed: true });

    expect(d.recordRunDiagnostic).toHaveBeenNthCalledWith(
      1,
      "run-bg-marker",
      "worker_entered",
      expect.stringContaining("markerExpected=true"),
    );
  });

  it("inserts a chained background continuation row before claiming it", async () => {
    const d = deps();

    await expect(
      claimBackgroundWorkerRunEarly({
        runId: "run-next",
        threadId: "thread-next",
        markerTurnId: "turn-next",
        continuationCount: 2,
        runsInBackgroundFunction: true,
        deps: d,
      }),
    ).resolves.toEqual({ claimed: true });

    expect(d.insertRun).toHaveBeenCalledWith(
      "run-next",
      "thread-next",
      "turn-next",
      { dispatchMode: "background" },
    );
    expect(d.calls).toEqual([
      "record:worker_entered",
      "insert",
      "claim",
      "record:worker_claimed",
      "heartbeat",
    ]);
  });

  it("records duplicate deliveries and does not heartbeat or execute the turn", async () => {
    const d = deps(false);

    await expect(
      claimBackgroundWorkerRunEarly({
        runId: "run-dupe",
        threadId: "thread-dupe",
        continuationCount: 0,
        runsInBackgroundFunction: true,
        deps: d,
      }),
    ).resolves.toEqual({ claimed: false, skipped: "already-claimed" });

    expect(d.updateRunHeartbeat).not.toHaveBeenCalled();
    expect(d.calls).toEqual([
      "record:worker_entered",
      "claim",
      "record:worker_claim_lost",
    ]);
  });
});

describe("resolveBackgroundDispatchOutcome (durable circuit-breaker)", () => {
  // Deterministic clock so the grace loop terminates without real time: each
  // now() call advances 10ms; with graceMs=25 the loop polls ~3 times.
  function makeClock() {
    let t = 0;
    return () => (t += 10);
  }
  const base = {
    runId: "run-x",
    graceMs: 25,
    pollIntervalMs: 5,
    sleep: async () => {},
  };
  // diag_stage is persisted as JSON ({stage, detail?, at}) by recordRunDiagnostic,
  // so model that here — exercises the parser the circuit-breaker relies on.
  const diag = (stage: string) => JSON.stringify({ stage, at: 1 });

  it("202 + worker claims within grace -> stream, no inline claim", async () => {
    const claim = vi.fn();
    const readClaim = vi
      .fn()
      .mockResolvedValueOnce({ dispatchMode: "background", status: "running" })
      .mockResolvedValueOnce({
        dispatchMode: "background-processing",
        status: "running",
      });
    const outcome = await resolveBackgroundDispatchOutcome({
      ...base,
      dispatched: true,
      backgroundRowInserted: true,
      readClaim,
      claim,
      now: makeClock(),
    });
    expect(outcome).toEqual({ action: "stream" });
    expect(claim).not.toHaveBeenCalled();
  });

  it("202 + no claim within grace -> foreground claims and runs inline", async () => {
    const readClaim = vi
      .fn()
      .mockResolvedValue({ dispatchMode: "background", status: "running" });
    const claim = vi.fn().mockResolvedValue(true);
    const outcome = await resolveBackgroundDispatchOutcome({
      ...base,
      dispatched: true,
      backgroundRowInserted: true,
      readClaim,
      claim,
      now: makeClock(),
    });
    expect(outcome).toEqual({
      action: "inline",
      reason: "worker-never-claimed",
    });
    expect(claim).toHaveBeenCalledWith("run-x");
  });

  it("delayed worker wins the claim race after grace -> subscribe (no double-run)", async () => {
    const readClaim = vi
      .fn()
      .mockResolvedValue({ dispatchMode: "background", status: "running" });
    const claim = vi.fn().mockResolvedValue(false);
    const outcome = await resolveBackgroundDispatchOutcome({
      ...base,
      dispatched: true,
      backgroundRowInserted: true,
      readClaim,
      claim,
      now: makeClock(),
    });
    expect(outcome).toEqual({ action: "subscribe" });
  });

  it("fast dispatch failure -> inline without polling for a claim", async () => {
    const readClaim = vi.fn();
    const claim = vi.fn().mockResolvedValue(true);
    const outcome = await resolveBackgroundDispatchOutcome({
      ...base,
      dispatched: false,
      backgroundRowInserted: true,
      readClaim,
      claim,
      now: makeClock(),
    });
    expect(outcome).toEqual({ action: "inline", reason: "dispatch-failed" });
    expect(readClaim).not.toHaveBeenCalled();
  });

  it("alive worker still in setup past the base grace -> extend, then stream when it claims", async () => {
    // auth_passed proves the worker is alive and grinding through setup. Without
    // the extension the base grace (25) elapses (~iter3) and recovers inline;
    // the reaper-anchored extension keeps polling so the late claim is honored.
    const claim = vi.fn();
    const alive = {
      dispatchMode: "background",
      status: "running",
      diagStage: diag("auth_passed"),
      lastLivenessAt: 0,
    };
    const readClaim = vi
      .fn()
      .mockResolvedValueOnce(alive)
      .mockResolvedValueOnce(alive)
      .mockResolvedValueOnce(alive)
      .mockResolvedValueOnce(alive)
      .mockResolvedValue({
        dispatchMode: "background-processing",
        status: "running",
        diagStage: diag("worker_claimed"),
        lastLivenessAt: 0,
      });
    const outcome = await resolveBackgroundDispatchOutcome({
      ...base,
      reaperGraceMs: 100_000, // far away, so the claim wins before the reaper cap
      dispatched: true,
      backgroundRowInserted: true,
      readClaim,
      claim,
      now: makeClock(),
    });
    expect(outcome).toEqual({ action: "stream" });
    expect(claim).not.toHaveBeenCalled();
  });

  it("dead handoff (never recorded auth_passed) is NOT extended -> inline at the base grace", async () => {
    // No diag stage = the generated wrapper never reached the route, so the
    // extension must not apply and it recovers inline at the base grace.
    const readClaim = vi.fn().mockResolvedValue({
      dispatchMode: "background",
      status: "running",
      diagStage: null,
      lastLivenessAt: 0,
    });
    const claim = vi.fn().mockResolvedValue(true);
    const outcome = await resolveBackgroundDispatchOutcome({
      ...base,
      reaperGraceMs: 100_000,
      dispatched: true,
      backgroundRowInserted: true,
      readClaim,
      claim,
      now: makeClock(),
    });
    expect(outcome).toEqual({
      action: "inline",
      reason: "worker-never-claimed",
    });
    expect(claim).toHaveBeenCalledWith("run-x");
  });

  it("worker that threw during setup (route_threw) recovers inline immediately, not after the grace", async () => {
    const readClaim = vi.fn().mockResolvedValue({
      dispatchMode: "background",
      status: "running",
      diagStage: diag("route_threw"),
      lastLivenessAt: 0,
    });
    const claim = vi.fn().mockResolvedValue(true);
    const outcome = await resolveBackgroundDispatchOutcome({
      ...base,
      reaperGraceMs: 100_000,
      dispatched: true,
      backgroundRowInserted: true,
      readClaim,
      claim,
      now: makeClock(),
    });
    expect(outcome).toEqual({
      action: "inline",
      reason: "worker-never-claimed",
    });
    // Broke on the FIRST poll via the death check — did not wait out the grace.
    expect(readClaim).toHaveBeenCalledTimes(1);
  });

  it("alive worker that never claims recovers inline BEFORE the reaper, anchored to row liveness", async () => {
    // The worker stays alive in setup (auth_passed) but never claims. The
    // extension is bounded by the reaper window measured from the row's OWN
    // liveness (lastLivenessAt), NOT poll-start — so the foreground claims inline
    // just before reapUnclaimedBackgroundRun would fire. With reaperGraceMs=60
    // and margin=10 the cap is liveness+50; the stepping clock hits 50 at iter4.
    const readClaim = vi.fn().mockResolvedValue({
      dispatchMode: "background",
      status: "running",
      diagStage: diag("auth_passed"),
      lastLivenessAt: 0,
    });
    const claim = vi.fn().mockResolvedValue(true);
    const outcome = await resolveBackgroundDispatchOutcome({
      ...base,
      reaperGraceMs: 60,
      reaperSafetyMarginMs: 10,
      dispatched: true,
      backgroundRowInserted: true,
      readClaim,
      claim,
      now: makeClock(),
    });
    expect(outcome).toEqual({
      action: "inline",
      reason: "worker-never-claimed",
    });
    // Bounded by the reaper-anchored cap (liveness+50 → iter4), not unbounded.
    expect(readClaim).toHaveBeenCalledTimes(4);
  });
});

describe("runAgentLoop tool-result images", () => {
  it("attaches _agentImages to the tool-result part, strips the field from the text, and persists only notes", async () => {
    const oversize = "A".repeat(2_000_001);
    const actions: Record<string, ActionEntry> = {
      screenshot: {
        ...actionEntry({ description: "Take a screenshot", readOnly: true }),
        run: async () => ({
          ok: true,
          page: "dashboard",
          _agentImages: [
            { url: "https://cdn.example.com/shot.png", label: "before" },
            { data: oversize, mediaType: "image/png", label: "too-big" },
          ],
        }),
      },
    };
    const tools = actionsToEngineTools(actions);
    let streamCalls = 0;
    let secondCallMessages: any[] = [];

    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: true,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(opts): AsyncIterable<EngineEvent> {
        streamCalls += 1;
        if (streamCalls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call" as const,
                id: "shot-1",
                name: "screenshot",
                input: {},
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        secondCallMessages = opts.messages as any[];
        yield {
          type: "assistant-content",
          parts: [{ type: "text" as const, text: "looks good" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };

    const events: AgentChatEvent[] = [];
    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "system",
      tools,
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      actions,
      send: (e) => events.push(e),
      signal: new AbortController().signal,
    });

    const toolResult = secondCallMessages
      .flatMap((m: any) => m.content ?? [])
      .find((p: any) => p.type === "tool-result");
    expect(toolResult).toBeDefined();
    // Valid image rides the part; the oversize one was dropped.
    expect(toolResult.images).toEqual([
      { url: "https://cdn.example.com/shot.png", label: "before" },
    ]);
    // The field is stripped from the JSON the model reads…
    expect(toolResult.content).not.toContain("_agentImages");
    expect(toolResult.content).toContain('"page": "dashboard"');
    // …the url note and the oversize drop note are appended as text…
    expect(toolResult.content).toContain("https://cdn.example.com/shot.png");
    expect(toolResult.content).toContain("exceeds");
    // …and the base64 payload never reaches the text.
    expect(toolResult.content).not.toContain("A".repeat(100));

    // The persisted tool_done event carries only the string result (with the
    // notes), never an images array.
    const toolDone = events.find((e) => e.type === "tool_done") as any;
    expect(toolDone).toBeDefined();
    expect(toolDone.result).toContain("https://cdn.example.com/shot.png");
    expect(toolDone.result).not.toContain("A".repeat(100));
    expect(toolDone.images).toBeUndefined();
  });
});
