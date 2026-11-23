// @vitest-environment happy-dom
import { readFileSync } from "node:fs";

import { getLocaleInitScript } from "@agent-native/core/client/i18n";
import { getThemeInitScript } from "@agent-native/core/client/theme";
import {
  captureShellSnapshot,
  compareShellSnapshots,
  shellTags,
  type ShellSemanticSnapshot,
} from "@agent-native/toolkit/app-shell/shell-testing";
import { act } from "react";
import { afterAll, afterEach, expect, it } from "vitest";

import { WorkspaceShell } from "../../../components/shell/WorkspaceShell";
import { shellProps } from "../../../testing/sidebar-shell/fixtures";
import {
  button,
  click,
  input,
  key,
  media,
  normalize,
  navigate,
  dispose,
  envelope,
  init,
  mount,
} from "../../../testing/sidebar-shell/harness";
import {
  bootFixtures,
  themeChoicesModel,
} from "../../../testing/sidebar-shell/models/lifecycle";
import { ScopedWorkspaceController } from "../../../testing/sidebar-shell/models/scoped-workspace";
import {
  workspaceFixtures,
  type WorkspaceFixture,
} from "../../../testing/sidebar-shell/models/workspace";
import evidence from "../../../testing/sidebar-shell/round4-reference-evidence.json";
import { AppShell } from "./AppShell";
import { ThemeMenuEntries } from "./ThemeMenuEntries";

afterEach(dispose);
const comparedEnvelopes = new Set<string>();
const comparedPhases = new Set<string>();
afterAll(() => {
  expect([...comparedEnvelopes].sort()).toEqual(
    evidence.envelopeWitnesses.map((witness) => witness.fixture).sort(),
  );
  expect([...comparedPhases].sort()).toEqual(
    evidence.phaseWitnesses.map((witness) => witness.fixture).sort(),
  );
});
function Fixture({
  fixture,
  standaloneTheme = false,
}: {
  fixture?: WorkspaceFixture;
  standaloneTheme?: boolean;
}) {
  return (
    <ScopedWorkspaceController
      {...(fixture ? { fixture } : {})}
      standaloneTheme={standaloneTheme}
    >
      {(model) => {
        const choices = themeChoicesModel(model);
        return (
          <>
            <AppShell model={model} />
            {standaloneTheme ? (
              <ThemeMenuEntries
                model={choices.navigation}
                effects={choices.effects}
              />
            ) : null}
          </>
        );
      }}
    </ScopedWorkspaceController>
  );
}
function frozen(name: string) {
  return JSON.parse(
    readFileSync(
      `app/testing/sidebar-shell/reference-fixtures/${name}.json`,
      "utf8",
    ),
  ) as {
    markup: string;
    root: ReturnType<typeof envelope>;
    phases: { phase: string; root: unknown }[];
  };
}
it.each([null, "light", "dark", "system", "malformed"])(
  "retains both inline scripts and the closed-menu lifecycle for %s",
  async (stored) => {
    init({
      width: 1050,
      dark: true,
      storage: stored === null ? {} : { theme: stored },
    });
    new Function(
      "window",
      "document",
      "localStorage",
      "sessionStorage",
      getThemeInitScript(),
    )(window, document, localStorage, sessionStorage);
    new Function(
      "window",
      "document",
      "localStorage",
      "navigator",
      getLocaleInitScript(),
    )(window, document, localStorage, navigator);
    const phases = [{ phase: "boot", root: envelope() }];
    await mount(<Fixture />, "/home", () =>
      phases.push({ phase: "ready", root: envelope() }),
    );
    phases.push({ phase: "settled", root: envelope() });
    const name = `app-inline-boot-${stored ?? "absent"}`;
    expect(phases).toEqual(frozen(name).phases);
    comparedPhases.add(name);
  },
);

