// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";

import {
  readFirstRunStorageSetupDismissal,
  saveFirstRunStorageSetupDismissal,
} from "./first-run-storage-setup";

describe("first-run storage setup dismissal", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("distinguishes an unset dismissal from a saved skip", () => {
    expect(readFirstRunStorageSetupDismissal()).toBe("not-dismissed");
    expect(saveFirstRunStorageSetupDismissal()).toBe("saved");
    expect(readFirstRunStorageSetupDismissal()).toBe("dismissed");
  });
});
