import { describe, expect, it } from "vitest";

import { buildClipIntakeUrl, parseClipIntakeParams } from "./clip-intake";

describe("clip intake URL helpers", () => {
  it("accepts a bounded intake id and token pair", () => {
    const params = new URLSearchParams({
      clip_intake_id: "intake_1234567890123456",
      clip_intake: "signed-token",
    });

    expect(parseClipIntakeParams(params)).toEqual({
      intakeId: "intake_1234567890123456",
      token: "signed-token",
    });
  });

  it("rejects malformed or multiline bearer parameters", () => {
    expect(
      parseClipIntakeParams(
        new URLSearchParams({
          clip_intake_id: "too-short",
          clip_intake: "signed-token",
        }),
      ),
    ).toBeNull();
    expect(
      parseClipIntakeParams(
        new URLSearchParams({
          clip_intake_id: "intake_1234567890123456",
          clip_intake: "signed\ntoken",
        }),
      ),
    ).toBeNull();
  });

  it("builds an operation URL without losing the capability", () => {
    const url = new URL(
      buildClipIntakeUrl("/api/clip-intake", {
        recordingId: "recording-1",
        operation: "chunk",
        intakeId: "intake_1234567890123456",
        token: "signed token",
      }),
      "https://clips.example.com",
    );

    expect(url.pathname).toBe("/api/clip-intake");
    expect(url.searchParams.get("recordingId")).toBe("recording-1");
    expect(url.searchParams.get("operation")).toBe("chunk");
    expect(url.searchParams.get("clip_intake_id")).toBe(
      "intake_1234567890123456",
    );
    expect(url.searchParams.get("clip_intake")).toBe("signed token");
  });
});
