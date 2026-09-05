// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { RecorderRouteStatus, RecordingErrorCard } from "./record";

describe("record route lifecycle shell", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("announces real progress without including action controls", () => {
    act(() => {
      root.render(
        <RecorderRouteStatus busy progress={1.4} label="Saving recording">
          <button type="button">Discard recording</button>
        </RecorderRouteStatus>,
      );
    });

    const status = container.querySelector('[role="status"]');
    const progress = container.querySelector('[role="progressbar"]');
    const action = container.querySelector("button");

    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.getAttribute("aria-busy")).toBe("true");
    expect(status?.contains(progress)).toBe(true);
    expect(status?.contains(action)).toBe(false);
    expect(status?.parentElement?.contains(action)).toBe(true);
    expect(progress?.getAttribute("aria-valuenow")).toBe("100");
    expect(progress?.querySelector("div")?.getAttribute("style")).toContain(
      "width: 100%",
    );
    expect(container.textContent).toContain("100%");
    expect(container.textContent).toContain("Discard recording");
  });

  it("keeps blocking recovery assertive while actions stay outside", () => {
    act(() => {
      root.render(
        <RecorderRouteStatus role="alert" label="Session expired">
          <button type="button">Log in</button>
        </RecorderRouteStatus>,
      );
    });

    const alert = container.querySelector('[role="alert"]');
    const action = container.querySelector("button");
    expect(alert?.getAttribute("aria-live")).toBe("assertive");
    expect(alert?.hasAttribute("aria-busy")).toBe(false);
    expect(alert?.contains(action)).toBe(false);
    expect(alert?.parentElement?.contains(action)).toBe(true);
  });

  it("keeps failed uploads recoverable without placing actions in the alert", () => {
    const onTryAgain = vi.fn();
    act(() => {
      root.render(
        <RecordingErrorCard
          error="Upload failed at chunk 2"
          mode="screen"
          micDeviceId={null}
          canRetryUpload
          canDownloadRecording={false}
          onDownloadRecording={vi.fn()}
          onTryAgain={onTryAgain}
        />,
      );
    });

    const alert = container.querySelector('[role="alert"]');
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "recordRoute.retryUpload",
    );
    expect(alert?.getAttribute("aria-live")).toBe("assertive");
    expect(retry).toBeDefined();
    expect(alert?.contains(retry!)).toBe(false);

    act(() => retry?.click());
    expect(onTryAgain).toHaveBeenCalledTimes(1);
  });

  it("keeps camera permission failures in route recovery", () => {
    const onTryAgain = vi.fn();
    act(() => {
      root.render(
        <RecordingErrorCard
          error="Camera permission denied"
          mode="camera"
          micDeviceId={null}
          canRetryUpload={false}
          canDownloadRecording={false}
          onDownloadRecording={vi.fn()}
          onTryAgain={onTryAgain}
        />,
      );
    });

    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "recordRoute.tryAgain",
    );
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(retry).toBeDefined();

    act(() => retry?.click());
    expect(onTryAgain).toHaveBeenCalledTimes(1);
  });

  it("keeps the setup centered with a quiet desktop CTA and semantic colors", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/routes/record.tsx"),
      "utf8",
    );
    const callout = source.slice(
      source.indexOf("function DesktopRecorderCallout"),
      source.indexOf("export function RecorderRouteStatus"),
    );

    expect(source).toContain("min-h-[100dvh]");
    expect(source).toContain("max-w-[320px]");
    expect(source).toContain(
      'className="mx-auto grid w-full max-w-[320px] gap-2"',
    );
    expect(callout).toContain('variant="ghost"');
    expect(callout).toContain("text-xs font-normal text-muted-foreground");
    expect(callout).not.toContain("border-border");
    expect(callout).not.toContain("bg-muted");
    expect(source).not.toContain("xl:grid-cols-[288px_320px_288px]");
    expect(source).not.toContain("xl:absolute");
    expect(source).not.toMatch(
      /\b(?:bg-black|text-white|from-zinc|to-black)\b/,
    );
    expect(source).not.toContain("transition-all");
  });

  it("keeps auto-upload as a hidden route bridge instead of panel chrome", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/routes/record.tsx"),
      "utf8",
    );

    expect(source).toContain('params.get("autoUpload") === "1"');
    expect(source).toContain('data-auto-upload-bridge="true"');
    expect(source).toContain("autoUploadInputRef.current?.click()");
    expect(source).toContain("if (file) void uploadFile(file)");
    expect(source).not.toContain("onUpload={uploadFile}");
    expect(source).not.toContain("importLoomHref=");
    expect(source).not.toContain("autoOpenUpload=");
  });
});
