// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import {
  useHouseFixture,
  type HouseFixture,
} from "../app-shell/house-fixtures.js";
import { houseShellChoices } from "./house-shell-choices.js";

it("registers house control and keyboard choices without changing the model", () => {
  let fixture: HouseFixture | undefined;
  function Fixture() {
    fixture = useHouseFixture("tracker");
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<Fixture />));
  if (!fixture) throw new Error("Fixture did not mount");
  const model = fixture.model;
  const before = houseShellChoices(model);
  expect(before.find((choice) => choice.id === "scope")?.choice).toBe(
    "native-choice",
  );
  expect(
    before.filter((choice) => choice.choice.startsWith("keyboard")),
  ).toHaveLength(0);
  const extended = {
    ...model,
    navigation: {
      ...model.navigation,
      resize: model.navigation.resize
        ? {
            ...model.navigation.resize,
            policy: { ...model.navigation.resize.policy, keyboard: false },
          }
        : undefined,
      sections: model.navigation.sections.map((section) =>
        section.reorder
          ? {
              ...section,
              reorder: {
                ...section.reorder,
                policy: { ...section.reorder.policy, keyboard: false as const },
              },
            }
          : section,
      ),
    },
  };
  expect(
    houseShellChoices(extended)
      .filter((choice) => choice.choice.startsWith("keyboard"))
      .map((choice) => choice.choice)
      .sort(),
  ).toEqual(["keyboard-reorder", "keyboard-resize"]);
  expect(model.navigation.resize?.policy.keyboard).toBe(true);
  act(() => root.unmount());
});
