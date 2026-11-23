import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import {
  createBuilderEngine,
  type EngineEvent,
} from "@agent-native/core/agent/engine";
import {
  actionsToEngineTools,
  createAgentChatPlugin,
  generateActionsPrompt,
} from "@agent-native/core/server";
import {
  AGENT_PATH_PROVIDERS,
  providerSchemaViolations,
} from "@agent-native/core/testing";
import { generateActionRegistryForProject } from "@agent-native/core/vite";
import { beforeAll, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  NOTEBOOK_SNAPSHOT_CELL_LIMIT,
  NOTEBOOK_SNAPSHOT_TEXT_LIMIT,
} from "../../shared/notebook-editing.js";

const state = vi.hoisted(() => ({ read: vi.fn(), readTab: vi.fn() }));

vi.mock(import("@agent-native/core/server"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createAgentChatPlugin: vi.fn(actual.createAgentChatPlugin),
  };
});
vi.mock("@agent-native/core/application-state", () => ({
  readAppState: state.read,
  readAppStateForCurrentTab: state.readTab,
}));
vi.mock("../lib/project-action-access.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/project-action-access.js")>()),
  requireReadableProject: vi.fn().mockResolvedValue({ scope: {}, project: {} }),
}));
vi.mock("../model/project-grant-access.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../model/project-grant-access.js")
  >()),
  projectAccessLevel: vi.fn().mockResolvedValue("owner"),
}));

beforeAll(() => {
  generateActionRegistryForProject(
    fileURLToPath(new URL("../..", import.meta.url)),
  );
});

it("report A2-KEYSCREEN-THREAD-INLINE-CHART makes the framework data widget available for inline chart answers", async () => {
  await import("./agent-chat.js");
  const options = vi.mocked(createAgentChatPlugin).mock.lastCall?.[0];
  assert(options);

  expect(options.actions).not.toHaveProperty("render-data-widget");
  expect(options.corpusTools).toBe("lazy");
  expect(options.frameworkTools).toMatchObject({ database: "off" });
  expect(options.systemPrompt).toMatch(/pending_review/i);
  expect(options.initialToolNames).toContain("get-project");
  expect(options.initialToolNames).toContain("render-data-widget");
  expect(options.initialToolNames).not.toContain(
    "create-project-publish-preview",
  );
  expect(options.initialToolNames).not.toContain("open-published-app-session");
  expect(options.systemPrompt).toMatch(/render-data-widget/);
  expect(options.systemPrompt).toMatch(/inline chart/i);
  expect(options.systemPrompt).toMatch(/never invent/i);
});

it("report K-ANA-3-1 tells the agent to create a notebook in one call when no notebook thread is open", async () => {
  await import("./agent-chat.js");
  const options = vi.mocked(createAgentChatPlugin).mock.lastCall?.[0];
  assert(options);

  expect(options.systemPrompt).toMatch(/no notebook thread is open/i);
  expect(options.systemPrompt).toMatch(
    /create-project once with starter \{kind: "cells"\}/,
  );
  expect(options.systemPrompt).toMatch(/list-connection-datasets/);
  expect(options.initialToolNames).toContain("list-connection-datasets");
});

it("K-ANA-8-2 tells the agent to open a connection's tables for browse requests", async () => {
  await import("./agent-chat.js");
  const options = vi.mocked(createAgentChatPlugin).mock.lastCall?.[0];
  assert(options);

  expect(options.initialToolNames).toContain("navigate");
  expect(options.initialToolNames).toContain("list-data-connections");
  expect(options.initialToolNames).toContain("list-connection-datasets");
  expect(options.systemPrompt).toMatch(/browse tables/i);
  expect(options.systemPrompt).toMatch(
    /navigate with kind data-connection[^.]*intent open/i,
  );
  expect(options.systemPrompt).toMatch(/builtin-sample-data/);
  expect(options.systemPrompt).toMatch(/dataConnectionId.*tableId/i);
});

