import { describe, expect, it, vi } from "vitest";

import {
  hasInterruptedNativeFolderPickerAttempt,
  runNativeFolderPickerWithCrashSentinel,
} from "./local-folder-picker-safety";

function memoryStorage(initialValue?: string) {
  const values = new Map<string, string>();
  if (initialValue) {
    values.set(
      "agent-native:content:native-folder-picker-attempt",
      initialValue,
    );
  }
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("native folder picker crash sentinel", () => {
  it("marks an in-flight picker and clears the marker when it returns", async () => {
    const storage = memoryStorage();
    const operation = vi.fn(async () => {
      expect(hasInterruptedNativeFolderPickerAttempt(storage)).toBe(true);
      return "folder";
    });

    await expect(
      runNativeFolderPickerWithCrashSentinel(operation, {
        storage,
        attemptId: "attempt-1",
      }),
    ).resolves.toBe("folder");
    expect(hasInterruptedNativeFolderPickerAttempt(storage)).toBe(false);
  });

  it("clears the marker when the picker rejects normally", async () => {
    const storage = memoryStorage();

    await expect(
      runNativeFolderPickerWithCrashSentinel(
        async () => {
          throw new Error("cancelled");
        },
        { storage, attemptId: "attempt-2" },
      ),
    ).rejects.toThrow("cancelled");
    expect(hasInterruptedNativeFolderPickerAttempt(storage)).toBe(false);
  });

  it("recognizes the marker left behind when a picker never returned", () => {
    expect(
      hasInterruptedNativeFolderPickerAttempt(memoryStorage("unfinished")),
    ).toBe(true);
  });
});
