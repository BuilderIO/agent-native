import { describe, expect, it } from "vitest";

import { stubTranslator } from "@/lib/__tests__/en-translator";

import { OPERATION_CATALOG } from "../../../server/workflow/catalog/index.js";
import { describeNode } from "../workflow-canvas/node-summary";
import { buildPalette } from "../workflow-canvas/palette";
import { createWorkflowCanvasStrings } from "../workflow-canvas/strings";
import {
  actorLabel,
  describeRunCounts,
  runStatusView,
} from "./activity/activity-model";
import { segmentsLabel, statusSegments } from "./audit/audit-model";
import { createItemsStrings } from "./items-strings";
import { formatDayLabel, formatDuration } from "./items/format";
import { needsYouText, sourceLabel, statusLabel } from "./items/item-status";
import { minimalWorkflowGraph } from "./new-workflow";
import { scheduleLabel } from "./workflow-list-model";
import { listProblems } from "./workflow-problems";
import { createWorkflowStrings } from "./workflow-strings";

// With a translator that answers with the key it was asked for, any English a
// pure module wrote itself would show up as text that is not a catalog key.
const items = createItemsStrings(stubTranslator);
const canvas = createWorkflowCanvasStrings(stubTranslator);
const workflow = createWorkflowStrings(stubTranslator);

describe("pure modules take their words from the strings they are given", () => {
  it("label item states and reasons", () => {
    expect(statusLabel("failed", items)).toBe("items.status.failed");
    expect(statusLabel("a_new_status", items)).toBe("a_new_status");
    expect(needsYouText(["handed_off", "attempts_exhausted"], items)).toBe(
      "items.needsYouReason.handed_off" +
        "items.listSeparator" +
        "items.needsYouReason.attempts_exhausted",
    );
    expect(sourceLabel("github_issue", items)).toBe(
      "items.source.github_issue",
    );
    expect(sourceLabel("my_crm", items)).toBe("My crm");
  });

  it("describe a run's counts and status", () => {
    expect(describeRunCounts({}, items)).toBe("activity.runCounts.nothing");
    expect(
      describeRunCounts({ taken: 2, done: 1, itemFailures: 1 }, items),
    ).toBe(
      'activity.runCounts.summary {"head":"activity.runCounts.taken {\\"count\\":2}","parts":"activity.runCounts.done {\\"count\\":1}items.listSeparatoractivity.runCounts.itemFailures {\\"count\\":1}"}',
    );
    expect(runStatusView("failed", items)).toEqual({
      label: "activity.runStatus.failed",
      tone: "attention",
    });
    expect(actorLabel({ kind: "agent", email: null }, items)).toBe(
      "activity.actor.agent",
    );
  });

  it("name the bar a screen reader gets", () => {
    const segments = statusSegments({
      running: 0,
      succeeded: 2,
      failed: 1,
      skipped: 0,
      needs_check: 0,
    });
    expect(segmentsLabel(segments, items)).toBe(
      "2 audit.stepStatus.succeededitems.listSeparator1 audit.stepStatus.failed",
    );
  });

  it("format a day heading and a duration", () => {
    const now = new Date(2026, 9, 18, 12).getTime();
    expect(
      formatDayLabel(
        new Date(2026, 9, 18, 9).toISOString(),
        now,
        items,
        "en-US",
      ),
    ).toBe("items.time.today");
    expect(formatDuration(820, items)).toBe('items.duration.ms {"value":820}');
  });

  it("word a schedule and a step", () => {
    expect(scheduleLabel({ kind: "hourly" }, canvas, workflow)).toBe(
      "workflowCanvas.summary.everyHour",
    );
    expect(scheduleLabel({ kind: "hours", hours: 1 }, canvas, workflow)).toBe(
      "workflows.list.everyHour",
    );
    const graph = minimalWorkflowGraph();
    expect(describeNode(graph.nodes[0]!, OPERATION_CATALOG, canvas)).toMatch(
      /^workflowCanvas\.summary\./,
    );
  });

  it("label the palette", () => {
    const [starts, next] = buildPalette(
      OPERATION_CATALOG,
      { hasTrigger: false },
      canvas,
    );
    expect(starts.heading).toBe("workflowCanvas.palette.startsGroup");
    expect(next.heading).toBe("workflowCanvas.palette.nextGroup");
    expect(starts.entries[0]!.category).toBe("workflowCanvas.kind.trigger");
  });

  it("word each problem and the connection it is on", () => {
    const graph = minimalWorkflowGraph();
    const edge = graph.edges[0]!;
    const [row] = listProblems({
      graph,
      issues: [{ code: "edge_unknown_node", edgeId: edge.id }],
      serverIssues: [],
      strings: { canvas, workflow },
    });
    expect(row!.sentence).toBe("workflowCanvas.issue.edge_unknown_node");
    expect(row!.where).toMatch(/^workflowCanvas\.issue\.edge /);
  });
});
