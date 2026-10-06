import { expect, it } from "vitest";

import { readValueOption } from "./run-options.ts";

it("reads one value and ignores an absent option", () => {
  expect(readValueOption(["--seed", "2"], "--seed")).toBe("2");
  expect(readValueOption(["--browser", "webkit"], "--seed")).toBeUndefined();
});

it("rejects missing values and repeated value-taking options", () => {
  expect(() => readValueOption(["--seed"], "--seed")).toThrow(
    "--seed requires a value",
  );
  expect(() => readValueOption(["--seed", "2", "--seed"], "--seed")).toThrow(
    "--seed may be provided only once",
  );
  expect(() => readValueOption(["--seed", "--steps", "500"], "--seed")).toThrow(
    "--seed requires a value",
  );
});
