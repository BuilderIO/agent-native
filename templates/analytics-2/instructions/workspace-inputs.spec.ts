import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("../server/agent-navigation.js", async () => {
  const { z } = await import("zod");
  return {
    agentNavigationSchema: z.any(),
    showAgentProject: vi.fn(),
  };
});
vi.mock("../server/lib/cell-revision.js", () => ({
  isCellRevisionCurrent: vi.fn(),
}));
vi.mock("../server/lib/notebook-tool-cell-edits.js", () => ({
  notebookToolCellEdits: vi.fn(),
}));
vi.mock("../server/lib/notebook-tool-context.js", () => ({
  isNotebookToolWrite: vi.fn(),
  privateAskNotebookWrite: vi.fn(),
}));
vi.mock("../server/lib/notebook-tool-proposal.js", () => ({
  notebookProposalChatUI: {},
  notebookToolProposalFields: {},
  proposeNotebookToolChange: vi.fn(),
}));
vi.mock("../server/lib/project-action-access.js", async () => {
  const { z } = await import("zod");
  return {
    assertGrantedDataConnection: vi.fn(),
    assertGrantedMetricConnection: vi.fn(),
    assertValidCellConnection: vi.fn(),
    notebookChangeResource: {},
    projectDocumentResultSchema: z.object({}),
    refreshedProjectDocument: vi.fn(),
    requireWritableProject: vi.fn(),
  };
});
vi.mock("../server/model/cells-store.js", () => ({
  updateCell: vi.fn(),
}));
vi.mock("../server/model/notebook-execution/service.js", () => ({
  wakeReactiveNotebookRun: vi.fn(),
}));
vi.mock("../server/model/notebook-operations/legacy.js", () => ({
  readLegacyNotebook: vi.fn(),
  requireLegacyCell: vi.fn(),
}));
vi.mock("../server/model/visualization-source.js", () => ({
  bindChartResult: vi.fn(),
}));

import querySkill from "../.agents/skills/analytics-queries/SKILL.md?raw";
import saveProjectCell from "../actions/save-project-cell.js";
import {
  parameterCellContentsSchema,
  sqlCellContentsSchema,
} from "../app/lib/model/contracts.js";
import {
  notebookGraph,
  type ExecutionCell,
} from "../server/model/notebook-execution/planner.js";
import { compileSqlTemplate } from "../server/model/sql-template.js";
import { notebookCellIdSchema } from "../shared/notebook-snapshot-contract.js";
import instructions from "./workspace.md?raw";

const COMPACT_STARTUP_PROMPT_MAX_CHARS = 6_000;

describe("report SAYA-1117-INPUT-DOCS", () => {
  it.each([
    ["runtime instructions", instructions],
    [
      "compact startup instructions",
      instructions.trim().slice(0, COMPACT_STARTUP_PROMPT_MAX_CHARS),
    ],
    ["query skill", querySkill],
  ])("%s describes the current input binding contract", (_name, text) => {
    expect(text).not.toContain("optionsSource");
    for (const field of [
      "{{ region }}",
      "IN ({{ regions | array }})",
      "dynamicOptions",
      "producerCellId",
      "valueFieldId",
      "inputOptionsResultId",
    ])
      expect(text).toContain(field);
    expect(text).toContain("get-notebook-input-choices");
    expect(text).toContain("get-notebook-execution");
    expect(text).toContain("| array");
  });

  it("save-project-cell agent schema exposes dynamicOptions and documents inputOptionsResultId", () => {
    const schema = saveProjectCell.agentInputSchema;
    expect(schema).toBeDefined();
    const shape = schema!.shape;
    expect(shape.inputOptionsResultId.description).toMatch(
      /get-notebook-input-choices/,
    );
    const contentsShape = shape.contents.shape;
    expect(contentsShape).toHaveProperty("dynamicOptions");
    expect(contentsShape).toHaveProperty("defaultValueString");
    expect(contentsShape).toHaveProperty("options");
    expect(contentsShape).toHaveProperty("optionValueType");
    expect(contentsShape).not.toHaveProperty("optionsSource");
    const inputSchema = z.toJSONSchema(schema!) as {
      properties?: {
        contents?: {
          properties?: Record<string, Record<string, unknown>>;
        };
      };
    };
    const toolEstimateBytes = Buffer.byteLength(
      JSON.stringify({
        name: "save-project-cell",
        description: saveProjectCell.description,
        input_schema: inputSchema,
      }),
    );
    expect(toolEstimateBytes).toBeLessThan(6 * 1024);
    const contentProps = inputSchema.properties?.contents?.properties ?? {};
    expect(contentProps.options).not.toHaveProperty("maxItems");
    expect(contentProps.dynamicOptions?.properties).toHaveProperty(
      "producerCellId",
    );
    expect(contentProps.dynamicOptions?.properties).toHaveProperty(
      "valueFieldId",
    );
    expect(contentProps.dynamicOptions?.properties).toHaveProperty(
      "displayFieldId",
    );
  });

  it("the documented dynamic multiselect schedules its producer and binds selected values", () => {
    const example = querySkill.match(/```json\s*([\s\S]*?)```/);
    expect(
      example,
      "the input guide needs an executable configuration example",
    ).not.toBeNull();
    const patch: unknown = JSON.parse(example![1]!);
    const base = {
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
    };
    const sql = (id: string, source: string): ExecutionCell => ({
      id: notebookCellIdSchema.parse(id),
      contents: sqlCellContentsSchema.parse({
        ...base,
        id,
        order: id,
        kind: "sql",
        source,
        resultVariable: id,
        outputResult: true,
        databaseSchema: null,
        dataConnectionId: "sample-connection",
      }),
    });
    const input = parameterCellContentsSchema.parse({
      ...base,
      id: "selection",
      order: "b",
      kind: "input",
      name: "regions",
      inputType: "MULTISELECT",
      defaultValueString: "[]",
      ...Object(patch),
    });
    const source =
      "SELECT region FROM orders WHERE region IN ({{ regions | array }})";
    const graph = notebookGraph([
      sql("choices", "SELECT DISTINCT region FROM orders"),
      { id: notebookCellIdSchema.parse(input.id), contents: input },
      sql("filtered", source),
    ]);
    expect(graph[2]?.problem).toBeUndefined();
    expect(graph[2]?.dependencies).toEqual(
      expect.arrayContaining([
        { name: "regions", cellId: "selection", kind: "input" },
        { name: "regions", cellId: "choices", kind: "options" },
      ]),
    );
    const values: string[] = JSON.parse(input.defaultValueString);
    expect(values).toEqual(["North"]);
    const compiled = compileSqlTemplate(source, { regions: values });
    expect(compiled.sql).toBe(
      "SELECT region FROM orders WHERE region IN (@template_0)",
    );
    expect(
      compiled.parameters.map((parameter) => parameter.parameterValue.value),
    ).toEqual(values);
  });
});
