import { beforeEach, describe, expect, it } from "vitest";

import {
  _resetExperimentRegistryForTests,
  defineExperiment,
  defineExperiments,
  listExperiments,
  registerExperiments,
} from "./registry.js";

beforeEach(() => {
  _resetExperimentRegistryForTests();
});

describe("experiment registry", () => {
  it("normalizes metadata, sorts definitions, and rejects unstable keys", () => {
    const definitions = defineExperiments([
      {
        key: " clips.meetings ",
        displayName: " Meetings ",
        description: " Try meetings ",
        keywords: " notes ",
      },
      { key: "clips.editor", displayName: "Editor" },
    ]);

    registerExperiments(definitions);

    expect(listExperiments()).toEqual([
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
    expect(() => defineExperiment({ key: "not stable" })).toThrow(
      /only letters, numbers, dots, underscores, or hyphens/,
    );
  });

  it("allows identical HMR registration but rejects conflicting metadata", () => {
    const definition = defineExperiment({
      key: "clips.tweaks",
      displayName: "Tweaks",
    });

    registerExperiments([definition]);
    expect(() => registerExperiments([definition])).not.toThrow();
    expect(() =>
      registerExperiments([
        { key: "clips.tweaks", displayName: "Different tweaks" },
      ]),
    ).toThrow(/registered with conflicting metadata/);
  });
});