function markup(root: ParentNode, selector = ".ws-popover") {
  return normalize(
    [...root.querySelectorAll(selector)]
      .map((element) => element.outerHTML)
      .join(""),
  );
}
function observeThemes(root: ParentNode, stored: string | null) {
  const surface = document.createElement("div");
  for (const control of root.querySelectorAll<HTMLButtonElement>(
    ".ws-submenu > button",
  )) {
    const label = control.querySelector(".ws-menu-label")?.textContent;
    if (
      !label ||
      !(label.startsWith("System (") || label === "Light" || label === "Dark")
    )
      continue;
    const clone = control.cloneNode(true) as Element;
    const value = label.startsWith("System (") ? "system" : label.toLowerCase();
    for (const [key, attribute] of Object.entries(
      shellTags(
        { id: `sidebar.theme.${value}` },
        "sidebar.item",
        "theme-choices",
      ),
    ))
      clone.setAttribute(key, attribute);
    surface.append(clone);
  }
  return captureShellSnapshot(surface, {
    visible: () => true,
    observe(identity, elements, order): ShellSemanticSnapshot {
      const control = elements[0];
      if (!(control instanceof HTMLButtonElement))
        throw new Error("Missing observed theme button");
      return {
        ...identity,
        part: "sidebar.item",
        containerId: "theme-choices",
        order,
        present: true,
        family: control.tagName.toLowerCase(),
        role: control.getAttribute("role"),
        expanded: null,
        name: control.textContent?.trim() ?? "",
        value: null,
        choices: [],
        enabled: !control.disabled,
        selected: control.classList.contains("is-active"),
        checked: null,
        shortcut: null,
        badge: null,
        effect: { kind: "write", target: "theme", result: stored },
        read: { status: "ready", message: null, recovery: null },
        action: { pending: false, error: null, recovery: null },
        keyboard: {
          reachable: control.tabIndex !== -1,
          operable: !control.disabled,
        },
      };
    },
  });
}
function compareCapture(name: string) {
  comparedEnvelopes.add(name);
  const expected = frozen(name);
  const baseline = document.createElement("div");
  baseline.innerHTML = expected.markup;
  const actual = envelope();
  expect(actual, `${name}: root and exact storage events`).toEqual(
    expected.root,
  );
  expect(markup(document.body), `${name}: menu markup`).toBe(markup(baseline));
  expect(
    compareShellSnapshots(
      observeThemes(baseline, expected.root.storage.local.theme ?? null),
      observeThemes(document.body, actual.storage.local.theme ?? null),
    ).differences,
  ).toEqual([]);
}
function panel(label: string) {
  const panel = document.querySelector<HTMLElement>(
    `[role="menu"][aria-label="${label}"]`,
  );
  if (!panel) throw new Error(`Missing menu: ${label}`);
  return panel;
}
it("replays the frozen desktop menu journey with exact theme-owner reads, writes and media", async () => {
  init();
  await mount(<Fixture />);
  compareCapture("desktop-default");
  await click(
    button(
      "Test workspace",
      document.querySelector(".ws-sidebar") ?? document.body,
    ),
  );
  compareCapture("workspace-menu");
  const search = document.querySelector<HTMLInputElement>(
    'input[aria-label="Search workspaces"]',
  );
  if (!search) throw new Error("Missing workspace search");
  await input(search, "missing");
  compareCapture("workspace-search-empty");
  await input(search, "test");
  compareCapture("workspace-search-match");
  await click(button("Preferences"));
  compareCapture("workspace-preferences");
  await key(panel("Test workspace menu"), "Escape");
  await click(button("Test Person account menu"));
  compareCapture("account-help");
  await click(button("Theme"));
  compareCapture("account-theme-system");
  for (const theme of ["Dark", "Light", "System (Light)"]) {
    await click(button(theme));
    compareCapture(
      `account-theme-${theme.startsWith("System") ? "system-selected" : theme.toLowerCase()}`,
    );
  }
  await media({ dark: true });
  compareCapture("account-theme-system-dark");
  await key(panel("Account menu"), "Escape");
  await click(button("Notifications"));
  compareCapture("notifications-unbound");
  await click(button("All notifications"));
  compareCapture("notifications-filter");
  await click(button("Unread only"));
  compareCapture("notifications-unread");
  const notifications = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!notifications) throw new Error("Missing notifications");
  await key(notifications, "Escape");
  await click(button("Create new"));
  compareCapture("create-menu");
  await key(panel("Create new"), "Escape");
  await click(button("More"));
  compareCapture("more-manager");
});
it.each(["light", "dark", "system"])(
  "replays all frozen mobile menu roots for %s",
  async (theme) => {
    init({ width: 700, dark: theme === "system", storage: { theme } });
    await mount(<Fixture />);
    await click(button("Open navigation"));
    for (const [label, id] of [
      ["Test Person account menu", "account"],
      ["More", "more"],
      ["Create new", "create"],
    ] as const) {
      await click(button(label));
      if (id === "account") await click(button("Theme"));
      compareCapture(`mobile-${theme}-${id}`);
      const popover = document.querySelector<HTMLElement>(".ws-popover");
      if (!popover) throw new Error("Missing mobile popover");
      await key(popover, "Escape");
    }
  },
);
async function remountJourney(reference: boolean, mobile: boolean) {
  init({ width: mobile ? 700 : 1280, storage: { theme: "system" } });
  await mount(reference ? <Fixture /> : <WorkspaceShell {...shellProps()} />);
  const observations: { root: ReturnType<typeof envelope>; markup: string }[] =
    [];
  const snap = () =>
    observations.push({ root: envelope(), markup: markup(document.body) });
  const workspace = () =>
    button(
      "Test workspace",
      document.querySelector(mobile ? ".ws-mobile-nav" : ".ws-sidebar") ??
        document.body,
    );
  snap();
  await media({ dark: true });
  snap();
  await click(workspace());
  snap();
  await click(button("Preferences"));
  snap();
  await click(button("Light"));
  snap();
  await key(panel("Test workspace menu"), "Escape");
  await media({ dark: false });
  snap();
  await act(async () => localStorage.setItem("theme", "dark"));
  await click(workspace());
  snap();
  await click(button("Preferences"));
  snap();
  await key(button("Preferences"), "ArrowLeft");
  await media({ dark: true });
  snap();
  await click(button("Preferences"));
  snap();
  await dispose();
  return observations;
}
it.each([false, true])(
  "matches original submenu unmount, remount and independent workspace owner mobile=%s",
  async (mobile) => {
    const expected = await remountJourney(false, mobile);
    const actual = await remountJourney(true, mobile);
    expect(actual).toEqual(expected);
  },
);

