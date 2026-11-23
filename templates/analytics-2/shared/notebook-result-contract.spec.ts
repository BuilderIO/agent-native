import { describe, expect, expectTypeOf, it } from "vitest";

import {
  authorizedResultRefSchema,
  completeResultManifestSchema,
  notebookResultReadSchema,
  resultManifestSchema,
  type AuthorizedResultRef,
  type CompleteResultManifest,
  type NotebookResultRead,
  type ResultManifest,
} from "./notebook-result-contract.js";

export const authorizedResultFixture: AuthorizedResultRef =
  authorizedResultRefSchema.parse({
    resultId: "result-orders",
    snapshot: {
      workspaceId: "workspace-sample",
      projectId: "project-sample",
      head: { versionId: "draft-sample", revision: "9007199254740993" },
      eventSeq: "9007199254740995",
    },
    producer: {
      namespaceId: "namespace-sample",
      cellId: "cell-orders",
      exportId: "export-orders",
      runId: "run-sample",
      attemptId: "attempt-sample",
      outputGeneration: "fence-run-sample",
    },
    inputRevision: "5",
    dependencyFingerprint: "sample-inputs",
    kernelGeneration: null,
    sourceGeneration: "3",
  });

export const resultManifestFixture: CompleteResultManifest =
  completeResultManifestSchema.parse({
    result: authorizedResultFixture,
    fields: [
      {
        fieldId: "field-region",
        name: "Region",
        type: "string",
        nullable: false,
      },
    ],
    status: "complete",
    rowCount: "4",
  });

const { result, fields } = resultManifestFixture;
export const notebookResultReadFixtures = [
  resultManifestFixture,
  { status: "complete-empty", result, fields, rowCount: "0" },
  {
    status: "pending",
    reason: "not_ready",
    result,
    fields,
    verifiedRowCount: "0",
  },
  {
    status: "incomplete",
    reason: "sampled",
    result,
    fields,
    verifiedRowCount: "2",
  },
  { status: "absent", reason: "not_found" },
  { status: "unreadable", reason: "read_failed" },
  { status: "denied", reason: "access_denied" },
] satisfies NotebookResultRead[];

describe("notebook result contract", () => {
  it.each(notebookResultReadFixtures)(
    "round-trips the $status result without collapsing coverage or access",
    (outcome) => {
      expect(
        notebookResultReadSchema.parse(JSON.parse(JSON.stringify(outcome))),
      ).toStrictEqual(outcome);
    },
  );

  it("rejects zero rows under complete and positive rows under complete-empty", () => {
    expect(
      resultManifestSchema.safeParse({
        ...resultManifestFixture,
        rowCount: "0",
      }).success,
    ).toBe(false);
    expect(
      resultManifestSchema.safeParse({
        result,
        fields,
        status: "complete-empty",
        rowCount: "4",
      }).success,
    ).toBe(false);
  });

  it("rejects pending or sampled input for a complete-artifact reader", () => {
    const pending: ResultManifest = {
      status: "pending",
      reason: "not_ready",
      result,
      fields,
      verifiedRowCount: "0",
    };
    const sampled: ResultManifest = {
      status: "incomplete",
      reason: "sampled",
      result,
      fields,
      verifiedRowCount: "2",
    };
    expect(completeResultManifestSchema.safeParse(pending).success).toBe(false);
    expect(completeResultManifestSchema.safeParse(sampled).success).toBe(false);
  });

  it("rejects missing provenance and unknown reasons", () => {
    expect(
      authorizedResultRefSchema.safeParse({
        ...result,
        kernelGeneration: undefined,
      }).success,
    ).toBe(false);
    expect(
      notebookResultReadSchema.safeParse({
        status: "unreadable",
        reason: "unknown",
      }).success,
    ).toBe(false);
    expectTypeOf<AuthorizedResultRef["resultId"]>().not.toExtend<
      AuthorizedResultRef["producer"]["attemptId"]
    >();
  });
});
