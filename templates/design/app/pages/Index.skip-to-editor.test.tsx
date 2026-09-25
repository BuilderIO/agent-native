// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Index from "./Index";

const mocks = vi.hoisted(() => ({
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
  ownStatus: "success",
  templatesError: false,
  summaryParams: null as Record<string, unknown> | null,
  listParams: null as Record<string, unknown> | null,
  refetch: vi.fn(),
  focusComposer: vi.fn(),
  submitWithText: vi.fn(),
  agentEngine: { state: "configured", missing: false },
  connect: vi.fn(),
  starterPrompt: "Un panel de análisis con cuatro indicadores clave.",
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  useAgentEngineConfigured: () => mocks.agentEngine,
}));
vi.mock("@agent-native/core/client/settings", () => ({
  useBuilderConnectFlow: () => ({ connecting: false, start: mocks.connect }),
  BuilderConnectPopover: ({ children }: { children: React.ReactNode }) => (
    <div onClick={mocks.connect}>{children}</div>
  ),
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

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: async () => ({ agentContext: "Frozen selected system" }),
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : undefined,
  useActionQuery: (name: string, params: Record<string, unknown>) => {
    if (name === "list-designs") {
      if (params.compact === "true") {
        mocks.summaryParams = params;
        return {
          data: { totalCount: mocks.ownCount },
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

vi.mock("@agent-native/toolkit/app-shell", () => ({
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
  useDesignSystems: () => ({
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
  }),
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
  mocks.ownCount = 0;
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

describe("Index skip to editor", () => {
  it("explains an unaccepted quick start without replacing the draft or creating a design", async () => {
    mocks.submitWithText.mockResolvedValueOnce(false);
    const suggestion = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "homeContext.quickDashboard",
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
      (button) => button.textContent === "homeContext.quickDashboard",
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

  it("offers provider connection without disabling draft or context staging and enables sending when configured", async () => {
    mocks.agentEngine = { state: "missing", missing: true };
    await act(async () => root.render(<Index />));
    const connect = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("home.connectBuilderIo"),
    );
    expect(connect).toBeDefined();
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.promptProps).toMatchObject({
      submissionDisabled: true,
      showModelSelector: false,
      modelStatusChecksEnabled: false,
    });
    expect(mocks.promptProps?.disabled).not.toBe(true);
    expect(mocks.promptProps?.contextMenuItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "design" }),
        expect.objectContaining({ id: "slides" }),
      ]),
    );
    await act(async () => connect?.click());
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    mocks.agentEngine = { state: "configured", missing: false };
    await act(async () => root.render(<Index />));
    expect(mocks.promptProps).toMatchObject({
      submissionDisabled: false,
      showModelSelector: true,
      modelStatusChecksEnabled: true,
    });
    expect(container.textContent).not.toContain("home.connectBuilderIo");
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
    expect(container.textContent).toContain("homeContext.quickDashboard");
  });
});

describe("home library", () => {
  it("uses an unfiltered own-design summary and keeps shared-only users on templates", async () => {
    expect(mocks.summaryParams).toEqual({
      page: 1,
      pageSize: 1,
      createdBy: "me",
      compact: "true",
      includePreview: "false",
    });
    expect(
      container.querySelector('[role="tab"][data-state="active"]')?.textContent,
    ).toBe("navigation.templates");
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

  it("selects a template and focuses the same composer without creating a design", async () => {
    const template = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Starter template",
    );
    await act(async () => template?.click());
    expect(mocks.promptProps?.selectedTemplateId).toBe("starter-template");
    expect(mocks.focusComposer).toHaveBeenCalled();
    expect(mocks.createFromTemplate).not.toHaveBeenCalled();
  });
});
