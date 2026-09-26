// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Index from "./Index";

const mocks = vi.hoisted(() => ({
  systemsEnabled: true,
  systemsQuery: vi.fn(),
  createDesign: vi.fn(),
  createFromTemplate: vi.fn(),
  generateTitle: vi.fn(),
  navigate: vi.fn(),
  setSearchParams: vi.fn(),
  headerActions: null as unknown,
  nanoid: vi.fn(() => "design-1"),
  queryClient: {
    setQueryData: vi.fn(),
    setQueriesData: vi.fn(),
    invalidateQueries: vi.fn(),
  },
  promptProps: null as Record<string, any> | null,
  toastError: vi.fn(),
  writePendingGeneration: vi.fn(),
  clearPendingGeneration: vi.fn(),
  fullAppBuilding: false,
  ownCount: 0,
  ownedCount: 0,
  ownStatus: "success",
  templatesError: false,
  summaryParams: null as Record<string, unknown> | null,
  listParams: null as Record<string, unknown> | null,
  refetch: vi.fn(),
  focusComposer: vi.fn(),
  submitWithText: vi.fn(),
  agentEngine: { state: "configured", missing: false },
  starterPrompt: "Un panel de análisis con cuatro indicadores clave.",
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  BuilderSetupCard: ({ onConnected }: { onConnected?: () => void }) => (
    <div data-testid="ai-setup-card">
      <h3>Connect AI</h3>
      <button onClick={onConnected}>Connect Builder.io</button>
      <a href="/settings/keys">Custom keys</a>
    </div>
  ),
  useAgentEngineConfigured: () => mocks.agentEngine,
}));
vi.mock("@/components/templates/TemplatePreview", () => ({
  TemplatePreview: () => null,
}));
vi.mock("@/components/QueryErrorState", () => ({
  QueryErrorState: ({ onRetry }: { onRetry: () => void }) => (
    <button data-query-error onClick={onRetry}>
      Retry
    </button>
  ),
}));

vi.mock("@agent-native/core/client/feature-flags", () => ({
  useFeatureFlag: () => mocks.fullAppBuilding,
}));

vi.mock("@agent-native/core/client/collab", () => ({
  emailToColor: () => "#000000",
  emailToName: (email: string) => email,
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrgMembers: () => ({ data: undefined }),
}));

vi.mock("@/hooks/use-design-system-workflows", () => ({
  useDesignSystemWorkflows: () => mocks.systemsEnabled,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: async () => ({ agentContext: "Frozen selected system" }),
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : undefined,
  useActionQuery: (name: string, params: Record<string, unknown>) => {
    if (name === "list-designs") {
      if (params.compact === "true") {
        if (params.createdBy === "all") mocks.summaryParams = params;
        return {
          data: {
            totalCount:
              params.createdBy === "me" ? mocks.ownedCount : mocks.ownCount,
          },
          isSuccess: mocks.ownStatus === "success",
          isError: mocks.ownStatus === "error",
          isFetching: false,
          refetch: mocks.refetch,
        };
      }
      mocks.listParams = params;
      return {
        data: { count: 0, totalCount: 0, designs: [] },
        isLoading: false,
      };
    }
    if (name === "list-design-templates") {
      return {
        data: {
          count: 2,
          templates: [
            {
              id: "starter-template",
              title: "Starter template",
              isBuiltIn: true,
              previewHtml: "<main>Starter</main>",
            },
            {
              id: "saved-template",
              title: "Saved template",
              description: "Reusable campaign",
              category: "social",
              designSystemId: "linked-system",
              isBuiltIn: false,
              previewHtml: "<main>Saved</main>",
            },
          ],
        },
        isLoading: false,
        isError: mocks.templatesError,
        refetch: mocks.refetch,
      };
    }
    if (name === "generate-home-suggestions") {
      return {
        data: {
          suggestions: [
            {
              id: "design-suggestion",
              label: "Generated dashboard",
              prompt: mocks.starterPrompt,
            },
          ],
          isLoading: false,
          isError: false,
        },
      };
    }
    return { data: undefined, isLoading: false };
  },
  useActionMutation: (name: string) => ({
    mutateAsync:
      name === "create-design"
        ? mocks.createDesign
        : name === "create-design-from-template"
          ? mocks.createFromTemplate
          : name === "generate-design-title"
            ? mocks.generateTitle
            : vi.fn().mockResolvedValue(undefined),
    mutate: vi.fn(),
  }),
  useSession: () => ({ session: null, isLoading: false }),
  useAvatarUrl: () => null,
  useChangeVersion: () => 0,
  useChangeVersions: () => 0,
  getBrowserTabId: () => "tab-1",
  readClientAppState: async () => null,
  setClientAppState: async () => undefined,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => {
    if (key === "home.untitledDesign") return "Untitled Design";
    if (key === "home.starterDashboardPrompt") return mocks.starterPrompt;
    if (key === "home.searchNoResultsTitle") {
      return "No designs match your search";
    }
    if (key === "home.searchNoResultsDescription") {
      return "Try a different search.";
    }
    if (key === "promptDialog.skipPrompt") return "Skip prompt";
    if (key === "home.failedToCreateDesign") {
      return "Failed to create design";
    }
    return key;
  },
}));

