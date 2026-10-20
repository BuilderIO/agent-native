import { describe, expect, it } from "vitest";

import { WORKFLOW_CATALOG } from "@/components/workflow/workflow-catalog";

import { offeredModes } from "./binding-modes";

const field = (name: string) => {
  const found = WORKFLOW_CATALOG.get("slack.postMessage")?.fields.find(
    (candidate) => candidate.name === name,
  );
  if (!found) throw new Error(`slack.postMessage has no field ${name}`);
  return found;
};

describe("the ways a field can be filled", () => {
  it("leaves out the AI option for a field that decides where the message lands", () => {
    expect(field("to").target).toBe(true);
    expect(offeredModes(field("to"), undefined)).toEqual(["fixed", "path"]);
  });

  it("offers it for the text of the message", () => {
    expect(offeredModes(field("text"), undefined)).toEqual([
      "fixed",
      "path",
      "ai",
    ]);
  });

  it("keeps it when the field already holds an AI binding, so the control still shows the state the save will refuse", () => {
    expect(
      offeredModes(field("to"), { mode: "ai", instruction: "the channel" }),
    ).toContain("ai");
  });

  it("offers it for a target field the catalog marks as reviewed", () => {
    expect(
      offeredModes(
        { name: "to", type: "string", target: true, modelMayWrite: true },
        undefined,
      ),
    ).toContain("ai");
  });
});
