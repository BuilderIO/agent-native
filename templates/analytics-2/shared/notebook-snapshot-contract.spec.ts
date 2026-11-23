import { describe, expect, expectTypeOf, it } from "vitest";

import {
  authorizedNotebookSnapshotRefSchema,
  notebookCellIdSchema,
  notebookCommandImpactSchema,
  notebookProjectIdSchema,
  notebookSnapshotResultSchema,
  revisionSchema,
  type AuthorizedNotebookSnapshotRef,
  type NotebookCommandImpact,
  type NotebookSnapshotResult,
} from "./notebook-snapshot-contract.js";

export const authorizedNotebookSnapshotFixture: AuthorizedNotebookSnapshotRef =
  authorizedNotebookSnapshotRefSchema.parse({
    workspaceId: "workspace-sample",
    projectId: "project-sample",
    head: { versionId: "draft-sample", revision: "9007199254740993" },
    eventSeq: "9007199254740995",
  });

export const notebookCommandImpactFixture: NotebookCommandImpact =
  notebookCommandImpactSchema.parse({
    opId: "op-edit-sample",
    previousHead: {
      versionId: authorizedNotebookSnapshotFixture.head.versionId,
      revision: "9007199254740992",
    },
    snapshot: authorizedNotebookSnapshotFixture,
    changedCellIds: ["cell-orders", "cell-summary"],
    invalidatedOutputs: [
      { cellId: "cell-orders", outputGeneration: "fence-edit" },
    ],
  });

export const notebookSnapshotResultFixtures = [
  { status: "accepted", snapshot: authorizedNotebookSnapshotFixture },
  { status: "absent", reason: "not_found" },
  { status: "unreadable", reason: "read_failed" },
  { status: "denied", reason: "access_denied" },
] satisfies NotebookSnapshotResult[];

describe("notebook snapshot contract", () => {
  it("preserves exact accepted revisions and their invalidated output fences over JSON", () => {
    const impact = notebookCommandImpactFixture;
    expect(
      notebookCommandImpactSchema.parse(JSON.parse(JSON.stringify(impact))),
    ).toStrictEqual(impact);
    expect(impact.snapshot.head.revision).toBe("9007199254740993");
  });

  it.each(notebookSnapshotResultFixtures)(
    "round-trips the $status snapshot outcome",
    (outcome) => {
      expect(
        notebookSnapshotResultSchema.parse(JSON.parse(JSON.stringify(outcome))),
      ).toStrictEqual(outcome);
    },
  );

  it.each(["-1", "1.0", "01", "1e3", " 1", "1\n", 1, 1n])(
    "rejects the noncanonical wire revision %s",
    (revision) => {
      expect(revisionSchema.safeParse(revision).success).toBe(false);
    },
  );

  it("requires an output generation and keeps snapshot failures and IDs distinct", () => {
    expect(
      notebookCommandImpactSchema.safeParse({
        ...notebookCommandImpactFixture,
        invalidatedOutputs: [{ cellId: "cell-orders" }],
      }).success,
    ).toBe(false);
    expect(
      notebookSnapshotResultSchema.safeParse({
        status: "denied",
        reason: "read_failed",
      }).success,
    ).toBe(false);
    expect(
      notebookSnapshotResultSchema.safeParse({
        status: "absent",
        reason: "unknown",
      }).success,
    ).toBe(false);
    expectTypeOf<ReturnType<typeof notebookCellIdSchema.parse>>().not.toExtend<
      ReturnType<typeof notebookProjectIdSchema.parse>
    >();
  });
});
