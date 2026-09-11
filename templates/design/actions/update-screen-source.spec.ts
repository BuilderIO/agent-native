import { describe, expect, it } from "vitest";

import { screenSourceMetadataForStatic } from "./update-screen-source.js";

describe("update-screen-source metadata", () => {
  it("clears URL transport fields without dropping unrelated screen metadata", () => {
    expect(
      screenSourceMetadataForStatic({
        sourceType: "localhost",
        previewState: "live",
        url: "http://127.0.0.1:5173/plans",
        previewUrl: "http://127.0.0.1:5173/plans",
        path: "/plans",
        connectionId: "conn_1",
        bridgeUrl: "http://127.0.0.1:7331",
        previewToken: "example-preview-token",
        stateRef: "onboarding-step-2",
      }),
    ).toEqual({
      sourceType: "inline",
      previewState: "static",
      stateRef: "onboarding-step-2",
    });
  });
});
