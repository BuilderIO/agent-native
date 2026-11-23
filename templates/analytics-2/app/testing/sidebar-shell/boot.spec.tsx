import { getLocaleInitScript } from "@agent-native/core/client/i18n";
import { getThemeInitScript } from "@agent-native/core/client/theme";
import { usePersistentSidebarCollapsed } from "@agent-native/toolkit/app-shell/use-persistent-sidebar-collapsed";
import { AppShellSkeleton } from "@agent-native/toolkit/app/shared/AppShellSkeleton";
// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { ThemeMenuItems } from "../../components/shell/ThemeMenuItems";
import { WorkspaceShell } from "../../components/shell/WorkspaceShell";
import { shellProps, workspaceRows, themeRows } from "./fixtures";
import {
  init,
  dispose,
  mount,
  envelope,
  frozen,
  capture,
  button,
  click,
  media,
} from "./harness";
afterEach(dispose);
function boot() {
  const script = getThemeInitScript();
  new Function("window", "document", "localStorage", "sessionStorage", script)(
    window,
    document,
    localStorage,
    sessionStorage,
  );
}
it.each([
  null,
  "light",
  "dark",
  "system",
  "auto",
  "malformed",
  "0",
  "1",
  "true",
  "false",
])("records boot/first-render/settled theme input %s", async (stored) => {
  for (const systemDark of [false, true])
    for (const viewport of [1280, 1050]) {
      init({
        width: viewport,
        dark: systemDark,
        storage: stored === null ? {} : { theme: stored },
      });
      boot();
      const phases: { phase: string; root: ReturnType<typeof envelope> }[] = [
        { phase: "boot", root: envelope() },
      ];
      await mount(
        <>
          <WorkspaceShell {...shellProps()} />
          <ThemeMenuItems />
        </>,
        "/home",
        () => phases.push({ phase: "ready", root: envelope() }),
      );
      phases.push({ phase: "settled", root: envelope() });
      const name = `boot-theme-${stored ?? "absent"}-${systemDark ? "dark" : "light"}-${viewport}`;
      frozen(name, { stored, systemDark, viewport, phases });
      capture(`${name}-mounted`, [...workspaceRows, ...themeRows], {
        host: "WorkspaceShell + mounted ThemeMenuItems",
        stored,
        systemDark,
        viewport,
      });
      expect(phases.map((p) => p.phase)).toEqual(["boot", "ready", "settled"]);
      expect(
        document.querySelector(".ws-sidebar")?.getAttribute("data-closed"),
      ).toBe(String(viewport <= 1050));
      expect(localStorage.getItem("theme")).toBe(
        stored === "auto"
          ? "system"
          : ["light", "dark", "system"].includes(stored ?? "")
            ? stored
            : null,
      );
      await dispose();
    }
});
it("records system media transition and explicit theme persistence", async () => {
  init();
  boot();
  await mount(<ThemeMenuItems />);
  await media({ dark: true });
  expect(document.documentElement.dataset.theme).toBe("dark");
  await click(button("Light"));
  await media({ dark: false });
  expect(localStorage.getItem("theme")).toBe("light");
  await media({ dark: true });
  expect(document.documentElement.dataset.theme).toBe("light");
  capture("theme-explicit-over-media", themeRows, {
    preference: "light",
    systemDark: true,
  });
});
it.each([null, "0", "1", "true", "false", "malformed"])(
  "records toolkit boolean codec without inventing app collapse key %s",
  async (stored) => {
    init({
      storage: stored === null ? {} : { "app-sidebar-default-key": stored },
    });
    boot();
    const phases: unknown[] = [{ phase: "boot", root: envelope() }];
    function Probe() {
      const state = usePersistentSidebarCollapsed({
        storageKey: "app-sidebar-default-key",
        defaultCollapsed: false,
      });
      return (
        <button
          data-collapsed={String(state.collapsed)}
          data-persistence={state.persistenceStatus}
          onClick={() => state.setCollapsed(!state.collapsed)}
        >
          Toggle codec witness
        </button>
      );
    }
    await mount(<Probe />, "/home", () =>
      phases.push({
        phase: "ready",
        root: envelope(),
        marker: document.querySelector("[data-collapsed]")?.outerHTML,
      }),
    );
    phases.push({
      phase: "settled",
      root: envelope(),
      marker: document.querySelector("[data-collapsed]")?.outerHTML,
    });
    expect(
      document
        .querySelector("[data-collapsed]")
        ?.getAttribute("data-collapsed"),
    ).toBe(String(stored === "true"));
    await click(button("Toggle codec witness"));
    const first = localStorage.getItem("app-sidebar-default-key");
    await click(button("Toggle codec witness"));
    const second = localStorage.getItem("app-sidebar-default-key");
    expect([first, second]).toEqual(
      stored === "true" ? ["false", "true"] : ["true", "false"],
    );
    frozen(`codec-${stored ?? "absent"}`, {
      stored,
      owner: "toolkit hook only; WorkspaceShell never mounts this controller",
      phases,
      first,
      second,
      after: envelope(),
    });
  },
);
it("captures the provider's welcome skeleton at its real renderer boundary", async () => {
  init();
  await mount(<AppShellSkeleton layout="welcome" />);
  capture("toolkit-boot-skeleton", ["shell.boot.loading"], {
    host: "AppShellSkeleton",
    layout: "welcome",
    providerGate: "not mounted",
  });
  expect(
    document.querySelector('[data-agent-native-app-skeleton-layout="welcome"]'),
  ).not.toBeNull();
});
it("records unavailable toolkit storage distinctly from invalid storage", async () => {
  init();
  const get = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  let state: ReturnType<typeof usePersistentSidebarCollapsed> | undefined;
  function Probe() {
    state = usePersistentSidebarCollapsed({
      storageKey: "app-sidebar-default-key",
    });
    return (
      <button
        data-persistence={state.persistenceStatus}
        onClick={() => state?.setCollapsed(true)}
      >
        Toggle unavailable storage
      </button>
    );
  }
  await mount(<Probe />);
  expect(state?.persistenceStatus).toBe("unavailable");
  get.mockRestore();
  vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  await click(button("Toggle unavailable storage"));
  expect(state?.persistenceStatus).toBe("unavailable");
  frozen("codec-unavailable", {
    collapsed: state?.collapsed,
    status: state?.persistenceStatus,
    root: envelope(),
  });
});
it.each([null, "light", "dark", "system", "malformed"])(
  "records both inline boot scripts before first mount for %s",
  async (stored) => {
    init({
      width: 1050,
      dark: true,
      storage: stored === null ? {} : { theme: stored },
    });
    boot();
    new Function(
      "window",
      "document",
      "localStorage",
      "navigator",
      getLocaleInitScript(),
    )(window, document, localStorage, navigator);
    const phases = [{ phase: "boot", root: envelope() }];
    await mount(<WorkspaceShell {...shellProps()} />, "/home", () =>
      phases.push({ phase: "ready", root: envelope() }),
    );
    phases.push({ phase: "settled", root: envelope() });
    frozen(`app-inline-boot-${stored ?? "absent"}`, {
      scripts: ["theme", "locale"],
      stored,
      viewport: 1050,
      systemDark: true,
      phases,
    });
  },
);
