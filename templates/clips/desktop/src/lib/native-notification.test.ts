import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted } from "@tauri-apps/plugin-notification";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  sendNativeNotification,
  submitNativeNotification,
  type NativeNotificationDeps,
} from "./native-notification";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

function deps(overrides: Partial<NativeNotificationDeps> = {}) {
  return {
    isPermissionGranted: vi.fn().mockResolvedValue(true),
    requestPermission: vi.fn().mockResolvedValue("granted"),
    sendNotification: vi.fn(),
    ...overrides,
  } satisfies NativeNotificationDeps;
}

describe("native notification", () => {
  it("sends without re-requesting when permission is already granted", async () => {
    const d = deps();

    await expect(
      sendNativeNotification({ title: "Link copied", body: "Ready" }, d),
    ).resolves.toBe(true);

    expect(d.requestPermission).not.toHaveBeenCalled();
    expect(d.sendNotification).toHaveBeenCalledWith({
      title: "Link copied",
      body: "Ready",
    });
  });

  it("requests permission first when it has not been granted yet", async () => {
    const d = deps({ isPermissionGranted: vi.fn().mockResolvedValue(false) });

    await expect(
      sendNativeNotification({ title: "Link copied" }, d),
    ).resolves.toBe(true);

    expect(d.requestPermission).toHaveBeenCalled();
    expect(d.sendNotification).toHaveBeenCalled();
  });

  it("stays silent when the user denies permission", async () => {
    const d = deps({
      isPermissionGranted: vi.fn().mockResolvedValue(false),
      requestPermission: vi.fn().mockResolvedValue("denied"),
    });

    await expect(
      sendNativeNotification({ title: "Link copied" }, d),
    ).resolves.toBe(false);

    expect(d.sendNotification).not.toHaveBeenCalled();
  });

  it("does not reject when the notification backend fails", async () => {
    const d = deps({
      sendNotification: vi.fn(() => {
        throw new Error("notification center unavailable");
      }),
    });

    await expect(
      sendNativeNotification({ title: "Link copied" }, d),
    ).resolves.toBe(false);
  });
});

describe("failure notification native transport", () => {
  it("awaits native command receipt without claiming visible delivery", async () => {
    vi.mocked(isPermissionGranted).mockResolvedValue(true);
    vi.mocked(invoke).mockResolvedValue(undefined);
    await expect(
      submitNativeNotification({
        title: "Example failure",
        body: "Open Clips.",
      }),
    ).resolves.toEqual({ status: "submitted", visibility: "unknown" });
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      "plugin:notification|notify",
      { options: { title: "Example failure", body: "Open Clips." } },
    );
  });

  it("does not request permission when permission is absent", async () => {
    const d = deps({ isPermissionGranted: vi.fn().mockResolvedValue(false) });
    await expect(
      submitNativeNotification({ title: "Example failure" }, d),
    ).resolves.toEqual({ status: "denied" });
    expect(d.requestPermission).not.toHaveBeenCalled();
    expect(d.sendNotification).not.toHaveBeenCalled();
  });

  it("distinguishes unreadable permission from denial", async () => {
    const d = deps({
      isPermissionGranted: vi
        .fn()
        .mockRejectedValue(new Error("example failure")),
    });
    await expect(
      submitNativeNotification({ title: "Example failure" }, d),
    ).resolves.toEqual({
      status: "failed",
      stage: "permission",
      reason: "backend",
    });
    expect(d.sendNotification).not.toHaveBeenCalled();
  });

  it("observes an asynchronous native rejection", async () => {
    const d = deps({
      sendNotification: vi.fn().mockRejectedValue(new Error("example failure")),
    });
    await expect(
      submitNativeNotification({ title: "Example failure" }, d),
    ).resolves.toEqual({
      status: "failed",
      stage: "dispatch",
      reason: "backend",
    });
  });

  it("does not dispatch after a permission check times out and later resolves", async () => {
    vi.useFakeTimers();
    let resolvePermission!: (granted: boolean) => void;
    const d = deps({
      isPermissionGranted: () =>
        new Promise((resolve) => {
          resolvePermission = resolve;
        }),
    });
    const result = submitNativeNotification({ title: "Example failure" }, d);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(result).resolves.toEqual({
      status: "failed",
      stage: "permission",
      reason: "timeout",
    });
    resolvePermission(true);
    await Promise.resolve();
    expect(d.sendNotification).not.toHaveBeenCalled();
  });

  it("bounds a stalled dispatch and consumes late rejection", async () => {
    vi.useFakeTimers();
    let rejectDispatch!: (error: Error) => void;
    const d = deps({
      sendNotification: () =>
        new Promise<void>((_, reject) => {
          rejectDispatch = reject;
        }),
    });
    const result = submitNativeNotification({ title: "Example failure" }, d);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(result).resolves.toEqual({
      status: "failed",
      stage: "dispatch",
      reason: "timeout",
    });
    rejectDispatch(new Error("example late rejection"));
    await Promise.resolve();
  });
});
