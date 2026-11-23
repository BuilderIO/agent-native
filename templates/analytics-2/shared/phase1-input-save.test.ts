import { expect, it } from "vitest";

import { inputSave } from "../e2e/phase1/input-save.js";

it("observes the notebook's serialized input save for the targeted cell", () => {
  const body = {
    cellId: "region-input",
    contents: { kind: "input", defaultValueString: "South" },
  };
  const request = (action: string) => ({
    method: () => "POST",
    url: () =>
      new URL(`/_agent-native/actions/${action}`, "https://example.test").href,
    postDataJSON: () => body,
  });

  expect(inputSave(request("save-project-cell"), "region-input")).toEqual(body);
  expect(
    inputSave(request("save-project-cell"), "different-input"),
  ).toBeUndefined();
  expect(
    inputSave(request("apply-notebook-operation"), "region-input"),
  ).toBeUndefined();
});
