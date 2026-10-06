import { expect, it } from "vitest";

import { nextRecentLayerModelFileIds } from "./layer-model-coverage";

it("releases a screen's layer model once newer screens push it out of the recent set", () => {
  let recent: string[] = [];
  for (const active of ["a", "b", "c", "d", "e"]) {
    recent = nextRecentLayerModelFileIds(recent, [active]);
  }
  expect(recent).toEqual(["e", "d", "c"]);
});

it("keeps a screen recent while it is still needed", () => {
  let recent = nextRecentLayerModelFileIds([], ["board", "a"]);
  for (const active of ["b", "c", "d"]) {
    recent = nextRecentLayerModelFileIds(recent, ["board", active]);
  }
  expect(recent).toEqual(["board", "d", "c"]);
});
