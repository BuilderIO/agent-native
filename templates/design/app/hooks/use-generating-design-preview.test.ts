import { parsePartialJson } from "@agent-native/core/client/generation-stream";
import { describe, expect, it } from "vitest";

import { previewFrameSize } from "./use-generating-design-preview";

const size = (args: Record<string, unknown>, filename?: string) =>
  previewFrameSize(parsePartialJson(JSON.stringify(args)), filename);

describe("previewFrameSize", () => {
  it("defaults to the desktop frame", () => {
    expect(size({ prompt: "A landing page" })).toEqual({
      width: 1440,
      height: 900,
    });
  });

  it("previews a mobile-only request at the mobile frame", () => {
    expect(size({ prompt: "A checkout flow", devices: ["mobile"] })).toEqual({
      width: 390,
      height: 844,
    });
    expect(
      size({ prompt: "A checkout flow", primaryViewport: "mobile" }),
    ).toEqual({ width: 390, height: 844 });
  });

  it("uses the widest requested device", () => {
    expect(
      size({ prompt: "A dashboard", devices: ["mobile", "tablet"] }),
    ).toEqual({ width: 768, height: 1024 });
  });

  it("uses the screen's own canvas frame when the call places it", () => {
    expect(
      size(
        {
          prompt: "A settings page",
          canvasFrames: [
            { filename: "settings.html", width: 1200, height: 800 },
          ],
        },
        "settings.html",
      ),
    ).toEqual({ width: 1200, height: 800 });
  });

  it("lets a fixed size in the prompt win", () => {
    expect(
      size({ prompt: "A 1080x1080 social post", devices: ["mobile"] }),
    ).toEqual({ width: 1080, height: 1080 });
  });
});
