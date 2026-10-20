import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import {
  permissionStatusForPane,
  readPermissionStatuses,
  requestOrOpenPermission,
  type PermissionStatuses,
} from "./permission-status";

const originalNavigator = globalThis.navigator;

function mockPlatform(platform: string): void {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { platform },
  });
}

const grantedStatuses: PermissionStatuses = {
  screen: true,
  camera: false,
  microphone: true,
  speech: false,
  accessibility: true,
  inputMonitoring: false,
};

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: originalNavigator,
  });
});

describe("readPermissionStatuses", () => {
  it("returns null on a non-macOS host without invoking the command", async () => {
    mockPlatform("Win32");

    await expect(readPermissionStatuses()).resolves.toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("returns null — not an all-false object — when the command fails", async () => {
    mockPlatform("MacIntel");
    invokeMock.mockRejectedValueOnce(new Error("command unavailable"));

    await expect(readPermissionStatuses()).resolves.toBeNull();
    expect(invokeMock).toHaveBeenCalledWith("check_permission_statuses");
  });

  it("returns the per-pane grants the command reports", async () => {
    mockPlatform("MacIntel");
    invokeMock.mockResolvedValueOnce(grantedStatuses);

    await expect(readPermissionStatuses()).resolves.toEqual(grantedStatuses);
    expect(invokeMock).toHaveBeenCalledWith("check_permission_statuses");
  });
});

describe("permissionStatusForPane", () => {
  it("returns null when the statuses could not be read", () => {
    expect(permissionStatusForPane("screen", null)).toBeNull();
    expect(permissionStatusForPane("camera", null)).toBeNull();
  });

  it("returns each pane's own grant", () => {
    expect(permissionStatusForPane("screen", grantedStatuses)).toBe(true);
    expect(permissionStatusForPane("camera", grantedStatuses)).toBe(false);
    expect(permissionStatusForPane("microphone", grantedStatuses)).toBe(true);
    expect(permissionStatusForPane("speech", grantedStatuses)).toBe(false);
    expect(permissionStatusForPane("accessibility", grantedStatuses)).toBe(
      true,
    );
    expect(permissionStatusForPane("input-monitoring", grantedStatuses)).toBe(
      false,
    );
  });
});

describe("requestOrOpenPermission", () => {
  it("skips System Settings when the macOS screen prompt grants", async () => {
    mockPlatform("MacIntel");
    invokeMock.mockResolvedValueOnce(true);
    const onOpenSettings = vi.fn();
    const onRecheck = vi.fn();

    await requestOrOpenPermission("screen", { onOpenSettings, onRecheck });

    expect(invokeMock).toHaveBeenCalledWith("system_audio_request_permission");
    expect(onRecheck).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).not.toHaveBeenCalled();
  });

  it("rechecks, then opens System Settings when the prompt is denied", async () => {
    mockPlatform("MacIntel");
    invokeMock.mockResolvedValueOnce(false);
    const onOpenSettings = vi.fn();
    const onRecheck = vi.fn();

    await requestOrOpenPermission("screen", { onOpenSettings, onRecheck });

    expect(onRecheck).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledWith("screen");
  });

  it("opens System Settings without a recheck when the request API fails", async () => {
    mockPlatform("MacIntel");
    invokeMock.mockRejectedValueOnce(new Error("unsupported"));
    const onOpenSettings = vi.fn();
    const onRecheck = vi.fn();

    await requestOrOpenPermission("screen", { onOpenSettings, onRecheck });

    expect(onRecheck).not.toHaveBeenCalled();
    expect(onOpenSettings).toHaveBeenCalledWith("screen");
  });

  it("only opens the pane for non-screen grants and non-macOS hosts", async () => {
    mockPlatform("MacIntel");
    const onOpenSettings = vi.fn();

    await requestOrOpenPermission("camera", { onOpenSettings });
    expect(invokeMock).not.toHaveBeenCalled();
    expect(onOpenSettings).toHaveBeenCalledWith("camera");

    mockPlatform("Win32");
    await requestOrOpenPermission("screen", { onOpenSettings });
    expect(invokeMock).not.toHaveBeenCalled();
    expect(onOpenSettings).toHaveBeenLastCalledWith("screen");
  });
});
