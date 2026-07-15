// @vitest-environment happy-dom

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
}));

vi.mock("@agent-native/core/client", () => ({
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
  useT: () => (key: string) => {
    if (key === "home.untitledDesign") return "Untitled Design";
    if (key === "home.skipToEditor") return "Skip to editor";
    if (key === "home.failedToCreateDesign") {
      return "Failed to create design";
    }
    return key;
  },
}));

vi.mock("@agent-native/toolkit/app-shell", () => ({
  useSetHeaderActions: () => {},
  useSetPageTitle: () => {},
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mocks.queryClient,
}));

vi.mock("react-router", () => ({
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [new URLSearchParams(), mocks.setSearchParams],
  Link: ({ children }: { children: unknown }) => <>{children as never}</>,
}));

vi.mock("nanoid", () => ({
  nanoid: () => mocks.nanoid(),
}));

vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => mocks.toastError(...args) },
}));

vi.mock("@/components/editor/PromptDialog", () => ({
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
        isDefault: true,
      },
      {
        id: "linked-system",
        title: "Linked system",
        isDefault: false,
      },
      {
        id: "override-system",
        title: "Override system",
        isDefault: false,
      },
    ],
    defaultSystem: {
      id: "default-system",
      title: "Default system",
      isDefault: true,
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
    adaptationPending: true,
    templateBaselineFiles: [{ id: "file-1", contentHash: "baseline" }],
  });
  mocks.queryClient.invalidateQueries.mockResolvedValue(undefined);
  mocks.promptProps = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Index />);
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

describe("Index skip to editor", () => {
  it("persists one empty shell before navigating without starting generation", async () => {
    let resolveCreate: (() => void) | undefined;
    mocks.createDesign.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveCreate = resolve;
      }),
    );

    expect(mocks.promptProps?.skipLabel).toBe("Skip to editor");
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

  it("preselects a saved template system and sends an explicit override through empty-prompt copy", async () => {
    await act(async () => {
      mocks.promptProps?.onTemplateChange("saved-template");
    });

    expect(mocks.promptProps?.selectedTemplateId).toBe("saved-template");
    expect(mocks.promptProps?.selectedDesignSystemId).toBe("linked-system");
    expect(mocks.promptProps?.skipLabel).toBe("templatesPage.useTemplate");

    await act(async () => {
      mocks.promptProps?.onDesignSystemChange("override-system");
    });

    await act(async () => {
      await mocks.promptProps?.onSkip();
    });

    expect(mocks.createFromTemplate).toHaveBeenCalledWith({
      templateId: "saved-template",
      title: "Saved template",
      designSystemId: "override-system",
    });
    expect(mocks.createDesign).not.toHaveBeenCalled();
    expect(mocks.writePendingGeneration).toHaveBeenCalledWith(
      "copied-design",
      expect.objectContaining({
        templateId: "saved-template",
        designSystemId: "override-system",
        templateBaselineFiles: [{ id: "file-1", contentHash: "baseline" }],
      }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith("/design/copied-design");
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
