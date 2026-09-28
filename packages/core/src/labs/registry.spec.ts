import { beforeEach, describe, expect, it } from "vitest";

import {
  _resetLabRegistryForTests,
  defineLab,
  defineLabs,
  listLabs,
  registerLabs,
} from "./registry.js";

beforeEach(() => {
  _resetLabRegistryForTests();
});

describe("lab registry", () => {
  it("normalizes metadata, sorts definitions, and rejects unstable keys", () => {
    const definitions = defineLabs([
      {
        key: " clips.meetings ",
        displayName: " Meetings ",
        description: " Try meetings ",
        keywords: " notes ",
      },
      { key: "clips.editor", displayName: "Editor" },
    ]);

    registerLabs(definitions);

    expect(listLabs()).toEqual([
      {
        key: "clips.editor",
        displayName: "Editor",
      },
      {
        key: "clips.meetings",
        displayName: "Meetings",
        description: "Try meetings",
        keywords: "notes",
      },
    ]);
    expect(() => defineLab({ key: "not stable" })).toThrow(
      /only letters, numbers, dots, underscores, or hyphens/,
    );
  });

  it("allows identical HMR registration but rejects conflicting metadata", () => {
    const definition = defineLab({
      key: "clips.tweaks",
      displayName: "Tweaks",
    });

    registerLabs([definition]);
    expect(() => registerLabs([definition])).not.toThrow();
    expect(() =>
      registerLabs([{ key: "clips.tweaks", displayName: "Different tweaks" }]),
    ).toThrow(/registered with conflicting metadata/);
  });
});
