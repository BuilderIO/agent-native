import { describe, expect, it } from "vitest";

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
