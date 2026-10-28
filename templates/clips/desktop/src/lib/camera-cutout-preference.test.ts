// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emit: vi.fn(async () => {}),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: mocks.emit,
  listen: vi.fn(
    async (name: string, handler: (event: { payload: unknown }) => void) => {
      mocks.listeners.set(name, handler);
      return mocks.unlisten;
    },
  ),
}));

import {
  CAMERA_CUTOUT_EVENT,
  CAMERA_CUTOUT_STORAGE_KEY,
  loadCameraCutoutPreference,
  saveCameraCutoutPreference,
  subscribeCameraCutoutPreference,
} from "./camera-cutout-preference";

afterEach(() => {
  window.localStorage.clear();
  mocks.emit.mockClear();
  mocks.listeners.clear();
  mocks.unlisten.mockClear();
});

describe("camera cut-out preference", () => {
  it("defaults to off", () => {
    expect(loadCameraCutoutPreference()).toBe(false);
  });

  it("persists the choice and broadcasts it to other windows", () => {
    saveCameraCutoutPreference(true);

    expect(window.localStorage.getItem(CAMERA_CUTOUT_STORAGE_KEY)).toBe("1");
    expect(loadCameraCutoutPreference()).toBe(true);
    expect(mocks.emit).toHaveBeenCalledWith(CAMERA_CUTOUT_EVENT, {
      enabled: true,
    });
  });

  it("follows Tauri events and storage events until unsubscribed", async () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeCameraCutoutPreference(onChange);
    await Promise.resolve();

    mocks.listeners.get(CAMERA_CUTOUT_EVENT)?.({ payload: { enabled: true } });
    mocks.listeners.get(CAMERA_CUTOUT_EVENT)?.({ payload: { enabled: "x" } });
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: CAMERA_CUTOUT_STORAGE_KEY,
        newValue: "0",
      }),
    );
    expect(onChange.mock.calls).toEqual([[true], [false]]);

    unsubscribe();
    expect(mocks.unlisten).toHaveBeenCalled();
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: CAMERA_CUTOUT_STORAGE_KEY,
        newValue: "1",
      }),
    );
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
