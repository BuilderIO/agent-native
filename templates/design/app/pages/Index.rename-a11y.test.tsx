// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Index from "./Index";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setSearchParams: vi.fn(),
  queryClient: {
    setQueryData: vi.fn(),
    setQueriesData: vi.fn(),
    invalidateQueries: vi.fn(),
  },
  promptPopoverProps: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@agent-native/core/client/labs", () => ({
  useLab: () => false,
}));

vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/agent-chat")
  >()),
  useAgentEngineConfigured: () => ({ state: "configured", missing: false }),
  useChatModels: () => ({
    availableModels: [],
    configuredModels: [],
    defaultModel: "",
    selectedModel: "",
    selectedEngine: "",
    selectedEffort: "medium",
    isLoading: false,
    selectionReady: true,
    unavailableSelection: null,
    onModelChange: vi.fn(),
    onEffortChange: vi.fn(),
    refreshEngines: vi.fn(),
  }),
}));

vi.mock(
  "@agent-native/toolkit/app/chat/composer/index",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/toolkit/app/chat/composer/index")
    >()),
    PromptComposer: () => null,
    snapshotComposerContextItems: (items: unknown) => items,
    useAgentKitCapabilities: () => ({
      data: { sources: { figma: { available: false } }, integrations: [] },
    }),
    useAgentKitIntegrationMenu: () => ({
      id: "integrations",
      label: "Integrations",
      intent: "invoke-integration",
      picker: {},
    }),
  }),
);

vi.mock("@agent-native/toolkit/app/chat/chat/run-recovery", () => ({
  BuilderSetupCard: () => null,
  BuilderSetupContent: () => null,
}));

vi.mock("@agent-native/toolkit/app/settings", () => ({
  useBuilderConnectFlow: () => ({ connecting: false, start: vi.fn() }),
  BuilderConnectPopover: () => null,
}));

vi.mock("@/components/templates/TemplatePreview", () => ({
  TemplatePreview: () => null,
}));

vi.mock("@agent-native/core/client/collab", () => ({
  emailToColor: () => "#000000",
  emailToName: (email: string) => email,
}));

vi.mock("@agent-native/core/client/org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/org")>()),
  useOrg: () => ({ data: undefined }),
  useOrgMembers: () => ({ data: undefined }),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (name: string) => {
    if (name === "list-designs") {
      return {
        data: {
          count: 1,
          totalCount: 1,
          designs: [
            {
              id: "design-1",
              title: "Untitled Design",
              projectType: "prototype",
              updatedAt: "2026-08-01T00:00:00.000Z",
            },
          ],
        },
        isLoading: false,
        isSuccess: true,
      };
    }
    return { data: undefined, isLoading: false };
  },
  useActionMutation: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
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

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useFormatters: () => ({
    formatDate: (value: string) => value,
    formatNumber: String,
  }),
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/toolkit/app-shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/toolkit/app-shell")>()),
  useSetPageTitle: () => {},
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mocks.queryClient,
  useQuery: () => ({
    data: undefined,
    isError: false,
    isPending: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("react-router", () => ({
  useLocation: () => ({ search: "", hash: "", key: "test" }),
  useNavigationType: () => "POP",
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [new URLSearchParams(), mocks.setSearchParams],
  Link: ({ children }: { children: unknown }) => <>{children as never}</>,
}));

vi.mock("nanoid", () => ({
  nanoid: () => "design-new",
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

vi.mock("@/components/editor/PromptDialog", () => ({
  default: (props: Record<string, unknown>) => {
    mocks.promptPopoverProps = props;
    return null;
  },
}));

vi.mock("@/lib/agent-chat", () => ({
  sendToDesignAgentChat: vi.fn(),
}));

vi.mock("@/lib/pending-generation", () => ({
  writePendingGeneration: vi.fn(),
  clearPendingGeneration: vi.fn(),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuTrigger: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuRadioGroup: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuRadioItem: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
  }) => (
    <div role="menuitem" onClick={onClick}>
      {children}
    </div>
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipContent: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.promptPopoverProps = undefined;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Index />);
  });
  const recentTab = Array.from(
    container.querySelectorAll<HTMLElement>('[role="tab"]'),
  ).find((tab) => tab.textContent === "home.recent");
  await act(async () => {
    recentTab?.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0 }),
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

function resolveAccessibleName(input: HTMLInputElement): string | null {
  const ariaLabel = input.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel;

  const labelledbyId = input.getAttribute("aria-labelledby");
  if (labelledbyId) {
    return document.getElementById(labelledbyId)?.textContent ?? null;
  }

  if (input.id) {
    const label = document.body.querySelector(`label[for="${input.id}"]`);
    if (label) return label.textContent;
  }

  return null;
}

describe("Index rename dialog accessibility", () => {
  it("gives the rename text input an accessible name, not just a placeholder", async () => {
    const renameItem = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((el) => el.textContent === "home.rename");
    expect(renameItem).toBeTruthy();

    await act(async () => {
      renameItem!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const input = document.body.querySelector<HTMLInputElement>(
      'input[placeholder="home.designName"]',
    );
    expect(input).toBeTruthy();

    expect(resolveAccessibleName(input!)).toBeTruthy();
  });

  it("gives the Recent tab search input an accessible name", () => {
    const search = container.querySelector<HTMLInputElement>(
      'input[placeholder="home.searchPlaceholder"]',
    );
    expect(search).toBeTruthy();
    expect(resolveAccessibleName(search!)).toBeTruthy();
  });
  // oracle-change: Creative context removed from Design; its assertions no longer apply
});
