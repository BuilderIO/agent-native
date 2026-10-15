import { describe, expect, it } from "vitest";

import {
  motionSourceReadCapabilityForSource,
  motionSourceReadAllowsWrites,
  passiveMotionSourceReadCapability,
} from "./motion-source-read.js";

describe("passiveMotionSourceReadCapability", () => {
  it("recognizes the serialized authored-motion parser error", () => {
    expect(
      passiveMotionSourceReadCapability(
        {
          errorCode: "motion_html_source_unsupported_authored_motion",
          message: 'The animation property "animation" is unsupported.',
          statusCode: 422,
        },
        "screen-1",
      ),
    ).toEqual({
      status: "unsupported",
      sourceRef: "screen-1",
      errorCode: "motion_html_source_unsupported_authored_motion",
      reason: 'The animation property "animation" is unsupported.',
    });
  });

  it("does not reinterpret unrelated validation, access, or transport failures", () => {
    expect(
      passiveMotionSourceReadCapability(
        {
          errorCode: "motion_html_source_unsupported_authored_motion",
          message: "Unsupported authored Motion.",
          statusCode: 502,
        },
        "screen-1",
      ),
    ).toBeNull();
    expect(
      passiveMotionSourceReadCapability(
        {
          errorCode: "motion_local_source_module_not_imported",
          message: "The file is not in the selected screen's source graph.",
          statusCode: 422,
        },
        "screen-1",
      ),
    ).toBeNull();
    expect(
      passiveMotionSourceReadCapability(
        new Error("The request failed."),
        "screen-1",
      ),
    ).toBeNull();
  });
});

describe("motionSourceReadAllowsWrites", () => {
  it("allows writes unless passive source parsing explicitly reported unsupported", () => {
    expect(motionSourceReadAllowsWrites(undefined)).toBe(true);
    expect(motionSourceReadAllowsWrites(null)).toBe(true);
    expect(
      motionSourceReadAllowsWrites({
        status: "unsupported",
        sourceRef: "screen-1",
        errorCode: "motion_html_source_unsupported_authored_motion",
        reason: "Unsupported authored Motion.",
      }),
    ).toBe(false);
  });
});

describe("motionSourceReadCapabilityForSource", () => {
  it("ignores a passive unsupported result from the previously active source", () => {
    const stale = {
      status: "unsupported" as const,
      sourceRef: "previous-screen",
      errorCode: "motion_css_source_unreadable",
      reason: "Unsupported authored motion.",
    };

    expect(motionSourceReadCapabilityForSource([stale], "current-screen")).toBe(
      null,
    );
    expect(
      motionSourceReadAllowsWrites(
        motionSourceReadCapabilityForSource([stale], "current-screen"),
      ),
    ).toBe(true);
    expect(
      motionSourceReadCapabilityForSource([stale], "previous-screen"),
    ).toBe(stale);
  });
});