it.each(bootFixtures)(
  "retains the explicit mounted-owner $name phases",
  async (fixture) => {
    init({
      width: fixture.viewport,
      dark: fixture.systemDark,
      storage: fixture.stored === null ? {} : { theme: fixture.stored },
    });
    new Function(
      "window",
      "document",
      "localStorage",
      "sessionStorage",
      getThemeInitScript(),
    )(window, document, localStorage, sessionStorage);
    const phases = [{ phase: "boot", root: envelope() }];
    await mount(<Fixture standaloneTheme />, "/home", () =>
      phases.push({ phase: "ready", root: envelope() }),
    );
    phases.push({ phase: "settled", root: envelope() });
    expect(phases).toEqual(frozen(fixture.name).phases);
    expect(envelope()).toEqual(frozen(`${fixture.name}-mounted`).root);
  },
);

it.each(workspaceFixtures)(
  "keeps all scoped model regions for $name",
  async (fixture) => {
    init({
      width: fixture.width ?? 1280,
      dark: fixture.dark ?? false,
      storage: fixture.theme ? { theme: fixture.theme } : {},
    });
    await mount(
      <Fixture fixture={fixture} />,
      fixture.name.startsWith("route-") ? "/home" : fixture.path,
    );
    if (fixture.name.startsWith("route-") && fixture.path)
      await act(async () => navigate(fixture.path ?? "/home"));
    if (fixture.drawerOpen && (fixture.width ?? 1280) <= 1050)
      await click(button("Open navigation"));
    const baseline = document.createElement("div");
    baseline.innerHTML = frozen(fixture.name).markup;
    // The setup parent is a custom owner; its body has no renderer credit.
    if (!baseline.querySelector(".ws-context-card"))
      expect(markup(document.body, ".ws-sidebar"), fixture.name).toBe(
        markup(baseline, ".ws-sidebar"),
      );
    for (const selector of [
      ".ws-sidebar-header",
      ".ws-quick-create",
      ".ws-search-slot",
      ".ws-tabs",
      ".ws-tabs-scroll > a",
      ".ws-tabs-scroll > button",
      ".ws-sections",
      ".ws-footer",
      ".ws-popover",
    ]) {
      expect(
        markup(document.body, selector),
        `${fixture.name}: ${selector}`,
      ).toBe(markup(baseline, selector));
    }
  },
);
