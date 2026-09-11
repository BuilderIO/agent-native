import { describe, expect, it } from "vitest";

import { recordingsRefetchInterval } from "./use-library";

describe("recordingsRefetchInterval", () => {
  it("does not poll completed recordings while waiting for an AI title", () => {
    expect(
      recordingsRefetchInterval([
        {
          id: "rec_ready",
          title: "Untitled recording",
          titleSource: "default",
          status: "ready",
          transcriptStatus: "ready",
          transcriptHasText: true,
        } as any,
      ]),
    ).toBe(false);
  });

  it("keeps the bounded processing poll for active uploads", () => {
    expect(
      recordingsRefetchInterval([
        {
          id: "rec_uploading",
          title: "Untitled recording",
          status: "uploading",
        } as any,
      ]),
    ).toBe(3000);
  });
});
