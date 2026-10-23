import { describe, expect, it } from "vitest";

import { OPERATION_CATALOG } from "./catalog/index.js";
import { NODE_KINDS, workflowGraphSchema } from "./contract.js";
import { validateWorkflowGraph } from "./graph-validation.js";
import { portsWithLimit } from "./ports.js";
import { STORY_GRAPHS, type StoryKey } from "./story-graphs.fixture.js";

const stories = Object.entries(STORY_GRAPHS) as [
  StoryKey,
  (typeof STORY_GRAPHS)[StoryKey],
][];

describe("the ten story graphs", () => {
  it("covers all ten stories", () => {
    expect(stories).toHaveLength(10);
  });

  it.each(stories)("%s validates with no issues", (_key, graph) => {
    expect(validateWorkflowGraph(graph, OPERATION_CATALOG)).toEqual({
      ok: true,
      issues: [],
    });
  });

  it.each(stories)("%s survives a JSON round trip unchanged", (_key, graph) => {
    const reparsed = workflowGraphSchema.parse(
      JSON.parse(JSON.stringify(graph)),
    );
    expect(reparsed).toEqual(graph);
  });

  it.each(stories)("%s ends every path in an End", (_key, graph) => {
    const ends = graph.nodes.filter((node) => node.kind === "end");
    expect(ends.length).toBeGreaterThan(0);
    for (const node of graph.nodes) {
      const ports = portsWithLimit(graph, node);
      expect(ports.length === 0).toBe(node.kind === "end");
    }
  });

  it("uses every one of the twelve node kinds across the stories", () => {
    const used = new Set(
      stories.flatMap(([, graph]) => graph.nodes.map((node) => node.kind)),
    );
    expect([...used].sort()).toEqual([...NODE_KINDS].sort());
  });

  it("exercises the capabilities that only some stories need", () => {
    const nodes = stories.flatMap(([, graph]) => graph.nodes);
    const sources = new Set(
      nodes.flatMap((node) =>
        node.kind === "source" ? [node.settings.source] : [],
      ),
    );
    expect([...sources].sort()).toEqual([
      "inbox-poll",
      "provider-query",
      "status",
      "window",
    ]);
    const waits = new Set(
      nodes.flatMap((node) =>
        node.kind === "wait" ? [node.settings.wait] : [],
      ),
    );
    expect([...waits].sort()).toEqual(["condition", "reply", "time"]);
    const combines = new Set(
      nodes.flatMap((node) =>
        node.kind === "combine" ? [node.settings.mode] : [],
      ),
    );
    expect([...combines].sort()).toEqual(["groupBy", "list", "summarize"]);
    const outcomes = new Set(
      nodes.flatMap((node) =>
        node.kind === "end" ? [node.settings.outcome] : [],
      ),
    );
    expect([...outcomes].sort()).toEqual([
      "dismissed",
      "done",
      "needsManual",
      "released",
    ]);
    expect(
      nodes.some(
        (node) => node.kind === "ai" && node.settings.mode === "wholeList",
      ),
    ).toBe(true);
    expect(
      nodes.some(
        (node) => node.kind === "ai" && node.settings.tools.length > 0,
      ),
    ).toBe(true);
  });

  it("gives the bug-report story exactly one capped loop through a Wait", () => {
    const graph = STORY_GRAPHS["bug-report-to-builder"];
    const back = graph.edges.filter((edge) => edge.back);
    expect(back).toHaveLength(1);
    // One send-back means two questions at most: the first, and one more after the first reply.
    expect(back[0].back?.maxIterations).toBe(1);
    expect(back[0].from.node).toBe("waitReply");
    const wait = graph.nodes.find((node) => node.id === "waitReply");
    expect(wait && portsWithLimit(graph, wait)).toEqual([
      "replied",
      "timedOut",
      "limitReached",
    ]);
  });

  it("reads a merged task's reports as the member views they are, thread and all", () => {
    const graph = STORY_GRAPHS["builder-to-merge"];
    const tell = graph.nodes.find((node) => node.id === "tellReports");

    expect(
      tell?.kind === "action" ? tell.settings.args : undefined,
    ).toMatchObject({
      channel: { mode: "path", path: "item.thread.channelId" },
      threadTs: { mode: "path", path: "item.thread.threadTs" },
    });
  });

  it("holds back the empty list of a quiet cost day, so nothing is sent for it", () => {
    const graph = STORY_GRAPHS["cloud-cost-spike"];
    const edgesOf = (node: string) =>
      graph.edges
        .filter((edge) => edge.from.node === node)
        .map((edge) => `${edge.from.port}->${edge.to.node}`);

    expect(edgesOf("spikes")).toEqual(["out->anySpikes"]);
    expect(edgesOf("anySpikes").sort()).toEqual([
      "match->recent",
      "otherwise->quiet",
    ]);
    const filter = graph.nodes.find((node) => node.id === "anySpikes");
    expect(
      filter?.kind === "filter" ? filter.settings.rules : undefined,
    ).toEqual([{ left: "item.count", op: "gt", right: 0 }]);
  });

  it("names the message each reply Wait watches when the item it parks has no thread of its own", () => {
    for (const key of [
      "hot-lead-routing",
      "incident-to-postmortem",
      "cloud-cost-spike",
    ] as const) {
      const waits = STORY_GRAPHS[key].nodes.filter(
        (node) => node.kind === "wait" && node.settings.wait === "reply",
      );
      expect(waits.length).toBeGreaterThan(0);
      for (const node of waits) {
        expect(
          node.kind === "wait" &&
            node.settings.wait === "reply" &&
            node.settings.watch,
        ).toBeTruthy();
      }
    }
  });
});