vi.mock("@agent-native/toolkit/app-shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/toolkit/app-shell")>()),
  useSetHeaderActions: (actions: unknown) => {
    mocks.headerActions = actions;
  },
  useSetPageTitle: () => {},
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mocks.queryClient,
}));

vi.mock("@agent-native/creative-context/client", () => ({
  CreativeContextShareSheet: () => null,
  parseCreativeContexts: () => [],
  useCreativeContextLab: () => false,
  useCreativeContexts: () => ({ data: undefined, isLoading: false }),
  useCreativeContextState: () => ({
    state: { contextMode: "auto", selectedContextId: null },
    setState: vi.fn(),
    isLoading: false,
    error: null,
  }),
}));

vi.mock("react-router", () => ({
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [new URLSearchParams(), mocks.setSearchParams],
  Link: ({ children, to, ...props }: Record<string, any>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("nanoid", () => ({
  nanoid: () => mocks.nanoid(),
}));

vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => mocks.toastError(...args) },
}));

vi.mock("@/components/editor/PromptDialog", () => ({
  preloadPromptComposer: vi.fn(),
  default: (props: Record<string, any>) => {
    mocks.promptProps = props;
    if (props.composerRef)
      props.composerRef.current = {
        focus: mocks.focusComposer,
        submitWithText: mocks.submitWithText,
      };
    return null;
  },
}));

vi.mock("@/hooks/use-design-systems", () => ({
  useDesignSystems: (enabled: boolean) => (
    mocks.systemsQuery(enabled),
    {
      designSystems: [
        {
          id: "default-system",
          title: "Default system",
          isDefault: true,
          data: "{}",
        },
        {
          id: "linked-system",
          title: "Linked system",
          isDefault: false,
          data: "{}",
        },
        {
          id: "override-system",
          title: "Override system",
          isDefault: false,
          data: "{}",
        },
      ],
      defaultSystem: {
        id: "default-system",
        title: "Default system",
        isDefault: true,
        data: "{}",
      },
      isLoading: false,
    }
  ),
}));

vi.mock("@/lib/agent-chat", () => ({
  sendToDesignAgentChat: vi.fn(),
}));

vi.mock("@/lib/pending-generation", () => ({
  writePendingGeneration: (...args: unknown[]) =>
    mocks.writePendingGeneration(...args),
  clearPendingGeneration: (...args: unknown[]) =>
    mocks.clearPendingGeneration(...args),
}));

let container: HTMLDivElement;
let root: Root;
let headerContainer: HTMLDivElement | null = null;
let headerRoot: Root | null = null;

beforeEach(async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.nanoid.mockReturnValue("design-1");
  mocks.createFromTemplate.mockResolvedValue({
    id: "copied-design",
    title: "Saved template",
    designSystemId: "override-system",
    adaptationPending: false,
    templateBaselineFiles: [{ id: "file-1", contentHash: "baseline" }],
  });
  mocks.generateTitle.mockResolvedValue(undefined);
  mocks.queryClient.invalidateQueries.mockResolvedValue(undefined);
  mocks.promptProps = null;
  mocks.headerActions = null;
  mocks.fullAppBuilding = false;
  mocks.systemsEnabled = true;
  mocks.ownCount = 0;
  mocks.ownedCount = 0;
  mocks.ownStatus = "success";
  mocks.templatesError = false;
  mocks.agentEngine = { state: "configured", missing: false };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Index />);
  });
});

afterEach(async () => {
  await act(async () => {
    headerRoot?.unmount();
    root.unmount();
  });
  headerRoot = null;
  headerContainer?.remove();
  headerContainer = null;
  container.remove();
  document.body.replaceChildren();
});

