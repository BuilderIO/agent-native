const NATIVE_FOLDER_PICKER_ATTEMPT_KEY =
  "agent-native:content:native-folder-picker-attempt";

type PickerAttemptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): PickerAttemptStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function hasInterruptedNativeFolderPickerAttempt(
  storage: PickerAttemptStorage | null = browserStorage(),
) {
  try {
    return Boolean(storage?.getItem(NATIVE_FOLDER_PICKER_ATTEMPT_KEY));
  } catch {
    return false;
  }
}

export async function runNativeFolderPickerWithCrashSentinel<T>(
  operation: () => Promise<T>,
  options: {
    storage?: PickerAttemptStorage | null;
    attemptId?: string;
  } = {},
) {
  const storage = options.storage ?? browserStorage();
  const attemptId =
    options.attemptId ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  try {
    storage?.setItem(NATIVE_FOLDER_PICKER_ATTEMPT_KEY, attemptId);
  } catch {
    // The picker still works when storage is unavailable; only crash recovery is lost.
  }

  try {
    return await operation();
  } finally {
    try {
      if (storage?.getItem(NATIVE_FOLDER_PICKER_ATTEMPT_KEY) === attemptId) {
        storage.removeItem(NATIVE_FOLDER_PICKER_ATTEMPT_KEY);
      }
    } catch {
      // A storage failure must not mask the picker result.
    }
  }
}
