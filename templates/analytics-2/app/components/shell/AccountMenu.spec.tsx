// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, assert, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (_key: string, options: { defaultValue: string }) =>
    options.defaultValue,
}));

import { shellProps } from "../../testing/sidebar-shell/fixtures";
import {
  button,
  click,
  dispose,
  init,
  mount,
} from "../../testing/sidebar-shell/harness";
import { AccountMenu } from "./AccountMenu";

afterEach(dispose);

it("VIEWS-09 row 125: account help links and Theme", async () => {
  init();
  await mount(<AccountMenu user={shellProps().user} />);
  await click(button("Test Person account menu"));
  const menu = document.querySelector(
    '[role="menu"][aria-label="Account menu"]',
  );
  assert(menu);
  expect(menu.textContent).toContain("Theme");
  expect(menu.textContent).not.toContain("Theme family");
  const links = [
    ...menu.querySelectorAll<HTMLAnchorElement>('a[role="menuitem"]'),
  ];
  expect(links.map((link) => link.textContent?.trim())).toEqual([
    "Documentation",
    "Changelog",
    "Agent-Native status",
    "Email support",
  ]);
  for (const link of links) {
    expect(
      link.querySelector('.ws-menu-trailing svg[aria-hidden="true"]'),
    ).not.toBeNull();
    if (link.protocol !== "mailto:") {
      expect(link.target).toBe("_blank");
      expect(link.rel).toBe("noopener noreferrer");
    }
  }
  expect(links.map((link) => link.getAttribute("href"))).toEqual([
    "https://www.agent-native.com/docs/",
    "https://github.com/BuilderIO/agent-native/releases",
    "https://status.builder.io/",
    "mailto:support@builder.io",
  ]);
  expect(menu.querySelector('[role="separator"]')).not.toBeNull();
});

it("NAV-01: Escape closes Theme submenu before closing Account menu", async () => {
  init();
  await mount(<AccountMenu user={shellProps().user} />);
  await click(button("Test Person account menu"));
  const menu = document.querySelector(
    '[role="menu"][aria-label="Account menu"]',
  );
  assert(menu);
  const themeButton = [
    ...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ].find((el) => el.textContent?.includes("Theme"));
  assert(themeButton);
  await act(async () => {
    themeButton.click();
  });
  expect(document.querySelectorAll('[role="menu"]')).toHaveLength(2);
  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
  expect(
    document.querySelector('[role="menu"][aria-label="Account menu"]'),
  ).not.toBeNull();
});

it("row 574: clicking Theme after pointer hover keeps submenu open and switches to Light mode", async () => {
  init({ dark: true, storage: { theme: "dark" } });
  document.documentElement.classList.add("dark");
  await mount(<AccountMenu user={shellProps().user} />);
  await click(button("Test Person account menu"));
  const menu = document.querySelector(
    '[role="menu"][aria-label="Account menu"]',
  );
  assert(menu);
  const themeButton = [
    ...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ].find((el) => el.textContent?.includes("Theme"));
  assert(themeButton);
  const wrap = themeButton.closest(".ws-submenu-wrap");
  assert(wrap);

  await act(async () => {
    wrap.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
  expect(themeButton.getAttribute("aria-expanded")).toBe("true");

  await act(async () => {
    themeButton.click();
  });
  expect(themeButton.getAttribute("aria-expanded")).toBe("true");
  const submenu = document.querySelector('[role="menu"][aria-label="Theme"]');
  assert(submenu);

  await act(async () => {
    wrap.dispatchEvent(
      new MouseEvent("mouseout", { bubbles: true, relatedTarget: menu }),
    );
  });
  expect(
    document.querySelector('[role="menu"][aria-label="Theme"]'),
  ).not.toBeNull();

  const lightItem = [
    ...submenu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ].find((el) => el.textContent?.trim() === "Light");
  assert(lightItem);
  await click(lightItem);
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  expect(lightItem.classList.contains("is-active")).toBe(true);

  await act(async () => {
    themeButton.click();
  });
  expect(
    document.querySelector('[role="menu"][aria-label="Theme"]'),
  ).toBeNull();
});

it("row 574: hover-only Theme submenu still closes on pointer leave without click", async () => {
  init();
  await mount(<AccountMenu user={shellProps().user} />);
  await click(button("Test Person account menu"));
  const menu = document.querySelector(
    '[role="menu"][aria-label="Account menu"]',
  );
  assert(menu);
  const themeButton = [
    ...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ].find((el) => el.textContent?.includes("Theme"));
  assert(themeButton);
  const wrap = themeButton.closest(".ws-submenu-wrap");
  assert(wrap);

  await act(async () => {
    wrap.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
  expect(
    document.querySelector('[role="menu"][aria-label="Theme"]'),
  ).not.toBeNull();

  await act(async () => {
    wrap.dispatchEvent(
      new MouseEvent("mouseout", { bubbles: true, relatedTarget: menu }),
    );
  });
  expect(
    document.querySelector('[role="menu"][aria-label="Theme"]'),
  ).toBeNull();
});

it("row 574: pointerdown outside click-pinned Theme submenu closes it", async () => {
  init();
  await mount(<AccountMenu user={shellProps().user} />);
  await click(button("Test Person account menu"));
  const menu = document.querySelector(
    '[role="menu"][aria-label="Account menu"]',
  );
  assert(menu);
  const themeButton = [
    ...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ].find((el) => el.textContent?.includes("Theme"));
  assert(themeButton);
  const docLink = [
    ...menu.querySelectorAll<HTMLAnchorElement>('a[role="menuitem"]'),
  ].find((el) => el.textContent?.includes("Documentation"));
  assert(docLink);

  await act(async () => {
    themeButton.click();
  });
  expect(
    document.querySelector('[role="menu"][aria-label="Theme"]'),
  ).not.toBeNull();

  await act(async () => {
    docLink.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  });
  expect(
    document.querySelector('[role="menu"][aria-label="Theme"]'),
  ).toBeNull();
  expect(
    document.querySelector('[role="menu"][aria-label="Account menu"]'),
  ).not.toBeNull();
});
