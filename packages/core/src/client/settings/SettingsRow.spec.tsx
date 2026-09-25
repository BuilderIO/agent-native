// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SettingsGroup, SettingsRow } from "./SettingsRow.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("SettingsGroup / SettingsRow", () => {
  it("renders each row under its own anchor id", async () => {
    await act(async () => {
      root.render(
        <SettingsGroup id="preferences" title="Preferences">
          <SettingsRow
            id="language"
            label="Interface language"
            description="Language used across the app."
            control={<button type="button">English</button>}
          />
          <SettingsRow
            id="notifications"
            label="Email notifications"
            control={<input type="checkbox" />}
          />
        </SettingsGroup>,
      );
    });

    expect(container.querySelector("#preferences")).not.toBeNull();
    expect(container.querySelector("#language")).not.toBeNull();
    expect(container.querySelector("#notifications")).not.toBeNull();
    expect(container.textContent).toContain("Interface language");
    expect(container.textContent).toContain("Language used across the app.");
    expect(
      container.querySelector(".agent-native-settings-row"),
    ).not.toBeNull();
    expect(
      container.querySelector(".agent-native-settings-row__layout"),
    ).not.toBeNull();
    expect(
      container.querySelector(".agent-native-settings-row__main"),
    ).not.toBeNull();
    expect(
      container.querySelector(".agent-native-settings-row__control"),
    ).not.toBeNull();
    expect(container.querySelector("#language button")?.textContent).toBe(
      "English",
    );
  });

  it("omits the header when the group has no title or description", async () => {
    await act(async () => {
      root.render(
        <SettingsGroup>
          <SettingsRow id="only" label="Only setting" />
        </SettingsGroup>,
      );
    });

    expect(container.querySelector("header")).toBeNull();
  });
});
