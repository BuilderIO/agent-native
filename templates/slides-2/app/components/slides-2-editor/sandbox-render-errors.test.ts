import { describe, expect, it } from "vitest";

import { getSandboxRenderErrorKey } from "./sandbox-render-errors";

describe("getSandboxRenderErrorKey", () => {
  it("maps sandbox failures to localized export messages", () => {
    expect(getSandboxRenderErrorKey(new Error("slide-render-timeout"))).toBe(
      "editorExport.exportFailed",
    );
    expect(
      getSandboxRenderErrorKey(new Error("invalid-slide-render-artifact")),
    ).toBe("editorExport.renderFormatUnsupported");
  });

  it("does not expose unknown machine codes as user-facing copy", () => {
    expect(getSandboxRenderErrorKey(new Error("worker-bootstrap-failed"))).toBe(
      "editorExport.exportFailed",
    );
    expect(getSandboxRenderErrorKey(new Error("Network connection lost"))).toBe(
      null,
    );
  });
});
