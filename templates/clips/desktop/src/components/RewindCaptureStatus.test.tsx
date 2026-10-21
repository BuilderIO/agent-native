import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getRewindStatusPresentation } from "../lib/rewind-status";
import type { ScreenMemoryConfig, ScreenMemoryStatus } from "../shared/config";
import { RewindCaptureStatus } from "./RewindCaptureStatus";

const config = { enabled: true, paused: false } as ScreenMemoryConfig;

function renderStatus(status: ScreenMemoryStatus | null) {
  return renderToStaticMarkup(
    <RewindCaptureStatus
      status={status}
      presentation={getRewindStatusPresentation({ status, config })}
    />,
  );
}

describe("Rewind capture status row", () => {
  it("makes no capture claim before native status arrives", () => {
    expect(renderStatus(null)).toBe("");
  });

  it.each(["visuals", "visuals-audio"] as const)(
    "keeps the live %s indicator visible alongside an auxiliary error",
    (captureMode) => {
      const html = renderStatus({
        config,
        state: "recording",
        activeSegment: { captureMode },
        lastError: "Could not write visual index metadata.",
      } as ScreenMemoryStatus);
      expect(html).toContain('role="status"');
      expect(html).toContain('class="rec-dot"');
      expect(html).toContain(
        captureMode === "visuals-audio"
          ? "Rewind is remembering screen + audio"
          : "Rewind is remembering screen only",
      );
      expect(html).toContain("Could not write visual index metadata.");
      expect(html).toContain("text-destructive");
    },
  );

  it("shows a known idle state without a recording dot", () => {
    const html = renderStatus({ config, state: "idle" } as ScreenMemoryStatus);
    expect(html).toContain("Rewind is on but not capturing");
    expect(html).not.toContain("rec-dot");
  });

  it("keeps an off state quiet", () => {
    expect(
      renderStatus({ config, state: "disabled" } as ScreenMemoryStatus),
    ).toBe("");
  });
});
