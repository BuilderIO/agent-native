// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { afterEach, assert, expect, it } from "vitest";

import { i18nCatalog } from "../../i18n";
import {
  button,
  click,
  dispose,
  init,
  input,
  key,
  media,
  mount,
  settle,
} from "../../testing/sidebar-shell/harness";
import { ThemeMenuItems } from "../shell/ThemeMenuItems";
import { WorkspaceCommands } from "./WorkspaceCommands";

afterEach(dispose);

function paletteOptions() {
  const dialog = document.querySelector('[role="dialog"]');
  assert(dialog);
  return [...dialog.querySelectorAll<HTMLElement>('[role="option"]')];
}

function paletteFilterInput() {
  const field = document.querySelector<HTMLInputElement>(
    '[role="dialog"] input[aria-label="Search commands..."]',
  );
  assert(field);
  return field;
}

it("SEARCH-15 exposes System, Light, and Dark theme commands and switches theme in notebook mode", async () => {
  init();
  await mount(
    <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
      <WorkspaceCommands commands={[]} enabled project>
        <div className="nb-root">Notebook</div>
      </WorkspaceCommands>
    </AgentNativeI18nProvider>,
    "/project/project-a/latest",
  );

  const openEvent = await key(window, "p", { ctrlKey: true });
  expect(openEvent.defaultPrevented).toBe(true);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "Preferences",
  );

  const initialOptions = paletteOptions();
  const systemOption = initialOptions.find(
    (entry) => entry.textContent === "Theme: Enable System theme (Light)",
  );
  const lightOption = initialOptions.find(
    (entry) => entry.textContent === "Theme: Enable Light theme",
  );
  const darkOption = initialOptions.find(
    (entry) => entry.textContent === "Theme: Enable Dark theme",
  );
  assert(systemOption);
  assert(lightOption);
  assert(darkOption);
  expect(systemOption.getAttribute("aria-disabled")).toBe("true");
  expect(lightOption.getAttribute("aria-disabled")).not.toBe("true");
  expect(darkOption.getAttribute("aria-disabled")).not.toBe("true");

  await input(paletteFilterInput(), "dark");
  const filteredDark = paletteOptions().find(
    (entry) => entry.textContent === "Theme: Enable Dark theme",
  );
  assert(filteredDark);
  await click(filteredDark);
  await settle();

  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(localStorage.getItem("theme")).toBe("dark");
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(document.documentElement.style.colorScheme).toBe("dark");

  await key(window, "p", { ctrlKey: true });
  const afterDarkOptions = paletteOptions();
  expect(
    afterDarkOptions
      .find((entry) => entry.textContent === "Theme: Enable Dark theme")
      ?.getAttribute("aria-disabled"),
  ).toBe("true");

  await input(paletteFilterInput(), "light");
  const filteredLight = paletteOptions().find(
    (entry) => entry.textContent === "Theme: Enable Light theme",
  );
  assert(filteredLight);
  await click(filteredLight);
  await settle();

  expect(localStorage.getItem("theme")).toBe("light");
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(document.documentElement.classList.contains("light")).toBe(true);
  expect(document.documentElement.style.colorScheme).toBe("light");

  await key(window, "p", { ctrlKey: true });
  const enableSystem = paletteOptions().find(
    (entry) => entry.textContent === "Theme: Enable System theme (Light)",
  );
  assert(enableSystem);
  await click(enableSystem);
  await settle();

  expect(localStorage.getItem("theme")).toBe("system");
  await media({ dark: true });
  expect(document.documentElement.dataset.theme).toBe("dark");

  await key(window, "p", { ctrlKey: true });
  const systemDarkOption = paletteOptions().find(
    (entry) => entry.textContent === "Theme: Enable System theme (Dark)",
  );
  assert(systemDarkOption);
  expect(systemDarkOption.getAttribute("aria-disabled")).toBe("true");
});

it("keeps theme state synchronized across WorkspaceCommands and ThemeMenuItems without stale media overwrites", async () => {
  init({ dark: true });
  await mount(
    <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
      <WorkspaceCommands commands={[]} enabled project={false}>
        <ThemeMenuItems />
      </WorkspaceCommands>
    </AgentNativeI18nProvider>,
    "/home",
  );

  await click(button("Dark"));
  expect(localStorage.getItem("theme")).toBe("dark");
  expect(document.documentElement.dataset.theme).toBe("dark");

  await media({ dark: false });
  expect(document.documentElement.dataset.theme).toBe("dark");

  await key(window, "p", { ctrlKey: true });
  const darkItem = paletteOptions().find(
    (entry) => entry.textContent === "Theme: Enable Dark theme",
  );
  const lightItem = paletteOptions().find(
    (entry) => entry.textContent === "Theme: Enable Light theme",
  );
  assert(darkItem);
  assert(lightItem);
  expect(darkItem.getAttribute("aria-disabled")).toBe("true");
  expect(lightItem.getAttribute("aria-disabled")).not.toBe("true");

  await click(lightItem);
  await settle();

  expect(document.documentElement.dataset.theme).toBe("light");
  expect(button("Light").classList.contains("is-active")).toBe(true);
  expect(button("Dark").classList.contains("is-active")).toBe(false);
});

it("SEARCH-16 shows empty state for unmatched queries and closes on Escape", async () => {
  init();
  await mount(
    <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
      <WorkspaceCommands commands={[]} enabled project>
        <div className="nb-root">Notebook</div>
      </WorkspaceCommands>
    </AgentNativeI18nProvider>,
    "/project/project-a/latest",
  );

  await key(window, "p", { ctrlKey: true });
  const dialog = document.querySelector('[role="dialog"]');
  assert(dialog);
  await input(paletteFilterInput(), "qqzzxx");
  expect(paletteOptions()).toHaveLength(0);
  expect(dialog.textContent).toContain("No commands match that search");

  await key(paletteFilterInput(), "Escape");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
