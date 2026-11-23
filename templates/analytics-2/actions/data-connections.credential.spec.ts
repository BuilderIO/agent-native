import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  captured: null as {
    validateCredentials: (input: {
      config: Record<string, unknown>;
      secretValues: { key: string; secret: string }[];
      signal: AbortSignal;
    }) => Promise<void>;
  } | null,
  validatorCalls: 0,
}));
vi.mock("../server/model/bigquery-credential-validation.js", () => ({
  createBigQueryCredentialValidator: () => async () => {
    state.validatorCalls += 1;
    throw new Error("The BigQuery credential was rejected.");
  },
}));
vi.mock("@agent-native/core/workspace-connections", () => ({
  createWorkspaceCredentialActions: (config: typeof state.captured) => {
    state.captured = config;
    return {} as never;
  },
}));

import { createWorkspaceWarehouseActions } from "../server/model/workspace-warehouse-connection";

describe("warehouse credential validation", () => {
  it("surfaces a rejected credential and does not proceed to a write", async () => {
    createWorkspaceWarehouseActions();
    const captured = state.captured;
    if (!captured) throw new Error("Validator was not registered");

    await expect(
      captured.validateCredentials({
        config: { projectId: "qa-project" },
        secretValues: [
          { key: "BIGQUERY_PROJECT_ID", secret: "qa-project" },
          { key: "GOOGLE_APPLICATION_CREDENTIALS_JSON", secret: "fixture" },
        ],
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("The BigQuery credential was rejected.");
    expect(state.validatorCalls).toBe(1);
  });
});

it.each([42, null, "x".repeat(4001)])(
  "refuses invalid dataset configuration before provider access: case %#",
  async (datasetNames) => {
    createWorkspaceWarehouseActions();
    const captured = state.captured;
    if (!captured) throw new Error("Validator was not registered");
    const before = state.validatorCalls;
    await expect(
      captured.validateCredentials({
        config: { projectId: "qa-project", datasetNames },
        secretValues: [{ key: "BIGQUERY_PROJECT_ID", secret: "qa-project" }],
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow();
    expect(state.validatorCalls).toBe(before);
  },
);
