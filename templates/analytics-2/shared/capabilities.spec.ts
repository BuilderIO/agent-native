import { describe, expect, expectTypeOf, it } from "vitest";

import {
  capabilityDecisionSchema,
  capabilityDefinitionSchema,
  capabilityScopeRefSchema,
  controlIdSchema,
  type CapabilityDecision,
  type CapabilityDefinition,
  type CapabilityScopeRef,
  type ControlId,
} from "./capabilities.js";
import {
  notebookCellIdSchema,
  notebookProjectIdSchema,
  workspaceIdSchema,
} from "./notebook-snapshot-contract.js";

export const draftSqlCapabilityDefinitionFixture: CapabilityDefinition = {
  controlId: controlIdSchema.parse("run-draft-sql"),
  surfaces: ["notebook"],
  aliases: [controlIdSchema.parse("run-cell")],
  resourceKind: "cell",
  target: { kind: "action", actionName: "run-project-cell" },
  prerequisites: ["resource_permission", "source_permission"],
  postcondition: { kind: "action", actionName: "get-project" },
};

export const draftSqlCapabilityScopeFixture = {
  kind: "cell",
  workspaceId: workspaceIdSchema.parse("workspace-sample"),
  projectId: notebookProjectIdSchema.parse("project-sample"),
  cellId: notebookCellIdSchema.parse("cell-sample"),
} satisfies CapabilityScopeRef;

const decisionScope = {
  controlId: draftSqlCapabilityDefinitionFixture.controlId,
  scope: draftSqlCapabilityScopeFixture,
};

export const capabilityDecisionFixtures = [
  {
    ...decisionScope,
    status: "allowed",
    target: draftSqlCapabilityDefinitionFixture.target,
  },
  { ...decisionScope, status: "absent", reason: "not_found" },
  { ...decisionScope, status: "unavailable", reason: "missing_backing" },
  { ...decisionScope, status: "denied", reason: "source_access_denied" },
  { ...decisionScope, status: "unreadable", reason: "read_failed" },
  { ...decisionScope, status: "pending", reason: "not_ready" },
] satisfies CapabilityDecision[];

describe("Analytics capability contract", () => {
  it("round-trips a control with a registered action and readback", () => {
    expect(
      capabilityDefinitionSchema.parse(
        JSON.parse(JSON.stringify(draftSqlCapabilityDefinitionFixture)),
      ),
    ).toStrictEqual(draftSqlCapabilityDefinitionFixture);
  });

  it.each(capabilityDecisionFixtures)(
    "round-trips the $status decision",
    (decision) => {
      expect(
        capabilityDecisionSchema.parse(JSON.parse(JSON.stringify(decision))),
      ).toStrictEqual(decision);
    },
  );

  it("requires a readback and a correctly shaped resource scope", () => {
    const invalidDefinition = {
      ...draftSqlCapabilityDefinitionFixture,
      postcondition: undefined,
    };
    expect(
      capabilityDefinitionSchema.safeParse(invalidDefinition).success,
    ).toBe(false);
    expect(
      capabilityScopeRefSchema.safeParse({
        ...draftSqlCapabilityScopeFixture,
        cellId: 5,
      }).success,
    ).toBe(false);
    expectTypeOf<ControlId>().not.toExtend<
      typeof draftSqlCapabilityScopeFixture.cellId
    >();
  });

  it("rejects unknown reasons and reasons paired with the wrong status", () => {
    expect(
      capabilityDecisionSchema.safeParse({
        ...decisionScope,
        status: "denied",
        reason: "unknown",
      }).success,
    ).toBe(false);
    expect(
      capabilityDecisionSchema.safeParse({
        ...decisionScope,
        status: "denied",
        reason: "read_failed",
      }).success,
    ).toBe(false);
  });
});
