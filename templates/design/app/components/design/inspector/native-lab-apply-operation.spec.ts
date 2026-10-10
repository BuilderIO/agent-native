import { OWNED_PROCESSOR_DEFINITIONS } from "@shared/native-effect-owned-processors";
import { expect, it } from "vitest";

import { nativeLabApplyOperation } from "./native-lab-apply-operation";

const definition = OWNED_PROCESSOR_DEFINITIONS.find(
  (item) => item.id === "an-native-owned-shadow-lift",
)!;
const common = {
  definition,
  fromVersion: definition.version,
  instanceId: "selected",
  sharedInstanceIds: ["selected", "sibling"],
  params: { lift: 0.22 },
};

it("commits parameter-only Lab edits to the selected instance without revising shader identity", () => {
  expect(
    nativeLabApplyOperation({ ...common, sourceDirty: false, shared: false }),
  ).toEqual({
    kind: "set-params",
    instanceId: "selected",
    params: { lift: 0.22 },
  });
});

it("commits shared parameter-only edits atomically without revising the definition", () => {
  expect(
    nativeLabApplyOperation({ ...common, sourceDirty: false, shared: true }),
  ).toEqual({
    kind: "set-params-many",
    instanceIds: ["selected", "sibling"],
    params: { lift: 0.22 },
  });
});

it("still revises the definition when its WGSL source changed", () => {
  expect(
    nativeLabApplyOperation({ ...common, sourceDirty: true, shared: true }),
  ).toEqual({
    kind: "revise-definition",
    definition,
    fromVersion: definition.version,
    instanceIds: ["selected", "sibling"],
    params: { lift: 0.22 },
  });
});