it("does not query or apply a default system when workflows are disabled", async () => {
  mocks.createDesign.mockResolvedValue(undefined);
  mocks.systemsEnabled = false;
  mocks.systemsQuery.mockClear();
  await act(async () => root.render(<Index />));
  expect(mocks.systemsQuery).toHaveBeenLastCalledWith(false);
  expect(mocks.promptProps?.selectedDesignSystemId).toBeNull();
  expect(
    mocks.promptProps?.contextMenuItems[0].children.map(
      (item: { id: string }) => item.id,
    ),
  ).toEqual(["figma-reference", "website-reference"]);
  await act(async () => mocks.promptProps?.onSubmit("New design", [], {}));
  expect(mocks.createDesign).toHaveBeenCalledWith(
    expect.objectContaining({ designSystemId: null }),
  );
});

describe("Index skip to editor", () => {
  it("explains an unaccepted quick start without replacing the draft or creating a design", async () => {
    mocks.submitWithText.mockResolvedValueOnce(false);
    const suggestion = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Generated dashboard",
    );
    await act(async () => suggestion?.click());
    expect(mocks.toastError).toHaveBeenCalledWith("homeContext.notReady");
    expect(mocks.promptProps?.initialText).toBeUndefined();
    expect(mocks.createDesign).not.toHaveBeenCalled();
    expect(mocks.writePendingGeneration).not.toHaveBeenCalled();
  });
  it("submits the localized quick start through the current composer without replacing its draft or selections", async () => {
    await act(async () =>
      mocks.promptProps?.onDesignSystemChange("override-system"),
    );
    await act(async () =>
      mocks.promptProps?.onTemplateChange("saved-template"),
    );
    const suggestion = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Generated dashboard",
    );
    await act(async () => suggestion?.click());
    expect(mocks.submitWithText).toHaveBeenCalledWith(mocks.starterPrompt);
    expect(mocks.promptProps?.initialText).toBeUndefined();
    expect(mocks.promptProps?.selectedTemplateId).toBe("saved-template");
    expect(mocks.promptProps?.selectedDesignSystemId).toBe("override-system");
    await act(async () => suggestion?.click());
    expect(mocks.submitWithText).toHaveBeenCalledTimes(2);
    expect(mocks.createDesign).not.toHaveBeenCalled();
    expect(mocks.createFromTemplate).not.toHaveBeenCalled();
    expect(mocks.writePendingGeneration).not.toHaveBeenCalled();
  });

  it("persists one empty shell before navigating without starting generation", async () => {
    let resolveCreate: (() => void) | undefined;
    mocks.createDesign.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveCreate = resolve;
      }),
    );

    expect(mocks.promptProps?.skipLabel).toBe("Skip prompt");
    let skipPromise: Promise<void> | undefined;
    await act(async () => {
      skipPromise = mocks.promptProps?.onSkip();
      await Promise.resolve();
    });

    expect(mocks.createDesign).toHaveBeenCalledTimes(1);
    expect(mocks.createDesign).toHaveBeenCalledWith({
      id: "design-1",
      title: "Untitled Design",
      projectType: "prototype",
      designSystemId: "default-system",
    });
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.writePendingGeneration).not.toHaveBeenCalled();
    expect(mocks.generateTitle).not.toHaveBeenCalled();

    await act(async () => {
      resolveCreate?.();
      await skipPromise;
    });

    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith("/design/design-1");
  });

  it("shows the inline prompt without New buttons or creation side effects", () => {
    expect(mocks.promptProps).toMatchObject({
      inline: true,
      open: true,
      draftScope: "design:new:0",
    });
    expect(container.textContent).not.toContain("home.newDesign");
    expect(container.textContent).not.toContain("home.createFirstDesign");
    expect(mocks.createDesign).not.toHaveBeenCalled();
  });

  it("retains the feature-gated design-or-app choice", async () => {
    expect(mocks.promptProps?.creationMode).toBeUndefined();
    mocks.fullAppBuilding = true;
    await act(async () => root.render(<Index />));
    expect(mocks.promptProps?.creationMode).toBe("design");
    await act(async () => mocks.promptProps?.onCreationModeChange("app"));
    expect(mocks.promptProps?.creationMode).toBe("app");
    expect(mocks.createDesign).not.toHaveBeenCalled();
  });

  it("gates chat on missing provider, offers Builder and custom keys, then enables when configured", async () => {
    mocks.agentEngine = { state: "missing", missing: true };
    await act(async () => root.render(<Index />));
    expect(container.textContent).toContain("Connect AI");
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent === "Connect Builder.io",
      ),
    ).toBe(true);
    expect(
      Array.from(container.querySelectorAll("a")).some(
        (link) =>
          link.textContent === "Custom keys" &&
          link.href.endsWith("/settings/keys"),
      ),
    ).toBe(true);
    expect(mocks.promptProps).toMatchObject({
      disabled: true,
      submissionDisabled: true,
      showModelSelector: false,
      modelStatusChecksEnabled: false,
    });
    await act(async () =>
      mocks.promptProps?.onSubmit?.("Build a dashboard", [], {}),
    );
    expect(mocks.createDesign).not.toHaveBeenCalled();
    expect(mocks.writePendingGeneration).not.toHaveBeenCalled();
    mocks.agentEngine = { state: "configured", missing: false };
    await act(async () => root.render(<Index />));
    expect(mocks.promptProps).toMatchObject({
      disabled: false,
      submissionDisabled: false,
      showModelSelector: true,
      modelStatusChecksEnabled: false,
    });
    expect(container.querySelector("[data-testid='ai-setup-card']")).toBeNull();
  });

  it("keeps chat closed while provider status is unresolved and offers retry when unavailable", async () => {
    mocks.agentEngine = { state: "unknown", missing: false };
    await act(async () => root.render(<Index />));
    expect(container.textContent).toContain("agentChat.setup.checkingProvider");
    expect(mocks.promptProps).toMatchObject({
      disabled: true,
      submissionDisabled: true,
    });

    mocks.agentEngine = { state: "unavailable", missing: false };
    await act(async () => root.render(<Index />));
    const dispatch = vi.spyOn(window, "dispatchEvent");
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "agentChat.common.retry",
    );
    expect(retry).toBeDefined();
    await act(async () => retry?.click());
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-engine:configured-changed" }),
    );
    dispatch.mockRestore();
  });

  it("hides home suggestions until the provider status is confirmed", async () => {
    mocks.agentEngine = { state: "missing", missing: true };
    await act(async () => root.render(<Index />));
    expect(container.textContent).not.toContain("Generated dashboard");
  });

  it("does not navigate on failure and allows a successful retry", async () => {
    mocks.createDesign
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce(undefined);

    await act(async () => {
      await expect(mocks.promptProps?.onSkip()).rejects.toThrow(
        "database unavailable",
      );
    });

    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith("Failed to create design");
    expect(mocks.writePendingGeneration).not.toHaveBeenCalled();
    expect(mocks.generateTitle).not.toHaveBeenCalled();

    mocks.nanoid.mockReturnValue("design-2");
    await act(async () => {
      await mocks.promptProps?.onSkip();
    });

    expect(mocks.createDesign).toHaveBeenCalledTimes(2);
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith("/design/design-2");
  });

  it("preserves a user-selected system when a template is chosen afterward", async () => {
    await act(async () => {
      mocks.promptProps?.onDesignSystemChange("override-system");
    });

    await act(async () => {
      mocks.promptProps?.onTemplateChange("saved-template");
    });

    expect(mocks.promptProps?.selectedTemplateId).toBe("saved-template");
    expect(mocks.promptProps?.selectedDesignSystemId).toBe("override-system");
    expect(mocks.promptProps?.skipLabel).toBe("templatesPage.useTemplate");

    let shouldClose: boolean | void = undefined;
    await act(async () => {
      shouldClose = await mocks.promptProps?.onSkip();
    });

    expect(mocks.createFromTemplate).toHaveBeenCalledWith({
      templateId: "saved-template",
      title: "Saved template",
      designSystemId: "override-system",
      newId: "design-1",
      retryKey: expect.any(String),
    });
    expect(mocks.createDesign).not.toHaveBeenCalled();
    expect(mocks.writePendingGeneration).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith("/design/copied-design");
    expect(shouldClose).toBe(false);
  });

  it("opens a copied template without waiting for the designs list to refresh", async () => {
    let resolveRefresh: (() => void) | undefined;
    mocks.queryClient.invalidateQueries.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRefresh = resolve;
      }),
    );

    await act(async () => {
      mocks.promptProps?.onTemplateChange("saved-template");
    });

    let skipPromise: Promise<void> | undefined;
    await act(async () => {
      skipPromise = mocks.promptProps?.onSkip();
      await Promise.resolve();
    });

    expect(mocks.createFromTemplate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith("/design/copied-design");

    resolveRefresh?.();
    await act(async () => {
      await skipPromise;
    });
  });
});

