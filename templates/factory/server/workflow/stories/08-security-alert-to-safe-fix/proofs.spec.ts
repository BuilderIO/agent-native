import { describe, expect, it } from "vitest";

import { OPERATION_CATALOG } from "../../catalog/index.js";
import type { WorkflowGraph } from "../../contract.js";
import { validateWorkflowGraph } from "../../graph-validation.js";
import {
  callsTo,
  effectsOf,
  endedWith,
  scenarioRun,
  tickAt,
} from "../proof-kit.js";
import { STORIES } from "../registry.js";

const STORY = "security-alert-to-safe-fix";
const MIXED = "each-alert-lands-where-the-story-says";
const { graph } = STORIES[STORY];
const READ_TOOLS = ["github.readFile", "github.searchCode"];
// Alerts of high or critical severity in the story's fixtures.
const HIGH_OR_CRITICAL = ["alert-102", "alert-103"];

const SCENARIOS = Object.keys(STORIES[STORY].script.scenarios);

describe("story 8 proofs: security alert to safe fix", () => {
  it("routes each alert where the story says", async () => {
    const { summary } = await scenarioRun(STORY, MIXED);

    expect(summary.statuses).toEqual({
      "alert-101": "automation_started",
      "alert-102": "needs_manual",
      "alert-103": "needs_manual",
      "alert-104": "dismissed",
      "alert-105": "needs_manual",
      "alert-106": "needs_manual",
    });
    expect(endedWith(summary, "done")).toEqual(["alert-101"]);
    expect(endedWith(summary, "dismissed")).toEqual(["alert-104"]);
    // Everything a person decides is told to the security owner by Slack and by email.
    const told = (operation: string) =>
      effectsOf(summary, operation)
        .map((effect) => [effect.item, effect.fields.to])
        .sort();
    const people = ["alert-102", "alert-103", "alert-105", "alert-106"].map(
      (alert) => [alert, "security-owner@example.test"],
    );
    expect(told("slack.postMessage")).toEqual(people);
    expect(told("email.send")).toEqual(people);
  });

  it("dismisses an alert with the model's reason", async () => {
    const { run } = await scenarioRun(STORY, MIXED);

    const ended = run.events["alert-104"].find(
      (event) => event.kind === "ended",
    );
    expect(ended?.outcome).toBe("dismissed");
    expect(ended?.summary).toContain(
      "minimist is only a transitive dependency",
    );
  });

  describe("a high or critical alert is never dismissed", () => {
    it("because the route that dismisses requires low or medium severity and high confidence", () => {
      const route = graph.nodes.find((node) => node.id === "route");
      const unreachable =
        route?.kind === "switch"
          ? route.settings.routes.find((entry) => entry.id === "unreachable")
          : undefined;
      expect(unreachable?.rules).toEqual(
        expect.arrayContaining([
          {
            left: "nodes.assess.severity",
            op: "inList",
            right: ["low", "medium"],
          },
          { left: "nodes.assess.confidence", op: "equals", right: "high" },
        ]),
      );
    });

    it.each(SCENARIOS)("in the scenario %s", async (name) => {
      const { summary } = await scenarioRun(STORY, name);

      const dismissed = endedWith(summary, "dismissed");
      for (const alert of HIGH_OR_CRITICAL) {
        expect(dismissed).not.toContain(alert);
      }
      for (const alert of HIGH_OR_CRITICAL) {
        expect(summary.statuses[alert] ?? "").not.toBe("dismissed");
      }
    });

    it("and an alert the model could not decide is not dismissed either", async () => {
      const { summary } = await scenarioRun(
        STORY,
        "an-ai-turn-that-fails-never-dismisses-the-alert",
      );

      expect(tickAt(summary, 0).nodes.assess.status).toBe("failed");
      expect(summary.statuses).toEqual({});
      expect(effectsOf(summary)).toEqual([]);
    });
  });

  describe("the model has no write tools", () => {
    it("is offered exactly the two read-only repository operations, in every scenario", async () => {
      for (const name of SCENARIOS) {
        const { run } = await scenarioRun(STORY, name);
        for (const tick of run.ticks) {
          for (const request of tick.aiRequests) {
            // Only the assess node is given tools; the Builder prompt is written with none.
            expect(request.tools, name).toEqual(
              request.resultSchemaFields.severity ? READ_TOOLS : [],
            );
          }
        }
      }
    });

    it("because both are read operations in the catalog", () => {
      for (const id of READ_TOOLS) {
        expect(OPERATION_CATALOG.get(id)?.effect, id).toBe("read");
      }
    });

    it("and the graph cannot be saved with a write operation as a tool", () => {
      const withWriteTool: WorkflowGraph = {
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.kind === "ai" && node.id === "assess"
            ? {
                ...node,
                settings: { ...node.settings, tools: ["slack.postMessage"] },
              }
            : node,
        ),
      };

      const checked = validateWorkflowGraph(withWriteTool, OPERATION_CATALOG);
      expect(checked.ok).toBe(false);
      expect(checked.issues.map((issue) => issue.code)).toContain(
        "unknown_tool",
      );
    });
  });

  it("changes nothing in the repository: the only writes in the graph are Builder, Slack and email", () => {
    const writes = graph.nodes.flatMap((node) =>
      node.kind === "action" || node.kind === "agent"
        ? [
            node.kind === "agent"
              ? `${node.settings.agent}.${node.settings.op}`
              : node.settings.operation,
          ]
        : [],
    );
    for (const id of writes) {
      expect(OPERATION_CATALOG.get(id)?.effect).toBe("write");
    }
    expect([...new Set(writes)].sort()).toEqual([
      "builder.start",
      "email.send",
      "slack.postMessage",
    ]);
  });

  describe("a safe fix", () => {
    it("starts Builder on a deterministic branch with the gate fields bound from the assessment", async () => {
      const { summary } = await scenarioRun(STORY, MIXED);

      const [start] = effectsOf(summary, "builder.start");
      expect(start).toMatchObject({
        node: "builder",
        item: "alert-101",
        fields: {
          projectId: "project-1",
          branchName: "factory-alert-101",
          clearBug: true,
          productUxImplications: false,
          risk: "low",
          confidence: "high",
          // A dependency alert is not a chat message, so no person has claimed it.
          alreadyClaimed: false,
          categories: [],
        },
        receipt: {
          status: "done",
          externalRef: "factory-alert-101",
        },
      });
      expect(summary.statuses["alert-101"]).toBe("automation_started");
      // Story 2 follows the project this graph names.
      expect(graph.settings.builderProjectId).toBe("project-1");
    });

    it("is never started for an alert that touches a sensitive area", async () => {
      const { summary } = await scenarioRun(
        STORY,
        "a-fix-that-touches-a-sensitive-area-goes-to-a-person",
      );

      expect(callsTo(summary, "builder.start")).toBe(0);
      expect(summary.statuses).toEqual({ "alert-107": "needs_manual" });
    });

    it("is started once, even when the start timed out and the alert is listed again", async () => {
      const { summary, run } = await scenarioRun(
        STORY,
        "a-start-that-timed-out-is-never-sent-twice",
      );

      expect(callsTo(summary, "builder.start")).toBe(1);
      expect(tickAt(summary, 0).nodes.builder).toMatchObject({
        status: "needs_check",
        error: "effect_needs_check",
      });
      expect(summary.statuses).toEqual({ "alert-101": "needs_manual" });
      // The handled alert is offered again and left alone.
      const source = run.ticks[1].steps.find(
        (step) => step.nodeId === "alerts",
      );
      expect(source?.fields).toMatchObject({ taken: 0, alreadyHandled: 1 });
    });

    it("is not started twice for an alert that GitHub lists again after the hand-off", async () => {
      const { summary } = await scenarioRun(
        STORY,
        "an-alert-handed-to-builder-is-listed-again-and-builder-is-not-started-twice",
      );

      expect(callsTo(summary, "builder.start")).toBe(1);
      expect(summary.statuses["alert-101"]).toBe("automation_started");
    });

    it("is handed to a person at once when the dispatch gate refuses, and is not tried again", async () => {
      const { summary } = await scenarioRun(
        STORY,
        "a-refused-start-hands-the-alert-to-a-person-at-once",
      );

      // A refusal had no effect and the same start would be refused again, so the first refusal is final; no message is sent about it.
      expect(callsTo(summary, "builder.start")).toBe(1);
      expect(tickAt(summary, 0).nodes.builder.error).toBe(
        "operation_not_allowed",
      );
      expect(tickAt(summary, 1).nodes.builder).toBeUndefined();
      expect(tickAt(summary, 2).nodes.builder).toBeUndefined();
      expect(summary.statuses).toEqual({ "alert-101": "needs_manual" });
      expect(callsTo(summary, "slack.postMessage")).toBe(0);
    });
  });

  it("fails the run loudly when the token cannot read alerts, instead of reading it as no alerts", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "a-token-that-cannot-read-alerts-fails-the-run-loudly",
    );

    expect(tickAt(summary, 0).run).toMatchObject({
      status: "failed",
      error: "credential_missing",
    });
    expect(tickAt(summary, 0).ai).toEqual([]);
    expect(summary.statuses).toEqual({});
  });

  it("hands nothing to Builder and tells no one from a dry run", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "a-dry-run-hands-nothing-to-builder-and-tells-no-one",
    );

    expect(effectsOf(summary)).toEqual([]);
    expect(summary.statuses).toEqual({});
  });

  // The gate itself (clear bug, low risk, high confidence, no product question, no never-automate
  // category, no duplicate) runs inside `builder.start`, before Builder is called. It is enforced
  // and tested in server/workflow-host/builder-operations.spec.ts and builder-start-gate.spec.ts;
  // the scenarios here assert the engine's side: what the graph binds, and what a refusal does.

  it.todo(
    "an alert handed to Builder is not assessed again every hour: `automation_started` is not in the handled statuses, so GitHub's still-open alert is taken, assessed (a model call) and ended again on every run, and a model that changed its mind would move it to `needs_manual`. Fix: treat `automation_started` as handled for a provider-query Source's re-offers",
  );
});
