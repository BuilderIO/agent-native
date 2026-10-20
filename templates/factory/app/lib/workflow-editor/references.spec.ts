import { describe, expect, it } from "vitest";

import { STORY_GRAPHS } from "../../../server/workflow/story-graphs.fixture.js";
import {
  checkPathText,
  checkTemplateText,
  expressionContext,
  findNodeReferences,
} from "./references.js";

const graph = STORY_GRAPHS["bug-report-to-builder"];

describe("expressionContext", () => {
  it("lists the nodes upstream of a node over forward edges only", () => {
    const { upstreamKeys, scopeKeys } = expressionContext(graph, "route");
    expect([...upstreamKeys].sort()).toEqual(
      ["assess", "every5", "feedback", "thread"].sort(),
    );
    expect(scopeKeys.has("startBuilder")).toBe(true);
    expect(upstreamKeys.has("route")).toBe(false);
  });

  it("does not let a loop's back-edge make a later node readable by an earlier one", () => {
    const { upstreamKeys } = expressionContext(graph, "thread");
    expect(upstreamKeys.has("waitReply")).toBe(false);
  });
});

describe("checkPathText", () => {
  const context = expressionContext(graph, "route");

  it("accepts a path to an upstream node", () => {
    expect(checkPathText("nodes.assess.risk", context)).toBeNull();
    expect(checkPathText("item.thread.channelId", context)).toBeNull();
    expect(checkPathText("settings.extras.digestChannel")).toBeNull();
  });

  it("names the syntax problem and where it is", () => {
    expect(checkPathText("item.", context)).toMatchObject({
      code: "unexpected_token",
    });
    expect(checkPathText("who.knows", context)).toMatchObject({
      code: "unknown_root",
    });
    expect(checkPathText("item.__proto__", context)).toMatchObject({
      code: "forbidden_segment",
    });
    expect(checkPathText("", context)).toMatchObject({
      code: "empty_expression",
    });
  });

  it("tells a missing node from one that is not upstream", () => {
    expect(checkPathText("nodes.ghost.x", context)).toEqual({
      code: "unknown_node",
      name: "ghost",
    });
    expect(checkPathText("nodes.startBuilder.accepted", context)).toEqual({
      code: "not_upstream",
      name: "startBuilder",
    });
    expect(checkPathText("nodes", context)).toEqual({ code: "no_node_name" });
  });
});

describe("checkTemplateText", () => {
  const context = expressionContext(graph, "notifyOwner");

  it("accepts plain text and clean holes", () => {
    expect(checkTemplateText("Needs a person", context)).toBeNull();
    expect(
      checkTemplateText(
        "{{ item.title }} ({{ nodes.assess.reason }})",
        context,
      ),
    ).toBeNull();
  });

  it("reports the first bad hole", () => {
    expect(checkTemplateText("a {{ item.title", context)).toMatchObject({
      code: "unclosed_hole",
    });
    expect(
      checkTemplateText("{{ item.title }} {{ nodes.nope.x }}", context),
    ).toEqual({ code: "unknown_node", name: "nope" });
  });
});

describe("findNodeReferences", () => {
  it("finds paths, templates and rules that read a node by name", () => {
    const refs = findNodeReferences(graph, "assess");
    expect(refs.some((ref) => ref.nodeId === "route")).toBe(true);
    expect(refs.some((ref) => ref.nodeId === "notifyOwner")).toBe(true);
    expect(refs.some((ref) => ref.nodeId === "dismissed")).toBe(true);
  });

  it("finds nothing for a node nothing reads, or an unknown one", () => {
    expect(findNodeReferences(graph, "every5")).toEqual([]);
    expect(findNodeReferences(graph, "nope")).toEqual([]);
  });
});
