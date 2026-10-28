// @vitest-environment happy-dom

import { IconHome } from "@tabler/icons-react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { consumeFirstPaintPromptDraft } from "../../app-shell/first-paint-prompt-draft.js";
import { AppShellSkeleton } from "./AppShellSkeleton.js";
import type { AppShellFirstPaintHome } from "./AppShellSkeleton.js";

function render(layout: Parameters<typeof AppShellSkeleton>[0]["layout"]) {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    <AppShellSkeleton layout={layout} />,
  );
  return container.querySelector<HTMLElement>(
    "[data-agent-native-app-skeleton]",
  )!;
}

describe("AppShellSkeleton home layout", () => {
  it("paints the home hero and resource footer beside the sidebar, with no header row", () => {
    const shell = render("home");

    expect(shell.dataset.agentNativeAppSkeletonLayout).toBe("home");
    expect(
      shell.querySelector("[data-agent-native-app-skeleton-sidebar]"),
    ).not.toBeNull();
    expect(shell.querySelector("header")).toBeNull();

    const hero = shell.querySelector<HTMLElement>(
      "[data-agent-native-app-skeleton-home-hero]",
    );
    expect(hero?.style.justifyContent).toBe("center");
    // Mark, title, two lead lines, composer and hint.
    expect(
      hero?.querySelectorAll("[data-agent-native-skeleton-block]"),
    ).toHaveLength(6);

    const footer = shell.querySelector<HTMLElement>(
      "[data-agent-native-app-skeleton-home-footer]",
    );
    expect(footer?.children).toHaveLength(2);
    expect(
      [...(footer?.children ?? [])].map(
        (column) =>
          column.querySelectorAll("[data-agent-native-skeleton-block]").length,
      ),
    ).toEqual([6, 4]);
  });

  it("keeps the assistant layout distinct from home", () => {
    const shell = render("assistant");

    expect(shell.dataset.agentNativeAppSkeletonLayout).toBe("assistant");
    expect(
      shell.querySelector("[data-agent-native-app-skeleton-home-hero]"),
    ).toBeNull();
  });

  it("shows the prompt and suggestions immediately while skeletonizing only the library", () => {
    let composerProps:
      | Parameters<AppShellFirstPaintHome["renderComposer"]>[0]
      | undefined;
    const firstPaintHome: AppShellFirstPaintHome = {
      appId: "design",
      appName: "Design",
      pageTitle: "Home",
      headerHeight: 56,
      headerActionWidths: [108, 32],
      promptTitle: "What would you like to design?",
      promptPlaceholder: "Describe your design",
      suggestedPromptsLabel: "Suggested prompts",
      sidebarItems: [{ label: "Home", to: "/home", icon: IconHome }],
      templatesLabel: "Templates",
      recentLabel: "Recent",
      browseAllLabel: "Browse all",
      skipPromptLabel: "Skip prompt",
      promptDraftScope: "design:new:viewer-a:org-a",
      promptHandoffScope: "viewer-a:org-a",
      suggestionRole: "design",
      suggestionSeed: 123,
      suggestions: [
        { id: "one", label: "Portfolio", prompt: "Build a portfolio" },
        {
          id: "two",
          label: "Create a dashboard",
          prompt: "Create a dashboard",
        },
        { id: "three", label: "Design a shop", prompt: "Design a shop" },
      ],
      renderComposer: (props) => {
        composerProps = props;
        return (
          <textarea
            aria-label={props.ariaLabel}
            placeholder={props.placeholder}
            onChange={(event) =>
              props.onTextChange?.(event.currentTarget.value)
            }
          />
        );
      },
    };
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      <MemoryRouter>
        <AppShellSkeleton
          layout="prompt-library"
          firstPaintHome={firstPaintHome}
        />
      </MemoryRouter>,
    );
    const shell = container.querySelector<HTMLElement>(
      "[data-agent-native-app-skeleton]",
    )!;

    expect(shell.getAttribute("role")).toBeNull();
    expect(
      shell.querySelector("main.agent-native-app-main .agent-prompt-home-hero"),
    ).not.toBeNull();
    expect(shell.querySelector("textarea")?.placeholder).toBe(
      "Describe your design",
    );
    expect(composerProps).toMatchObject({
      draftScope: "design:new:viewer-a:org-a",
      initialTextOverridesSavedDraft: true,
      suppressInitialTextChange: true,
    });
    expect(shell.querySelectorAll("[data-home-suggestion-id]")).toHaveLength(3);
    expect(
      shell
        .querySelector("[data-agent-suggestion-bar]")
        ?.getAttribute("data-home-suggestion-seed"),
    ).toBe("123");
    expect(
      shell
        .querySelector("[data-agent-suggestion-bar]")
        ?.getAttribute("data-home-suggestion-shell-role"),
    ).toBe("design");
    expect(
      shell.querySelectorAll("[data-agent-native-skeleton-block]"),
    ).not.toHaveLength(0);
    expect(
      shell
        .querySelector(
          '[data-agent-suggestion-bar][aria-label="Suggested prompts"]',
        )
        ?.getAttribute("aria-label"),
    ).toBe("Suggested prompts");
    expect(shell.querySelectorAll('aside nav a[href="/home"]')).toHaveLength(1);
    expect(shell.querySelector("[data-agent-native-icon]")).not.toBeNull();
    expect(shell.textContent).toContain("Skip prompt");
    expect(
      shell.querySelector('[data-agent-suggestion-track="true"]')?.className,
    ).toContain("flex-nowrap");
    expect(
      shell.querySelector('[data-home-suggestion-id="one"]')?.textContent,
    ).toBe("Portfolio");
    expect(
      shell.querySelector("[data-prompt-home-connection-skeleton]"),
    ).toBeNull();
    expect(shell.textContent).not.toContain("Getting Started");
  });

  it("localizes shell prompts from the active app catalog", async () => {
    const originalLocale = document.documentElement.dataset.locale;
    document.documentElement.dataset.locale = "fr-FR";
    const firstPaintHome: AppShellFirstPaintHome = {
      appId: "design",
      appName: "Design",
      pageTitle: "Home",
      promptTitle: "What would you like to design?",
      promptPlaceholder: "Describe your design",
      suggestedPromptsLabel: "Suggested prompts",
      sidebarItems: [{ label: "Home", to: "/home", icon: IconHome }],
      templatesLabel: "Templates",
      recentLabel: "Recent",
      browseAllLabel: "Browse all",
      suggestions: [
        {
          id: "one",
          label: "Portfolio",
          prompt: "Build a portfolio",
          messageKey: "home.suggestions.general.one",
          labelMessageKey: "home.suggestionLabels.general.one",
        },
        {
          id: "two",
          label: "Create a dashboard",
          prompt: "Create a dashboard",
        },
        { id: "three", label: "Design a shop", prompt: "Design a shop" },
      ],
      loadSuggestionMessages: async () => ({
        shell: {
          appName: "Design FR",
          pageTitle: "Accueil",
          promptTitle: "Que voulez-vous concevoir?",
          promptPlaceholder: "Décrivez votre design",
          suggestedPromptsLabel: "Suggestions",
          home: "Accueil",
          templates: "Modèles",
          designSystems: "Systèmes de design",
          recent: "Récents",
          browseAll: "Tout voir",
          skipPrompt: "Passer",
        },
        home: {
          suggestions: {
            general: { one: "Créer un portfolio" },
          },
          suggestionLabels: {
            general: { one: "Portfolio" },
          },
        },
      }),
      localizeMessages: (messages) => {
        const shell = (messages as { shell: Record<string, string> }).shell;
        return {
          appName: shell.appName,
          pageTitle: shell.pageTitle,
          promptTitle: shell.promptTitle,
          promptPlaceholder: shell.promptPlaceholder,
          suggestedPromptsLabel: shell.suggestedPromptsLabel,
          sidebarItems: [{ label: shell.home, to: "/home", icon: IconHome }],
          templatesLabel: shell.templates,
          recentLabel: shell.recent,
          browseAllLabel: shell.browseAll,
          skipPromptLabel: shell.skipPrompt,
        };
      },
      renderComposer: (props) => (
        <textarea
          aria-label={props.ariaLabel}
          placeholder={props.placeholder}
          onChange={(event) => props.onTextChange?.(event.currentTarget.value)}
        />
      ),
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <MemoryRouter>
            <AppShellSkeleton
              layout="prompt-library"
              firstPaintHome={firstPaintHome}
            />
          </MemoryRouter>,
        );
        await Promise.resolve();
      });

      expect(container.textContent).toContain("Accueil");
      expect(container.textContent).toContain("Modèles");
      expect(container.textContent).toContain("Que voulez-vous concevoir?");
      expect(
        container.querySelector<HTMLTextAreaElement>("textarea")?.placeholder,
      ).toBe("Décrivez votre design");
      expect(
        container.querySelector<HTMLButtonElement>(
          '[data-home-suggestion-id="one"]',
        )?.textContent,
      ).toBe("Portfolio");
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('[data-home-suggestion-id="one"]')
          ?.click();
      });
      expect(
        consumeFirstPaintPromptDraft("design", "viewer-a:org-a"),
      ).toMatchObject({
        status: "present",
        draft: { text: "Créer un portfolio", source: "home_suggestion" },
      });
    } finally {
      await act(async () => root.unmount());
      container.remove();
      if (originalLocale === undefined) {
        delete document.documentElement.dataset.locale;
      } else {
        document.documentElement.dataset.locale = originalLocale;
      }
    }
  });
});
