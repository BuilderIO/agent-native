import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../src-tauri/src/native_screen.rs", import.meta.url),
  "utf8",
);

describe("native recording policy wiring", () => {
  it("captures the live upload choice in the session restart snapshot", () => {
    const start = source.slice(
      source.indexOf("fn start_screencapturekit_recording("),
      source.indexOf("fn start_screencapture_recording("),
    );

    expect(start).toMatch(
      /RestartInfo\s*\{\s*safe_id:[^\n]+\n\s*live_upload_enabled: recording_flags\.custom_sck_pipeline_live_upload_enabled,/,
    );
  });

  it("passes the original choice into each hard-resume backend", () => {
    const resume = source.slice(
      source.indexOf("pub async fn native_fullscreen_recording_resume("),
      source.indexOf(
        "pub async fn native_fullscreen_recording_rotate_segment(",
      ),
    );
    const backend = source.slice(
      source.indexOf("fn start_segment_backend("),
      source.indexOf("const SHAREABLE_CONTENT_PREFETCH_TTL:"),
    );

    expect(resume).toMatch(
      /start_segment_backend\(\s*&app,\s*session\.custom_pipeline,\s*restart\.live_upload_enabled,/,
    );
    expect(backend).toMatch(/true,\s*live_upload_enabled,\s*None,/);
    expect(resume).not.toContain("remote_flags::current()");
    expect(backend).not.toContain("remote_flags::current()");
  });
});
