import { describe, expect, it } from "vitest";

import {
  defaultStepTitle,
  parseStepCaptureSession,
  type StepCaptureStep,
} from "./step-capture";

function step(overrides: Partial<StepCaptureStep> = {}): StepCaptureStep {
  return {
    step: 1,
    capturedAt: "2026-10-16T09:00:00.000Z",
    clickType: "left",
    location: { x: 120, y: 48 },
    display: {
      id: 1,
      frame: { x: 0, y: 0, width: 1512, height: 982 },
      scale: 2,
    },
    image: {
      status: "captured",
      fileName: "step-001.png",
      width: 3024,
      height: 1964,
    },
    window: {
      status: "found",
      id: 42,
      frame: { x: 0, y: 25, width: 900, height: 700 },
      ownerName: "Finder",
      ownerPid: 501,
    },
    target: { status: "labeled", role: "AXButton", label: "Save" },
    ...overrides,
  };
}

function session(steps: unknown[]) {
  return {
    schemaVersion: 1,
    sessionId: "s1",
    startedAt: "2026-10-16T09:00:00.000Z",
    endedAt: null,
    steps,
  };
}

describe("step capture manifest", () => {
  it("accepts a manifest the tray writes", () => {
    const result = parseStepCaptureSession(
      session([step(), step({ step: 2, clickType: "right" })]),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown schema version instead of guessing", () => {
    const result = parseStepCaptureSession({ ...session([]), schemaVersion: 2 });
    expect(result).toEqual({ ok: false, error: "unsupported schemaVersion 2" });
  });

  it("requires contiguous step numbers", () => {
    const result = parseStepCaptureSession(session([step({ step: 2 })]));
    expect(result).toEqual({ ok: false, error: "steps[0].step must be 1" });
  });

  it("keeps a missing label distinct from an unreadable one", () => {
    const unlabeled = step({ target: { status: "unlabeled", role: "AXGroup" } });
    const untrusted = step({
      target: { status: "unavailable", reason: "not-trusted" },
    });
    expect(parseStepCaptureSession(session([unlabeled])).ok).toBe(true);
    expect(parseStepCaptureSession(session([untrusted])).ok).toBe(true);
    const bare = { ...step(), target: null };
    expect(parseStepCaptureSession(session([bare]))).toEqual({
      ok: false,
      error: "steps[0].target is invalid",
    });
  });

  it("only allows a drag end point on a drag", () => {
    const result = parseStepCaptureSession(
      session([step({ dragTo: { x: 1, y: 2 } })]),
    );
    expect(result).toEqual({
      ok: false,
      error: "steps[0].dragTo is only valid on a drag",
    });
    expect(
      parseStepCaptureSession(
        session([step({ clickType: "drag", dragTo: { x: 1, y: 2 } })]),
      ).ok,
    ).toBe(true);
  });

  it("records a failed screenshot as a typed failure", () => {
    const failed = step({ image: { status: "failed", error: "denied" } });
    expect(parseStepCaptureSession(session([failed])).ok).toBe(true);
  });
});

describe("default step title", () => {
  it("names the control that was clicked", () => {
    expect(defaultStepTitle(step())).toBe('Click "Save" button');
    expect(
      defaultStepTitle(
        step({
          clickType: "double",
          target: { status: "labeled", role: "AXStaticText", label: "Report.pdf" },
        }),
      ),
    ).toBe('Double-click "Report.pdf"');
  });

  it("never echoes a redacted label", () => {
    expect(
      defaultStepTitle(
        step({ target: { status: "redacted", role: "AXSecureTextField" } }),
      ),
    ).toBe("Click the password field");
    expect(
      defaultStepTitle(
        step({ target: { status: "redacted", role: "AXTextField" } }),
      ),
    ).toBe("Click the field");
  });

  it("falls back to the window owner, then the verb", () => {
    expect(
      defaultStepTitle(
        step({ target: { status: "unavailable", reason: "not-trusted" } }),
      ),
    ).toBe("Click in Finder");
    expect(
      defaultStepTitle(
        step({
          clickType: "right",
          window: { status: "none" },
          target: { status: "unavailable", reason: "no-element" },
        }),
      ),
    ).toBe("Right-click");
  });
});
