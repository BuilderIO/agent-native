// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { i18nCatalog } from "@/i18n";

import { HomePromptSection } from "./hero";
import { HomePage } from "./HomePage";
import type { HomePageProps } from "./types";

vi.mock("@agent-native/toolkit/hooks", () => ({
  useIsMobile: () => false,
}));

function baseHomeProps(overrides: Partial<HomePageProps> = {}): HomePageProps {
  return {
    user: { id: "u-1", name: "QA Analyst", email: "qa@workspace.test" },
    workspace: { id: "ws-1", name: "Workspace" },
    contextProgress: null,
    recents: {
      projects: { kind: "project", enabled: true, status: "ready", rows: [] },
      threads: { kind: "thread", enabled: true, status: "ready", rows: [] },
      explorations: {
        kind: "exploration",
        enabled: true,
        status: "ready",
        rows: [],
      },
      data: { kind: "data", enabled: true, status: "ready", rows: [] },
    },
    favorites: null,
    popular: null,
    agentComposer: <textarea aria-label="Prompt composer" />,
    callbacks: {
      onOpenContextStudio: () => {},
      onBrowseProjects: () => {},
      canAnalyzeInNotebook: true,
      canGenerateApp: true,
      onSelectIntent: () => {},
    },
    ...overrides,
  };
}

describe("Home prompt actions tooltips, icons, active state, and dynamic title", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.innerHTML = "";
  });

  function renderHero(activeIntent?: "notebook" | "app" | null) {
    const onSelectIntent = vi.fn();
    act(() => {
      root.render(
        <AgentNativeI18nProvider
          catalog={i18nCatalog}
          persistPreference={false}
        >
          <HomePromptSection
            user={{ id: "u-1", name: "QA Analyst", email: "qa@workspace.test" }}
            title="What do you want to know?"
            activeIntent={activeIntent}
            agentComposer={<textarea aria-label="Prompt composer" />}
            contextProgress={null}
            contextProgressPending={false}
            callbacks={{
              onOpenContextStudio: () => {},
              onBrowseProjects: () => {},
              canAnalyzeInNotebook: true,
              canGenerateApp: true,
              onSelectIntent,
            }}
          />
        </AgentNativeI18nProvider>,
      );
    });
    return { onSelectIntent };
  }

  function findAction(label: string): HTMLButtonElement {
    const button = [
      ...host.querySelectorAll<HTMLButtonElement>(".ws-home-prompt-action"),
    ].find((el) => el.textContent === label);
    expect(button, `Expected action button "${label}"`).toBeDefined();
    return button!;
  }

  it("shows Hex tooltip copy on focus for Ask, Analyze in a notebook, and Generate an app", async () => {
    renderHero(null);

    const cases = [
      {
        label: "Ask",
        header: "Explore ad hoc questions",
        body: "Quickly explore, analyze, and visualize data in a conversational thread.",
      },
      {
        label: "Analyze in a notebook",
        header: "Deep dive in a data notebook",
        body: "Build complex queries, collaborate, and explore with no-code tools in an agentic notebook interface.",
      },
      {
        label: "Generate an app",
        header: "Generate a custom data app",
        body: "Create and publish fully customizable interactive apps powered by your trusted data.",
      },
    ];

    for (const item of cases) {
      const button = findAction(item.label);
      expect(button.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      await act(async () => {
        button.focus();
      });
      const tooltip = document.querySelector('[role="tooltip"]');
      expect(tooltip?.textContent).toContain(item.header);
      expect(tooltip?.textContent).toContain(item.body);
      await act(async () => {
        button.blur();
      });
    }
  });

  it("reflects activeIntent on aria-pressed and active styling", () => {
    renderHero(null);
    expect(findAction("Ask").getAttribute("aria-pressed")).toBe("true");
    expect(findAction("Ask").classList.contains("is-active")).toBe(true);
    expect(
      findAction("Analyze in a notebook").getAttribute("aria-pressed"),
    ).toBe("false");
    expect(findAction("Generate an app").getAttribute("aria-pressed")).toBe(
      "false",
    );

    renderHero("notebook");
    expect(findAction("Ask").getAttribute("aria-pressed")).toBe("false");
    expect(
      findAction("Analyze in a notebook").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      findAction("Analyze in a notebook").classList.contains("is-active"),
    ).toBe(true);

    renderHero("app");
    expect(findAction("Generate an app").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(findAction("Generate an app").classList.contains("is-active")).toBe(
      true,
    );
  });

  it("updates HomePage hero heading with activeIntent while preserving explicit promptTitle overrides", () => {
    const renderPage = (overrides: Partial<HomePageProps>) =>
      act(() => {
        root.render(
          <AgentNativeI18nProvider
            catalog={i18nCatalog}
            persistPreference={false}
          >
            <MemoryRouter>
              <HomePage {...baseHomeProps(overrides)} />
            </MemoryRouter>
          </AgentNativeI18nProvider>,
        );
      });

    renderPage({ activeIntent: null });
    expect(host.querySelector(".ws-home-title")?.textContent).toBe(
      "What do you want to know?",
    );

    renderPage({ activeIntent: "notebook" });
    expect(host.querySelector(".ws-home-title")?.textContent).toBe(
      "What do you want to analyze?",
    );

    renderPage({ activeIntent: "app" });
    expect(host.querySelector(".ws-home-title")?.textContent).toBe(
      "What do you want to build?",
    );

    renderPage({ activeIntent: "app", promptTitle: "Custom heading" });
    expect(host.querySelector(".ws-home-title")?.textContent).toBe(
      "Custom heading",
    );
  });
});
