import { describe, expect, it } from "vitest";

import { createEnglishTranslator } from "@/lib/__tests__/en-translator";
import {
  createWorkflowEditor,
  workflowGraphSchema,
  type WorkflowEditor,
} from "@/lib/workflow-editor";

import { OPERATION_CATALOG } from "../../../server/workflow/catalog/index.js";
import { toFlowNodes } from "./flow-model";
import { createWorkflowCanvasStrings } from "./strings";

const strings = createWorkflowCanvasStrings(createEnglishTranslator());
const fixed = (value: unknown) => ({ mode: "fixed" as const, value });

function stepWith(args: Record<string, ReturnType<typeof fixed>>): {
  editor: WorkflowEditor;
  nodeId: string;
} {
  const editor = createWorkflowEditor({
    graph: workflowGraphSchema.parse({ nodes: [], edges: [], settings: {} }),
    catalog: OPERATION_CATALOG,
  });
  const trigger = editor.addNode("trigger");
  if (!trigger.ok) throw new Error("no trigger");
  const added = editor.addNode("lookup", {
    operationId: "github.apiRequest",
    after: { node: trigger.node.id, port: "out" },
  });
  if (!added.ok) throw new Error("no lookup");
  const set = editor.updateNodeSettings(added.node.id, {
    operation: "github.apiRequest",
    args,
  });
  if (!set.ok) throw new Error("settings refused");
  return { editor, nodeId: added.node.id };
}

function card(editor: WorkflowEditor, nodeId: string) {
  const flow = toFlowNodes({
    graph: editor.getSnapshot().graph,
    catalog: OPERATION_CATALOG,
    validation: editor.validate(),
    selection: { nodeIds: [], edgeIds: [] },
    readOnly: false,
    strings,
  }).find((node) => node.id === nodeId);
  if (!flow) throw new Error("no card");
  return flow.data;
}

describe("an API request card", () => {
  it("reads GET: until a path is set, then GET: and the path", () => {
    const empty = stepWith({ path: fixed("") });
    expect(card(empty.editor, empty.nodeId).subtitle).toBe("GET:");
    const typed = stepWith({ path: fixed("repos/acme/web/issues") });
    expect(card(typed.editor, typed.nodeId).subtitle).toBe(
      "GET: repos/acme/web/issues",
    );
  });

  it("shows an expression as it is written", () => {
    const { editor, nodeId } = stepWith({});
    const read = editor.updateNodeSettings(nodeId, {
      operation: "github.apiRequest",
      args: { path: { mode: "path", path: "settings.repoPath" } },
    });
    expect(read.ok).toBe(true);
    expect(card(editor, nodeId).subtitle).toBe("GET: {{ settings.repoPath }}");
  });

  it("carries a warning while the path is empty and none once it is set", () => {
    const empty = stepWith({ path: fixed("") });
    const marks = card(empty.editor, empty.nodeId).issues.map((issue) =>
      strings.issue.sentence(issue),
    );
    expect(marks).toContain(
      "Type the path of the endpoint, such as repos/acme/web/issues.",
    );
    const typed = stepWith({ path: fixed("user") });
    expect(
      card(typed.editor, typed.nodeId).issues.map((issue) => issue.code),
    ).not.toContain("missing_required_field");
  });

  it("words a refused field from its typed code, not from the validator's English", () => {
    const { editor, nodeId } = stepWith({
      path: fixed("https://api.github.com/repos/a/b"),
      headers: fixed({ Authorization: "x" }),
    });
    const sentences = card(editor, nodeId).issues.map((issue) =>
      strings.issue.sentence(issue),
    );
    expect(sentences).toContain(
      "Type only the path. The host comes from the connection.",
    );
    expect(sentences).toContain(
      "Authorization is sent by the connection, so it cannot be set here.",
    );
  });
});
