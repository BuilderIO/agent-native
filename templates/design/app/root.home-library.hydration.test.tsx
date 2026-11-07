// @vitest-environment happy-dom

import { act, useLayoutEffect, type ReactNode } from "react";
import { hydrateRoot, type Root as ReactRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/toolkit/app/providers", () => ({
  AppProviders: ({ clientOnlyFallback }: { clientOnlyFallback: ReactNode }) =>
    clientOnlyFallback,
}));

vi.mock("@/components/ui/toolkit-provider", () => ({
  AppToolkitProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@agent-native/toolkit/app/shared", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/toolkit/app/shared")
  >()),
  AppShellSkeleton: ({
    firstPaintHome,
  }: {
    firstPaintHome: { library: ReactNode };
  }) => firstPaintHome.library,
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useSession: () => ({ session: null }),
}));

vi.mock("@agent-native/core/client/analytics", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/analytics")
  >()),
  configureTracking: vi.fn(),
}));

import DesignRoot from "./root";

let container: HTMLDivElement;
let root: ReactRoot | undefined;

function Home({
  search = "",
  clickBeforeEffects = false,
}: {
  search?: string;
  clickBeforeEffects?: boolean;
}) {
  useLayoutEffect(() => {
    if (clickBeforeEffects) {
      container
        .querySelector<HTMLButtonElement>(
          '[data-design-home-library-tab="templates"]',
        )
        ?.click();
    }
  }, [clickBeforeEffects]);
  return (
    <MemoryRouter initialEntries={[`/home${search}`]}>
      <DesignRoot />
    </MemoryRouter>
  );
}

function selectedTab() {
  return container
    .querySelector('[role="tab"][aria-selected="true"]')
    ?.getAttribute("data-design-home-library-tab");
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-design-home-library-tab");
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container.remove();
  document.documentElement.removeAttribute("data-design-home-library-tab");
});

describe("Design first-paint home library hydration", () => {
  async function hydrate({
    search = "",
    clickBeforeEffects = false,
    hasRecents = true,
    handoff,
  }: {
    search?: string;
    clickBeforeEffects?: boolean;
    hasRecents?: boolean;
    handoff?: "templates" | "recent";
  } = {}) {
    container.innerHTML = renderToString(<Home search={search} />);
    expect(selectedTab()).toBe("templates");
    window.localStorage.setItem("design-home-has-recents", String(hasRecents));
    if (handoff) {
      document.documentElement.setAttribute(
        "data-design-home-library-tab",
        handoff,
      );
    }
    const recoverableError = vi.fn();
    await act(async () => {
      root = hydrateRoot(
        container,
        <Home search={search} clickBeforeEffects={clickBeforeEffects} />,
        { onRecoverableError: recoverableError },
      );
    });
    expect(recoverableError).not.toHaveBeenCalled();
  }

  it("hydrates the impersonal shell before restoring cached recents", async () => {
    await hydrate();
    expect(selectedTab()).toBe("recent");
  });

  it("preserves a pre-hydration Templates handoff over cached recents", async () => {
    await hydrate({ handoff: "templates" });
    expect(selectedTab()).toBe("templates");
  });

  it("preserves a pre-hydration Recent handoff without cached recents", async () => {
    await hydrate({ handoff: "recent", hasRecents: false });
    expect(selectedTab()).toBe("recent");
  });

  it("preserves a Templates click before restoration effects run", async () => {
    await hydrate({ clickBeforeEffects: true });
    expect(selectedTab()).toBe("templates");
  });

  it("preserves a pre-hydration Templates handoff for save-template", async () => {
    await hydrate({
      search: "?gettingStarted=save-template",
      handoff: "templates",
    });
    expect(selectedTab()).toBe("templates");
  });

  it("restores Recent for the save-template destination", async () => {
    await hydrate({
      search: "?gettingStarted=save-template",
      hasRecents: false,
    });
    expect(selectedTab()).toBe("recent");
  });
});
