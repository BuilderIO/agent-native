import { describe, expect, it, vi } from "vitest";

import {
  MAC_ACCESSIBILITY_SETTINGS_URL,
  MAC_SCREEN_RECORDING_SETTINGS_URL,
  runComputerSetupAction,
} from "./setup";

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    platform: "darwin",
    requestAccessibility: vi.fn(() => false),
    requestScreenRecording: vi.fn(async () => false),
    openExternal: vi.fn(async () => {}),
    extensionPath: vi.fn(() => "/bundled/chrome-extension"),
    pathExists: vi.fn(() => true),
    revealExtensionFolder: vi.fn(async () => {}),
    openChromeExtensions: vi.fn(),
    restart: vi.fn(),
    ...overrides,
  };
}

describe("computer access setup", () => {
  it("prompts for Accessibility only after the explicit action", async () => {
    const deps = dependencies();
    const result = await runComputerSetupAction("request-accessibility", deps);

    expect(deps.requestAccessibility).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ ok: true, restartRecommended: true });
  });

  it.each([
    ["open-accessibility-settings", MAC_ACCESSIBILITY_SETTINGS_URL],
    ["open-screen-recording-settings", MAC_SCREEN_RECORDING_SETTINGS_URL],
  ] as const)("opens the fixed settings URL for %s", async (action, url) => {
    const deps = dependencies();
    await runComputerSetupAction(action, deps);
    expect(deps.openExternal).toHaveBeenCalledWith(url);
  });

  it("requests Screen Recording only after the explicit action", async () => {
    const deps = dependencies();
    const result = await runComputerSetupAction(
      "request-screen-recording",
      deps,
    );

    expect(deps.requestScreenRecording).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ ok: true, restartRecommended: true });
  });

  it("reveals only the bundled extension and opens Chrome Extensions", async () => {
    const deps = dependencies();
    const result = await runComputerSetupAction("open-chrome-setup", deps);

    expect(deps.pathExists).toHaveBeenCalledWith(
      "/bundled/chrome-extension/manifest.json",
    );
    expect(deps.revealExtensionFolder).toHaveBeenCalledWith(
      "/bundled/chrome-extension",
    );
    expect(deps.openChromeExtensions).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
  });

  it("fails closed when the extension bundle is missing", async () => {
    const deps = dependencies({ pathExists: vi.fn(() => false) });
    const result = await runComputerSetupAction("open-chrome-setup", deps);

    expect(result).toMatchObject({
      ok: false,
      error: "Chrome extension bundle is missing.",
    });
    expect(deps.openChromeExtensions).not.toHaveBeenCalled();
  });

  it("restarts only after the explicit restart action", async () => {
    const deps = dependencies();
    await runComputerSetupAction("restart", deps);
    expect(deps.restart).toHaveBeenCalledOnce();
  });

  it("rejects unknown actions and unsupported platforms", async () => {
    const unknown = dependencies();
    const unknownResult = await runComputerSetupAction("anything", unknown);
    expect(unknownResult.ok).toBe(false);
    expect(unknown.requestAccessibility).not.toHaveBeenCalled();

    const linux = dependencies({ platform: "linux" });
    const linuxResult = await runComputerSetupAction(
      "request-accessibility",
      linux,
    );
    expect(linuxResult).toMatchObject({
      ok: false,
      error: "Unsupported platform.",
    });
  });
});
