import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { UpdateStatus } from "../lib/updater";

const updateMocks = vi.hoisted(() => ({
  status: { state: "idle" } as UpdateStatus,
}));

vi.mock("../hooks/useMicMeter", () => ({
  useMicMeter: () => ({ current: null }),
}));

vi.mock("../lib/updater", () => ({
  installAndRestart: vi.fn(),
  retryUpdateCheck: vi.fn(),
  useUpdateStatus: () => updateMocks.status,
}));

import { MediaDeviceRow } from "./MediaDeviceRow";
import { ShortcutKeycaps } from "./ShortcutKeycaps";
import { hasRecentCaptureWindows, SourceRow } from "./SourceRow";
import { Switch } from "./Switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "./Tooltip";
import { UpdateBanner } from "./UpdateBanner";

const cameraDevice = {
  deviceId: "camera-1",
  kind: "videoinput",
  label: "FaceTime HD Camera",
} as MediaDeviceInfo;

const commonDeviceProps = {
  devices: [cameraDevice],
  selectedId: cameraDevice.deviceId,
  selectedLabel: cameraDevice.label,
  onSelect: vi.fn(),
  onRefresh: vi.fn(),
  onToggle: vi.fn(),
};

describe("recorder popover failure states", () => {
  it("keeps the start affordance and mode-toggle radii aligned with web", () => {
    const appSource = readFileSync(
      resolve(process.cwd(), "src/app.tsx"),
      "utf8",
    );
    const styles = readFileSync(
      resolve(process.cwd(), "src/styles.css"),
      "utf8",
    );
    const tokens = readFileSync(
      resolve(process.cwd(), "src/tailwind.css"),
      "utf8",
    );
    const modeToggleStyles = styles.slice(
      styles.indexOf(".mode-toggle {"),
      styles.indexOf(".mode-tooltip {"),
    );
    const recordingDotStyles = styles.slice(
      styles.indexOf(".rec-dot {"),
      styles.indexOf(".active-recording-card {"),
    );

    expect(appSource).toContain(
      '<span className="rec-dot" aria-hidden="true" />',
    );
    expect(modeToggleStyles).toContain(
      "border-radius: var(--recorder-mode-toggle-radius)",
    );
    expect(modeToggleStyles).toContain(
      "border-radius: var(--recorder-mode-option-radius)",
    );
    expect(tokens).toContain("--recorder-mode-option-radius: 14px");
    expect(tokens).toContain("--recorder-mode-toggle-inset: 4px");
    expect(tokens).toContain(
      "var(--recorder-mode-option-radius) + var(--recorder-mode-toggle-inset)",
    );
    expect(recordingDotStyles).toContain("width: 8px");
    expect(recordingDotStyles).toContain(
      "background: hsl(var(--ui-destructive))",
    );
    expect(recordingDotStyles).not.toContain("box-shadow");
  });

  it("makes a disabled camera row quiet and reversible", () => {
    const html = renderToStaticMarkup(
      <MediaDeviceRow {...commonDeviceProps} kind="camera" on={false} />,
    );

    expect(html).toContain("Camera");
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain('aria-haspopup="menu"');
    expect(html).not.toContain("FaceTime HD Camera");
    expect(html).toContain('aria-label="Camera"');
  });

  it("removes mic-only affordances and the live meter when the mic is off", () => {
    const html = renderToStaticMarkup(
      <MediaDeviceRow
        {...commonDeviceProps}
        kind="mic"
        devices={[]}
        selectedId=""
        selectedLabel="MacBook Pro Microphone"
        on={false}
        systemAudio={true}
        onSystemAudioToggle={vi.fn()}
      />,
    );

    expect(html).toContain("Microphone");
    expect(html).not.toContain('aria-haspopup="menu"');
    expect(html).not.toContain("mic-wave");
    expect(html).not.toContain("Record system audio");
  });

  it("keeps source selection keyboard-addressable when the source is active", () => {
    const html = renderToStaticMarkup(
      <SourceRow value="full-screen" onChange={vi.fn()} includeRegion />,
    );

    expect(html).toContain("Full screen");
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-label="Choose capture source: Full screen"');
  });

  it("uses the shadcn switch primitive with a visible thumb", () => {
    const html = renderToStaticMarkup(
      <Switch on={true} onChange={vi.fn()} label="Microphone" />,
    );

    expect(html).toContain('data-slot="switch"');
    expect(html).toContain('data-tw-surface="true"');
    expect(html).toContain('data-size="default"');
    expect(html).toContain('data-slot="switch-thumb"');
    expect(html).toContain("group-data-[size=default]/switch:size-4");
    expect(html).toContain("ring-foreground/20");
    expect(html).toContain("data-[state=checked]:translate-x-[calc(100%-2px)]");
    expect(html).not.toContain("[&>span]");
  });

  it("preserves checked switch styling while its tooltip is open", () => {
    const html = renderToStaticMarkup(
      <Tooltip open>
        <TooltipTrigger asChild>
          <Switch on onChange={vi.fn()} label="Microphone" />
        </TooltipTrigger>
        <TooltipContent>Turn off microphone</TooltipContent>
      </Tooltip>,
    );

    expect(html).toContain('data-state="checked"');
    expect(html).not.toContain('data-state="instant-open"');
  });

  it("does not invent an empty Windows group when no windows are available", () => {
    expect(hasRecentCaptureWindows([])).toBe(false);
    expect(
      hasRecentCaptureWindows([{ id: "window-1", label: "Design review" }]),
    ).toBe(true);
  });

  it("uses an explicit alert for a staged update instead of a settings dot", () => {
    updateMocks.status = { state: "downloaded", version: "2.0.0" };
    const html = renderToStaticMarkup(<UpdateBanner />);

    expect(html).toContain('role="alert"');
    expect(html).toContain("Update ready");
    expect(html).toContain(">Update</button>");
    expect(html).not.toContain("Dismiss update");
    expect(html).not.toContain("bottom-dot");
    expect(html).not.toContain('aria-label="Update ready"');
  });

  it("renders the Dictate shortcut with the shadcn kbd composition", () => {
    const html = renderToStaticMarkup(<ShortcutKeycaps shortcut="⌘⇧Space" />);

    expect(html).toContain('data-slot="kbd-group"');
    expect(html.match(/data-slot="kbd"/g)).toHaveLength(3);
    expect(html).toContain("Shortcut: ⌘⇧Space");
    expect(html).not.toContain("shadow-sm");
  });
});