describe("Index search empty state", () => {
  it("distinguishes no search matches from a first-time empty state", async () => {
    expect(container.textContent).toContain("Starter template");
    mocks.ownCount = 1;
    await act(async () => root.render(<Index />));

    headerContainer = document.createElement("div");
    document.body.append(headerContainer);
    headerRoot = createRoot(headerContainer);
    await act(async () => {
      headerRoot?.render(mocks.headerActions as ReactNode);
    });

    const searchInput = headerContainer.querySelector<HTMLInputElement>(
      'input[aria-label="home.searchPlaceholder"]',
    );
    expect(searchInput).not.toBeNull();

    await act(async () => {
      if (!searchInput) throw new Error("Search input not found");
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(searchInput, "no matching design");
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      headerRoot?.render(mocks.headerActions as ReactNode);
    });

    expect(container.textContent).toContain("No designs match your search");
    expect(container.textContent).toContain("Try a different search.");
    expect(container.textContent).not.toContain("home.createFirstDesign");
    expect(container.textContent).not.toContain("home.pickStartingPoint");
    expect(container.textContent).toContain("Generated dashboard");
  });

  it("keeps searched shared designs visible when the user owns no designs", async () => {
    mocks.ownCount = 0;
    await act(async () => root.render(<Index />));

    headerContainer = document.createElement("div");
    document.body.append(headerContainer);
    headerRoot = createRoot(headerContainer);
    await act(async () => {
      headerRoot?.render(mocks.headerActions as ReactNode);
    });

    const searchInput = headerContainer.querySelector<HTMLInputElement>(
      'input[aria-label="home.searchPlaceholder"]',
    );
    expect(searchInput).not.toBeNull();
    await act(async () => {
      if (!searchInput) throw new Error("Search input not found");
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(searchInput, "shared design");
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      headerRoot?.render(mocks.headerActions as ReactNode);
    });

    expect(container.textContent).toContain("home.recent");
    const tabs = container.querySelectorAll<HTMLElement>('[role="tab"]');
    expect(tabs).toHaveLength(2);
    await act(async () => tabs[0]?.click());
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
  });
});

