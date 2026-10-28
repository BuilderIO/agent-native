import { describe, expect, it } from "vitest";

import {
  recorderShortcutAction,
  type RecorderUiState,
} from "./recorder-shortcuts";

const altShift = (key: string) => ({
  key,
  code: `Key${key.toUpperCase()}`,
  altKey: true,
  shiftKey: true,
  metaKey: false,
  ctrlKey: false,
});

function action(
  key: ReturnType<typeof altShift>,
  uiState: RecorderUiState,
  hasRecordingToLose = false,
) {
  return recorderShortcutAction(key, {
    uiState,
    engineState: undefined,
    hasRecordingToLose,
  });
}

describe("recorderShortcutAction", () => {
  it.each<RecorderUiState>([
    "recording",
    "uploading",
    "compressing",
    "pendingUpload",
  ])("asks before Alt+Shift+C discards a %s recording", (uiState) => {
    expect(action(altShift("c"), uiState)).toBe("confirm-discard");
  });

  it("asks before discarding a failed upload that still has a local copy", () => {
    expect(action(altShift("c"), "error", true)).toBe("confirm-discard");
  });

  it("resets an error with nothing recorded without a prompt", () => {
    expect(action(altShift("c"), "error", false)).toBe("cancel-setup");
  });

  it.each<RecorderUiState>(["countdown", "pickingSources"])(
    "cancels %s directly because nothing is recorded yet",
    (uiState) => {
      expect(action(altShift("c"), uiState, true)).toBe("cancel-setup");
    },
  );

  it("asks before Alt+Shift+R throws away a live recording", () => {
    expect(action(altShift("r"), "recording")).toBe("confirm-restart");
    expect(action(altShift("r"), "countdown")).toBe("restart");
  });

  it("stops rather than discards on Escape", () => {
    expect(
      recorderShortcutAction(
        { ...altShift("Escape"), altKey: false, shiftKey: false },
        {
          uiState: "recording",
          engineState: "recording",
          hasRecordingToLose: true,
        },
      ),
    ).toBe("stop");
  });

  it("does nothing while idle", () => {
    expect(action(altShift("c"), "idle")).toBeNull();
  });
});
