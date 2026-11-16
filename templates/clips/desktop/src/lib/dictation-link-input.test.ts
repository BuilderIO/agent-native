import { describe, expect, it } from "vitest";

import {
  reduceDictationInput,
  type DictationInputAction,
  type DictationInputEvent,
  type DictationPressOwner,
} from "./dictation-link-input";

type Row = [
  name: string,
  owner: DictationPressOwner,
  event: DictationInputEvent,
  context: { handsFree: boolean },
  next: DictationPressOwner,
  action: DictationInputAction,
];

const idle = { handsFree: false };
const handsFree = { handsFree: true };

const rows: Row[] = [
  [
    "link down starts",
    "none",
    { kind: "start", source: "link" },
    idle,
    "link",
    "start-link",
  ],
  [
    "a native-owned link down owns it behind a tap still starting",
    "none",
    { kind: "start", source: "link" },
    idle,
    "link",
    "start-link",
  ],
  [
    "a native-owned link down after an earlier link tap",
    "link",
    { kind: "start", source: "link" },
    idle,
    "link",
    "start-link",
  ],
  [
    "stop-only link down stops a run it didn't start, owning nothing",
    "none",
    { kind: "start", source: "link", stopOnly: true },
    idle,
    "none",
    "stop-running",
  ],
  [
    "link down stops hands-free",
    "none",
    { kind: "start", source: "link", stopOnly: true },
    handsFree,
    "none",
    "stop-running",
  ],
  [
    "link up stops its own run",
    "link",
    { kind: "stop", source: "link" },
    idle,
    "none",
    "stop-link",
  ],
  [
    "link up leaves a run it didn't start",
    "none",
    { kind: "stop", source: "link" },
    idle,
    "none",
    "ignore",
  ],
  [
    "link up after a key took over",
    "key",
    { kind: "stop", source: "link" },
    idle,
    "key",
    "ignore",
  ],
  [
    "link up during hands-free",
    "link",
    { kind: "stop", source: "link" },
    handsFree,
    "none",
    "ignore",
  ],
  [
    "a native key takeover replaces the link",
    "link",
    { kind: "start", source: "key" },
    idle,
    "key",
    "key",
  ],
  [
    "key up ends the key's press",
    "key",
    { kind: "stop", source: "key" },
    idle,
    "none",
    "key",
  ],
  [
    "hands-free link clears a push owner",
    "link",
    { kind: "start", source: "link-hands-free" },
    idle,
    "none",
    "hands-free-link",
  ],
];

describe("reduceDictationInput", () => {
  it.each(rows)("%s", (_name, owner, event, context, next, action) => {
    expect(reduceDictationInput(owner, event, context)).toEqual({
      owner: next,
      action,
    });
  });
});