it("K-ANA-8-2 opens a table detail in the home data browser even from inside a project", async () => {
  await import("./agent-chat.js");
  const options = vi.mocked(createAgentChatPlugin).mock.lastCall?.[0];
  assert(options);

  const browse = options.systemPrompt
    ?.split("\n\n")
    .find((p) => /browse tables/i.test(p));
  assert(browse);
  expect(browse).toMatch(/first table|named table/i);
  expect(browse).toMatch(
    /navigate with dataConnectionId, tableId[^.]*intent open/i,
  );
  expect(browse).toMatch(/from inside a project/i);
  expect(browse).toMatch(/\/home\/data/);
  expect(browse).toMatch(/never[^.]*\/project\//i);
});

it("K-ANA-5-1 preloads search-workspace and directs topic searches to open results", async () => {
  await import("./agent-chat.js");
  const options = vi.mocked(createAgentChatPlugin).mock.lastCall?.[0];
  assert(options);

  expect(options.initialToolNames).toContain("search-workspace");
  expect(options.systemPrompt).toMatch(/search-workspace/i);
  expect(options.systemPrompt).toMatch(/intent.*open/i);
});

it("K-ANA-1-1 directs recent-projects requests to open the home view alongside list-projects", async () => {
  await import("./agent-chat.js");
  const options = vi.mocked(createAgentChatPlugin).mock.lastCall?.[0];
  assert(options);

  expect(options.initialToolNames).toContain("list-projects");
  expect(options.initialToolNames).toContain("navigate");
  expect(options.systemPrompt).toMatch(/recent projects/i);
  expect(options.systemPrompt).toMatch(/navigate[^.\n]*home/i);
});

it("report K-ANA-4-1 resolves 'that query' from the newest SQL notebook instead of asking when no project is open", async () => {
  await import("./agent-chat.js");
  const options = vi.mocked(createAgentChatPlugin).mock.lastCall?.[0];
  assert(options);

  expect(options.initialToolNames).toContain("resolve-project");
  expect(options.systemPrompt).toMatch(/resolve-project[^.\n]*recent-query/i);
  expect(options.systemPrompt).toMatch(/that query/i);
  expect(options.systemPrompt).toMatch(/no project is open/i);
  expect(options.systemPrompt).toMatch(/thread's own notebook is empty/i);
});

it("B8 preloads open-project and sends a named-dashboard question to that dashboard instead of running its cells from another conversation", async () => {
  await import("./agent-chat.js");
  const options = vi.mocked(createAgentChatPlugin).mock.lastCall?.[0];
  assert(options);

  expect(options.initialToolNames).toContain("open-project");
  expect(options.systemPrompt).toMatch(/open-project[^.\n]*name/i);
  expect(options.systemPrompt).toMatch(/get-project-summary once/i);
  expect(options.systemPrompt).toMatch(
    /never run-project-cell[^.\n]*another project/i,
  );
});

it("bounds Analytics first-request bytes when notebook tools are preloaded", async () => {
  await import("./agent-chat.js");
  const options = vi.mocked(createAgentChatPlugin).mock.lastCall?.[0];
  assert(options?.actions && typeof options.actions === "object");
  const actions = Object.fromEntries(
    Object.entries(options.actions).filter(([name]) =>
      options.initialToolNames?.includes(name),
    ),
  );
  const preloadedToolNames = [
    "stage-notebook-proposal",
    "set-app",
    "create-project",
  ];
  const preloadedTools = actionsToEngineTools(options.actions).filter(
    ({ name }) => preloadedToolNames.includes(name),
  );

  const projectId = "prj_large_notebook";
  const cellSource = `select '${"😀".repeat(NOTEBOOK_SNAPSHOT_TEXT_LIMIT)}'`;
  const editing = {
    projectId,
    cells: Array.from({ length: NOTEBOOK_SNAPSHOT_CELL_LIMIT }, (_, index) => ({
      id: `cel_preview_${index}`,
      kind: "sql" as const,
      text: cellSource.slice(0, NOTEBOOK_SNAPSHOT_TEXT_LIMIT),
      truncated: true,
      unsaved: index === 0,
    })),
    truncated: true,
  };
  state.read.mockResolvedValue({
    view: "project",
    resourceKind: "project",
    resourceId: projectId,
  });
  state.readTab.mockImplementation(async (key: string) =>
    key === "notebook-editing" ? editing : null,
  );
  const viewScreen = actions["view-screen"];
  assert(viewScreen);
  const screen = await viewScreen.run({}, { caller: "tool" });
  expect(screen).toMatchObject({
    editingSummary: {
      projectId,
      truncated: true,
      cells: editing.cells.map(({ id, kind, truncated, unsaved }) => ({
        id,
        kind,
        truncated,
        unsaved,
      })),
    },
  });
  const explicitScreen = await viewScreen.run(
    {},
    { caller: "tool", toolCallId: "view_screen" },
  );
  expect(explicitScreen).toMatchObject({ editing });

  const gatewayFetch = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(
        '{"type":"text-delta","text":"Ready"}\n{"type":"stop","reason":"end_turn"}\n',
        { headers: { "Content-Type": "application/jsonl" } },
      ),
    );
  vi.stubGlobal("fetch", gatewayFetch);
  vi.stubEnv("BUILDER_GATEWAY_BASE_URL", "https://builder.test/v1");
  try {
    const engine = createBuilderEngine({
      credentials: {
        privateKey: "fake-test-key",
        publicKey: "fake-test-space",
      },
    });
    const events: EngineEvent[] = [];
    for await (const event of engine.stream({
      model: "gpt-6-luna",
      maxOutputTokens: 64_000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Use notebook tools. Insert a SQL cell using SELECT 13042 AS result, visualize that result in a chart, and add an independent text cell containing Magic scratch 13. Run the candidate SQL before asking for review. Do not confirm anything.",
            },
          ],
        },
      ],
      systemPrompt: `${options.systemPrompt}${generateActionsPrompt(actions)}\n\n<current-screen>\n${JSON.stringify(screen, null, 2)}\n</current-screen>`,
      tools: [...preloadedTools, ...actionsToEngineTools(actions)],
      abortSignal: new AbortController().signal,
    }))
      events.push(event);
    expect(events.at(-1)).toMatchObject({ type: "stop", reason: "end_turn" });
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }

  const wire = gatewayFetch.mock.calls[0]?.[1]?.body;
  assert(typeof wire === "string");
  expect(Buffer.byteLength(wire)).toBeLessThan(64 * 1024);
  expect(wire).toContain(projectId);
  expect(wire).toContain("cel_preview_0");
  expect(wire).not.toContain("😀");
  const tools = z
    .object({
      tools: z.array(z.object({ name: z.string(), input_schema: z.unknown() })),
    })
    .parse(JSON.parse(wire)).tools;
  expect(tools.map(({ name }) => name)).toEqual(
    expect.arrayContaining([
      "view-screen",
      "get-project",
      "add-project-cell",
      "save-project-cell",
      "start-notebook-run",
      "run-project-cell",
      "get-notebook-pending-changes",
      "get-notebook-run",
      "get-notebook-result-page",
      ...preloadedToolNames,
    ]),
  );
  for (const tool of tools) {
    const byteBudget = tool.name === "save-project-cell" ? 6 : 16;
    expect(Buffer.byteLength(JSON.stringify(tool)), tool.name).toBeLessThan(
      byteBudget * 1024,
    );
  }
  expect(
    tools.flatMap(({ name, input_schema }) =>
      providerSchemaViolations({ name, inputSchema: input_schema }).filter(
        ({ provider }) =>
          AGENT_PATH_PROVIDERS.some((selected) => selected === provider),
      ),
    ),
  ).toEqual([]);
});

