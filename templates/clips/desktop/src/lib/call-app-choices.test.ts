import { describe, expect, it } from "vitest";
import { CALL_APP_CHOICES, toggleDisabledCallApp } from "./call-app-choices";

describe("toggleDisabledCallApp", () => {
  it("adds a turned-off app once and removes it when turned on", () => {
    expect(toggleDisabledCallApp(undefined, "zoom", false)).toEqual(["zoom"]);
    expect(toggleDisabledCallApp(["zoom"], "zoom", false)).toEqual(["zoom"]);
    expect(toggleDisabledCallApp(["zoom", "meet"], "zoom", true)).toEqual([
      "meet",
    ]);
  });

  it("offers every call app once", () => {
    const keys = CALL_APP_CHOICES.map((choice) => choice.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(
      expect.arrayContaining(["slack", "phone", "whatsapp", "meet", "zoom", "teams"]),
    );
  });
});
