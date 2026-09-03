import { describe, expect, it, vi } from "vitest";

import {
  sendNativeNotification,
  type NativeNotificationDeps,
} from "./native-notification";

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
