import { describe, expect, it } from "vitest";

import type { ActionMcpOutputContract } from "../action-output-contract.js";
import { isActionOutputContractError } from "../action.js";
import { mcpResponseOutputCheck } from "./output-contract.js";

function contract(response: Record<string, unknown>): ActionMcpOutputContract {
  return { semantic: { type: "object" }, response };
}

const failure = { actionName: "save-link", effect: "committed" as const };

describe("mcpResponseOutputCheck", () => {
  it("returns the JSON form the client receives when it meets the contract", () => {
    const check = mcpResponseOutputCheck(
      contract({
        type: "object",
        properties: { at: { type: "string", format: "date-time" } },
        required: ["at"],
      }),
    );
    expect(
      check(() => ({ at: new Date("2026-10-06T12:00:00.000Z") }), failure),
    ).toEqual({ at: "2026-10-06T12:00:00.000Z" });
  });

  it("validates advertised formats", () => {
    const check = mcpResponseOutputCheck(
      contract({
        type: "object",
        properties: { link: { type: "string", format: "uri" } },
      }),
    );
    let error: unknown;
    try {
      check(() => ({ link: "[hidden embed URL]" }), failure);
    } catch (caught) {
      error = caught;
    }
    expect(isActionOutputContractError(error)).toBe(true);
    expect(error).toMatchObject({
      effect: "committed",
      contract: "mcp",
      issues: ["link: format"],
    });
  });

  it.each([
    [
      "an unsupported format",
      {
        type: "object",
        properties: { id: { type: "string", format: "made-up" } },
      },
    ],
    ["an unknown keyword", { type: "object", madeUp: true }],
    ["an async schema", { $async: true, type: "object" }],
  ])("refuses %s before the action runs", (_label, response) => {
    expect(() => mcpResponseOutputCheck(contract(response))).toThrow();
  });

  it.each([
    [
      "a transform that throws",
      () => {
        throw new Error("helen@example.com broke it");
      },
      "(root): transform_failed",
    ],
    [
      "a value JSON cannot carry",
      () => ({ total: 10n }),
      "(root): not_serializable",
    ],
  ])("types %s as an output-contract failure", (_label, build, issue) => {
    const check = mcpResponseOutputCheck(contract({ type: "object" }));
    let error: unknown;
    try {
      check(build as () => Record<string, unknown>, failure);
    } catch (caught) {
      error = caught;
    }
    expect(isActionOutputContractError(error)).toBe(true);
    expect(error).toMatchObject({ effect: "committed", issues: [issue] });
    expect((error as Error).message).not.toContain("helen@example.com");
  });
});
