import { describe, expect, it } from "vitest";

import { planWorkflowJob } from "../../../server/lib/factory-workflow-job.js";
import { workflowGraphSchema } from "../../../server/workflow/contract.js";
import { validateWorkflowGraph } from "../../../server/workflow/graph-validation.js";
import {
  holdNewWorkflowRequest,
  minimalWorkflowGraph,
  newWorkflowAgentMessage,
  takeNewWorkflowRequest,
  workflowNameFromPrompt,
} from "./new-workflow";
import { WORKFLOW_CATALOG } from "./workflow-catalog";

describe("minimalWorkflowGraph", () => {
  it("is a trigger leading to an end", () => {
    const graph = minimalWorkflowGraph();
    expect(graph.nodes.map((node) => node.kind)).toEqual(["trigger", "end"]);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]?.from.node).toBe(graph.nodes[0]?.id);
    expect(graph.edges[0]?.to.node).toBe(graph.nodes[1]?.id);
  });

  it("passes the checks a save runs", () => {
    const graph = minimalWorkflowGraph();
    expect(workflowGraphSchema.safeParse(graph).success).toBe(true);
    expect(validateWorkflowGraph(graph, WORKFLOW_CATALOG).issues).toEqual([]);
    const job = planWorkflowJob(graph);
    expect(job.issues).toEqual([]);
    expect(job.plan).not.toBeNull();
  });

  it("is a new graph each time, so two workflows never share ids by reference", () => {
    expect(minimalWorkflowGraph()).not.toBe(minimalWorkflowGraph());
  });
});

describe("takeNewWorkflowRequest", () => {
  it("hands a held request to the canvas once", () => {
    holdNewWorkflowRequest("wf-held-once", "post new pull requests to #eng");
    expect(takeNewWorkflowRequest("wf-held-once")).toBe(
      "post new pull requests to #eng",
    );
    expect(takeNewWorkflowRequest("wf-held-once")).toBeNull();
  });

  it("returns nothing for a workflow that was never given a request", () => {
    expect(takeNewWorkflowRequest("wf-never-held")).toBeNull();
  });
});

describe("newWorkflowAgentMessage", () => {
  it("puts the trimmed request after the prefix", () => {
    expect(
      newWorkflowAgentMessage(
        "Create a workflow that ",
        "  every weekday at 9am  ",
      ),
    ).toBe("Create a workflow that every weekday at 9am");
  });
});

describe("workflowNameFromPrompt", () => {
  it("cuts a long prompt to 80 characters, makes a line break one line, and keeps a short prompt", () => {
    expect(workflowNameFromPrompt("x".repeat(120))).toBe("x".repeat(80));
    expect(
      workflowNameFromPrompt("Post new pull requests\r\n\n  to #eng"),
    ).toBe("Post new pull requests to #eng");
    expect(workflowNameFromPrompt("  Post to #eng  ")).toBe("Post to #eng");
  });
});
