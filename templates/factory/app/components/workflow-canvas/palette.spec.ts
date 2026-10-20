import { describe, expect, it } from "vitest";

import { createEnglishTranslator } from "@/lib/__tests__/en-translator";
import { NODE_KINDS } from "@/lib/workflow-editor";

import { OPERATION_CATALOG } from "../../../server/workflow/catalog/index.js";
import { buildPalette } from "./palette";
import { createWorkflowCanvasStrings } from "./strings";

const strings = createWorkflowCanvasStrings(createEnglishTranslator());

describe("buildPalette", () => {
  const [starts, next] = buildPalette(
    OPERATION_CATALOG,
    { hasTrigger: false },
    strings,
  );

  it("asks what starts the workflow, then what happens next", () => {
    expect(starts.heading).toBe("What starts this?");
    expect(next.heading).toBe("What happens next?");
  });

  it("offers every kind of step", () => {
    const kinds = new Set(
      [...starts.entries, ...next.entries].map((entry) => entry.kind),
    );
    expect([...kinds].sort()).toEqual([...NODE_KINDS].sort());
  });

  it("gives every entry its own id", () => {
    const ids = [...starts.entries, ...next.entries].map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("lists catalog operations by the kind of step they can run as", () => {
    const sources = starts.entries.filter(
      (entry) => entry.options.operationId !== undefined,
    );
    expect(sources.map((entry) => entry.options.operationId)).toContain(
      "hubspot.newLeads",
    );
    expect(
      sources.find(
        (entry) => entry.options.operationId === "github.listCommits",
      )?.options.variant,
    ).toBe("window");
    const actions = next.entries.filter((entry) => entry.kind === "action");
    expect(actions.map((entry) => entry.options.operationId)).toContain(
      "slack.postMessage",
    );
    expect(
      actions.every(
        (entry) =>
          OPERATION_CATALOG.get(entry.options.operationId ?? "")?.effect ===
          "write",
      ),
    ).toBe(true);
    expect(
      next.entries
        .filter((entry) => entry.kind === "agent")
        .map((entry) => entry.options.operationId)
        .sort(),
    ).toEqual(["builder.check", "builder.followUp", "builder.start"]);
  });

  it("turns the trigger off and lists what happens next first once the workflow has one", () => {
    const sections = buildPalette(
      OPERATION_CATALOG,
      { hasTrigger: true },
      strings,
    );
    expect(sections.map((section) => section.id)).toEqual(["next", "starts"]);
    const withTrigger = sections.find((section) => section.id === "starts");
    expect(
      withTrigger?.entries.find((entry) => entry.kind === "trigger")?.disabled,
    ).toBe(true);
    expect(
      starts.entries.find((entry) => entry.kind === "trigger")?.disabled,
    ).toBeFalsy();
  });

  it("follows the catalog it is given", () => {
    const [onlyStarts, onlyNext] = buildPalette(
      { get: () => undefined, list: () => [] },
      { hasTrigger: false },
      strings,
    );
    expect(
      [...onlyStarts.entries, ...onlyNext.entries].some(
        (entry) => entry.options.operationId !== undefined,
      ),
    ).toBe(false);
  });
});
