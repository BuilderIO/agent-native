import { afterEach, describe, expect, it, vi } from "vitest";

const apiBaseUrlState = vi.hoisted(() => ({
  value: undefined as string | undefined,
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  apiBaseUrl: () => apiBaseUrlState.value,
  appServerPath: (path: string) => `${apiBaseUrlState.value ?? ""}${path}`,
}));

import type { CreateSourceResponse } from "./brain";
import {
  BRAIN_INGEST_PATH,
  createOneTimeIngestHandoff,
} from "./ingest-handoff";

const createdSource: CreateSourceResponse = {
  source: {
    id: "source-example",
    title: "Example Clips source",
    provider: "clips",
  },
  ingestToken: "<ONE_TIME_INGEST_TOKEN>",
};

describe("one-time Brain ingest handoff", () => {
  afterEach(() => {
    apiBaseUrlState.value = undefined;
  });

  it("builds a root-scoped endpoint for a push source", () => {
    expect(
      createOneTimeIngestHandoff({
        origin: "https://brain.example.test/workspace",
        provider: "clips",
        result: createdSource,
        sourceKey: "clips-example",
      }),
    ).toEqual({
      endpoint: `https://brain.example.test${BRAIN_INGEST_PATH}`,
      ingestToken: "<ONE_TIME_INGEST_TOKEN>",
      provider: "clips",
      source: createdSource.source,
      sourceKey: "clips-example",
    });
  });

  it("points the endpoint at the configured app server", () => {
    apiBaseUrlState.value = "https://api.brain.example.test";
    expect(
      createOneTimeIngestHandoff({
        origin: "https://brain.example.test",
        provider: "generic",
        result: createdSource,
        sourceKey: "generic-example",
      })?.endpoint,
    ).toBe(`https://api.brain.example.test${BRAIN_INGEST_PATH}`);
  });

  it("keeps the configured server's mount path", () => {
    apiBaseUrlState.value = "https://api.example.test/brain";
    expect(
      createOneTimeIngestHandoff({
        origin: "https://brain.example.test",
        provider: "generic",
        result: createdSource,
        sourceKey: "generic-example",
      })?.endpoint,
    ).toBe(`https://api.example.test/brain${BRAIN_INGEST_PATH}`);
  });

  it("does not create a handoff for polling sources", () => {
    expect(
      createOneTimeIngestHandoff({
        origin: "https://brain.example.test",
        provider: "slack",
        result: createdSource,
        sourceKey: "slack-example",
      }),
    ).toBeNull();
  });

  it("does not create a handoff when the one-time credential is absent", () => {
    expect(
      createOneTimeIngestHandoff({
        origin: "https://brain.example.test",
        provider: "generic",
        result: { source: createdSource.source },
        sourceKey: "generic-example",
      }),
    ).toBeNull();
  });
});