it("report QA-1794950716.099249 lets read-only SELECTs run without a permission prompt while mutating SQL still asks", async () => {
  await import("./agent-chat.js");
  const options = vi.mocked(createAgentChatPlugin).mock.lastCall?.[0];
  assert(options);

  expect(options.systemPrompt).toMatch(
    /read-only SELECTs[^.]*\. Run them with run-project-cell right away/,
  );
  expect(options.systemPrompt).toMatch(/start-notebook-run/);
  expect(options.systemPrompt).toMatch(/pending_review/);
  expect(options.systemPrompt).toMatch(
    /never ask "Should I run the cell now\?"/,
  );
  expect(options.systemPrompt).toMatch(
    /Ask first only for SQL that changes data or schema/,
  );
});

it("report QA-1794950687.488649 tells the agent that partial results must be flagged and aggregates computed in SQL", async () => {
  await import("./agent-chat.js");
  const options = vi.mocked(createAgentChatPlugin).mock.lastCall?.[0];
  assert(options);

  expect(options.systemPrompt).toMatch(/preview\.partial true/);
  expect(options.systemPrompt).toMatch(/never infer absence/i);
  expect(options.systemPrompt).toMatch(/grain/i);
  expect(options.systemPrompt).toMatch(
    /Compute every aggregate in a SQL cell over the full data/,
  );
});

it("report SAYA-1117-INPUT-DOCS surfaces SQL input binding and dynamicOptions in systemPrompt", async () => {
  await import("./agent-chat.js");
  const options = vi.mocked(createAgentChatPlugin).mock.lastCall?.[0];
  assert(options);

  expect(options.systemPrompt).toMatch(/\{\{[^}]*\}\}/);
  expect(options.systemPrompt).toMatch(/\| array/);
  expect(options.systemPrompt).toMatch(/dynamicOptions/);
  expect(options.systemPrompt).toMatch(/producerCellId/);
  expect(options.systemPrompt).toMatch(/valueFieldId/);
  expect(options.systemPrompt).toMatch(/get-notebook-input-choices/);
  expect(options.systemPrompt).toMatch(/inputOptionsResultId/);
});

it("report QA-1794950510.186719 ties the final reply to the cell IDs the tool receipts returned", async () => {
  await import("./agent-chat.js");
  const options = vi.mocked(createAgentChatPlugin).mock.lastCall?.[0];
  assert(options);

  expect(options.systemPrompt).toMatch(
    /name only cells whose IDs a tool call returned/i,
  );
  expect(options.systemPrompt).toMatch(/Do not claim a cell you did not add/);
});
