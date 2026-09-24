// @vitest-environment happy-dom

vi.mock("@/components/editor/use-design-prompt-context", () => ({
  useDesignPromptContext: () => ({
    contextItems: [],
    contextMenuItems: [],
    view: null,
    setView: vi.fn(),
    onRemoveContextItem: vi.fn(),
    onInspectContextItem: vi.fn(),
    onRetryContextItem: vi.fn(),
    flush: async () => {},
  }),
}));
vi.mock("@/components/editor/DesignContextPicker", () => ({
  DesignContextPicker: () => null,
}));

import { act } from "react";
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
  homeComposerProps: null as Record<string, any> | null,
  promptProps: null as Record<string, any> | null,
  toastError: vi.fn(),
  writePendingGeneration: vi.fn(),
  clearPendingGeneration: vi.fn(),
  fullAppBuilding: false,
  agentEngine: { state: "configured", missing: false },
  builderConnectStart: vi.fn(),
  hasDefaultSystem: true,
  searchParams: "",
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  useAgentEngineConfigured: () => mocks.agentEngine,
}));

vi.mock("@agent-native/core/client/settings", () => ({
  useBuilderConnectFlow: () => ({
    configured: false,
    connecting: false,
    error: null,
    start: mocks.builderConnectStart,
  }),
  BuilderConnectPopover: ({
    children,
    flow,
  }: {
    children: React.ReactNode;
    flow: { start: () => void };
  }) => <div onClick={() => flow.start()}>{children}</div>,
}));

vi.mock("@agent-native/core/client/feature-flags", () => ({
  useFeatureFlag: () => mocks.fullAppBuilding,
}));

vi.mock("@agent-native/core/client/composer", () => ({
  PromptComposer: (props: Record<string, any>) => {
    mocks.homeComposerProps = props;
    return null;
  },
}));

vi.mock("@agent-native/core/client/collab", () => ({
  emailToColor: () => "#000000",
  emailToName: (email: string) => email,
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrgMembers: () => ({ data: undefined }),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: vi.fn().mockResolvedValue({}),
  useActionQuery: (name: string) => {
    if (name === "list-designs") {
      return { data: { count: 0, designs: [] }, isLoading: false };
    }
    if (name === "list-design-templates") {
      return {
        data: {
          count: 1,
          templates: [
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
  useSearchParams: () => [
    new URLSearchParams(mocks.searchParams),
    mocks.setSearchParams,
  ],
  Link: ({ children, to, ...props }: Record<string, any>) => (
    <a href={String(to)} {...props}>
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
  uploadPromptFilesToServer: vi.fn().mockResolvedValue([]),
  default: (props: Record<string, any>) => {
    mocks.promptProps = props;
    return null;
  },
}));

vi.mock("@/hooks/use-design-systems", () => ({
  useDesignSystems: () => ({
    designSystems: [
      {
        id: "default-system",
        title: "Default system",
        isDefault: mocks.hasDefaultSystem,
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
    defaultSystem: mocks.hasDefaultSystem
      ? {
          id: "default-system",
          title: "Default system",
          isDefault: true,
          data: "{}",
        }
      : null,
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
  mocks.homeComposerProps = null;
  mocks.headerActions = null;
  mocks.fullAppBuilding = false;
  mocks.hasDefaultSystem = true;
  mocks.searchParams = "";
  mocks.agentEngine.state = "configured";
  mocks.agentEngine.missing = false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Index />);
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  document.body.replaceChildren();
});

describe("Index skip to editor", () => {
  it("uses a configured default for a new draft but never selects a nondefault system", async () => {
    expect(mocks.promptProps?.selectedDesignSystemId).toBe("default-system");
    mocks.hasDefaultSystem = false;
    await act(async () => root.render(<Index key="fresh-without-default" />));
    expect(mocks.promptProps?.selectedDesignSystemId).toBeNull();
  });

  it("keeps URL explicit none even when a real default exists", async () => {
    mocks.searchParams = "promptSystem=";
    await act(async () => root.render(<Index key="explicit-none" />));
    expect(mocks.promptProps?.selectedDesignSystemId).toBeNull();
  });
  it("retains explicit none when the prompt is closed or a template is chosen", async () => {
    await act(async () => mocks.promptProps?.onDesignSystemChange(null));
    const update =
      mocks.setSearchParams.mock.calls[
        mocks.setSearchParams.mock.calls.length - 1
      ]?.[0];
    expect(update(new URLSearchParams()).toString()).toBe("promptSystem=");
    await act(async () => mocks.promptProps?.onOpenChange(false));
    await act(async () =>
      mocks.promptProps?.onTemplateChange("saved-template"),
    );
    expect(mocks.promptProps?.selectedDesignSystemId).toBeNull();
  });

  it("keeps starter prompts in the collaborative intake flow", async () => {
    mocks.createDesign.mockResolvedValue(undefined);

    const starterPrompt = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "home.starterDashboard",
    );
    expect(starterPrompt).toBeDefined();

    await act(async () => {
      starterPrompt?.click();
      await Promise.resolve();
    });

    expect(mocks.writePendingGeneration).toHaveBeenCalledWith(
      "design-1",
      expect.objectContaining({
        skipQuestions: undefined,
      }),
    );
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

  it("uses the home composer as the only visible new-design entry point", () => {
    const newDesignButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent === "home.newDesign");
    expect(newDesignButton).toBeUndefined();
    expect(mocks.homeComposerProps).toMatchObject({
      draftScope: "design:home",
      layoutVariant: "hero",
    });
    expect(mocks.createDesign).not.toHaveBeenCalled();
    expect(mocks.writePendingGeneration).not.toHaveBeenCalled();
  });

  it("replaces the composer setup card with one focused Builder connection action", async () => {
    mocks.agentEngine.state = "missing";
    mocks.agentEngine.missing = true;

    await act(async () => {
      root.render(<Index />);
    });

    const connectButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("home.connectBuilderIo"),
    );
    expect(connectButton).toBeDefined();
    expect(mocks.homeComposerProps).toMatchObject({
      disabled: true,
      showModelSelector: false,
      modelStatusChecksEnabled: false,
    });

    await act(async () => {
      connectButton?.click();
    });
    expect(mocks.builderConnectStart).toHaveBeenCalledTimes(1);
  });

  it("keeps the hero composer as the creation surface when full-app building is enabled", async () => {
    await act(async () => root.unmount());
    mocks.fullAppBuilding = true;
    mocks.promptProps = null;
    mocks.homeComposerProps = null;
    root = createRoot(container);
    await act(async () => {
      root.render(<Index />);
    });

    expect(mocks.homeComposerProps).toMatchObject({
      draftScope: "design:home",
      layoutVariant: "hero",
    });
    expect(mocks.createDesign).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
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

describe("Index recent visibility", () => {
  it("shows only templates before the user creates a design", () => {
    const tabs = Array.from(
      container.querySelectorAll<HTMLElement>('[role="tab"]'),
    );
    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.textContent).toBe("navigation.templates");
    expect(container.textContent).not.toContain("home.recent");
    expect(
      container.querySelector('input[aria-label="home.searchPlaceholder"]'),
    ).not.toBeNull();
    const browseAll = container.querySelector<HTMLAnchorElement>(
      'a[href="/templates"]',
    );
    expect(browseAll?.textContent).toContain("home.browseAllTemplates");
  });
});