describe("home library", () => {
  it("uses an unfiltered accessible-design summary for shared-only users", async () => {
    expect(mocks.summaryParams).toEqual({
      page: 1,
      pageSize: 1,
      createdBy: "all",
      compact: "true",
      includePreview: "false",
    });
    expect(container.textContent).toContain("navigation.templates");
    expect(container.textContent).not.toContain("home.recent");
    expect(container.querySelector('a[href="/templates"]')).not.toBeNull();
    mocks.ownCount = 1;
    await act(async () => root.render(<Index />));
    expect(container.textContent).toContain("home.recent");
  });

  it("does not treat pending or failed ownership reads as successful empty results", async () => {
    mocks.ownCount = 3;
    mocks.ownStatus = "pending";
    await act(async () => root.render(<Index />));
    expect(container.textContent).not.toContain("home.recent");
    mocks.ownStatus = "error";
    await act(async () => root.render(<Index />));
    expect(container.textContent).not.toContain("home.recent");
    const retry =
      container.querySelector<HTMLButtonElement>("[data-query-error]");
    expect(retry).not.toBeNull();
    await act(async () => retry?.click());
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it("shows template errors with retry rather than an empty grid", async () => {
    mocks.templatesError = true;
    await act(async () => root.render(<Index />));
    expect(container.querySelector("[data-query-error]")).not.toBeNull();
    expect(container.textContent).not.toContain(
      "promptDialog.noTemplatesFound",
    );
  });

  it("copies a gallery template directly without submitting or changing the draft", async () => {
    const originalPrompt = mocks.promptProps;
    const template = Array.from(
      container.querySelectorAll<HTMLElement>('[role="button"]'),
    ).find((button) => button.textContent?.includes("Starter template"));
    await act(async () => template?.click());
    expect(mocks.createFromTemplate).toHaveBeenCalledExactlyOnceWith({
      templateId: "starter-template",
      title: "Starter template",
      newId: "design-1",
      retryKey: expect.any(String),
    });
    expect(mocks.promptProps?.selectedTemplateId).toBe(
      originalPrompt?.selectedTemplateId,
    );
    expect(mocks.focusComposer).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith("/design/copied-design");
  });
});
