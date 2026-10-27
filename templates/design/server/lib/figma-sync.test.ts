import { describe, expect, it } from "vitest";

import { classifyFigmaSync, hashJson, hashText } from "./figma-sync.js";
import {
  filterFigmaSyncAgentActions,
  prepareFigmaSyncAgentRequest,
} from "./figma-sync-flag.js";

describe("Figma sync baselines", () => {
  const baseline = {
    figmaVersion: "version-1",
    figmaNodeHash: hashJson({ id: "1:2", name: "Frame" }),
    designHash: hashText("<main>Frame</main>"),
  };

  it("classifies missing baselines as untracked", () => {
    expect(
      classifyFigmaSync({
        baseline: null,
        figmaNodeHash: "remote",
        designHash: "local",
      }),
    ).toBe("untracked");
  });

  it("uses stable JSON hashing regardless of object key order", () => {
    expect(hashJson({ id: "1:2", name: "Frame" })).toBe(
      hashJson({ name: "Frame", id: "1:2" }),
    );
  });

  it("stays idempotent across repeated checks", () => {
    for (let sync = 0; sync < 3; sync += 1) {
      expect(
        classifyFigmaSync({
          baseline,
          figmaNodeHash: baseline.figmaNodeHash,
          designHash: baseline.designHash,
        }),
      ).toBe("in-sync");
    }
  });

  it.each([
    [
      "figma-changed",
      hashJson({ id: "1:2", name: "Updated" }),
      baseline.designHash,
    ],
    [
      "design-changed",
      baseline.figmaNodeHash,
      hashText("<main>Updated</main>"),
    ],
    [
      "both-changed",
      hashJson({ id: "1:2", name: "Updated" }),
      hashText("<main>Updated</main>"),
    ],
  ] as const)(
    "classifies %s without overwriting either side",
    (status, figmaNodeHash, designHash) => {
      expect(classifyFigmaSync({ baseline, figmaNodeHash, designHash })).toBe(
        status,
      );
    },
  );
});

describe("Figma sync Labs surface", () => {
  const available = [
    "import-figma-frame",
    "sync-figma-screen",
    "sync-figma-comments",
  ];

  it("hides sync tools from the agent when the flag is off", () => {
    expect(filterFigmaSyncAgentActions(available, false)).toEqual([
      "import-figma-frame",
    ]);
  });

  it("keeps the existing tool surface when the flag is on", () => {
    expect(filterFigmaSyncAgentActions(available, true)).toEqual(available);
  });

  it("leaves agent requests unchanged when the flag is off", () => {
    expect(
      prepareFigmaSyncAgentRequest(
        { message: "Update the design", displayMessage: "Update it" },
        false,
      ),
    ).toBeUndefined();
  });

  it("adds sync guidance to internal agent context only when enabled", () => {
    expect(
      prepareFigmaSyncAgentRequest(
        { message: "Update the design", displayMessage: "Update it" },
        true,
      ),
    ).toEqual({
      message: expect.stringMatching(
        /^Update the design\n\nWhen Design sync is enabled,/,
      ),
      displayMessage: "Update it",
    });
  });
});
