import { describe, expect, it } from "vitest";

import messages from "./default-messages.js";

function emptyLeaves(value: unknown, path: string): string[] {
  if (typeof value === "string") return value.trim() === "" ? [path] : [];
  if (!value || typeof value !== "object") return [path];
  return Object.entries(value).flatMap(([key, child]) =>
    emptyLeaves(child, path ? `${path}.${key}` : key),
  );
}

describe("default messages", () => {
  it("has no empty or non-string message values", () => {
    expect(emptyLeaves(messages, "")).toEqual([]);
  });

  it("keeps the voice mode controls the realtime voice UI reads", () => {
    expect(Object.keys(messages.agentPanel.voiceMode)).toEqual(
      expect.arrayContaining([
        "start",
        "endVoiceChat",
        "placeholder",
        "muteMicrophone",
        "unmuteMicrophone",
        "muteSpeaker",
        "unmuteSpeaker",
        "voiceSettings",
        "settings",
      ]),
    );
  });

  it("no longer carries the removed voice chooser strings", () => {
    const voiceMode: Record<string, unknown> = messages.agentPanel.voiceMode;
    for (const removed of [
      "entryButtonLabel",
      "promptTitle",
      "setupTitle",
      "connectBuilder",
      "useOpenAiKey",
      "keepDictating",
      "rememberPreference",
      "end",
    ]) {
      expect(voiceMode, removed).not.toHaveProperty(removed);
    }
  });
});
