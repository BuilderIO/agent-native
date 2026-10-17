import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetSuggestionAdaptersForTests,
  getSuggestionAdapter,
  registerSuggestionAdapter,
} from "./registry";

const adapter = (version: number) => ({
  kind: "document",
  version,
  validateProposal: () => undefined,
  apply: () => undefined,
});

describe("suggestion adapter registry", () => {
  beforeEach(__resetSuggestionAdaptersForTests);

  it("allows an identical-version startup registration", () => {
    registerSuggestionAdapter(adapter(1));
    registerSuggestionAdapter(adapter(1));
    expect(getSuggestionAdapter("document")?.version).toBe(1);
  });

  it("rejects conflicting adapter versions", () => {
    registerSuggestionAdapter(adapter(1));
    expect(() => registerSuggestionAdapter(adapter(2))).toThrow(
      "conflicting versions",
    );
  });
});
