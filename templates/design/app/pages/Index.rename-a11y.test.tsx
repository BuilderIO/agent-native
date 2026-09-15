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
  headerActions: null as unknown,
}));

vi.mock("@agent-native/core/client/feature-flags", () => ({
  useFeatureFlag: () => false,
}));

vi.mock("@agent-native/core/client/collab", () => ({
  emailToColor: () => "#000000",
  emailToName: (email: string) => email,
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrgMembers: () => ({ data: undefined }),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (name: string) => {
    if (name === "list-designs") {
      return {
        data: {
          count: 1,
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

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/toolkit/app-shell", () => ({
  // The real hook portals its argument into app-shell chrome outside this
  // tree; capture it so the search input (also passed here) can be rendered
  // and inspected directly.
  useSetHeaderActions: (node: unknown) => {
    mocks.headerActions = node;
  },
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
  nanoid: () => "design-new",
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

vi.mock("@/components/editor/PromptDialog", () => ({
  default: () => null,
}));

vi.mock("@/hooks/use-design-systems", () => ({
  useDesignSystems: () => ({
    designSystems: [],
    defaultSystem: null,
    isLoading: false,
  }),
}));

vi.mock("@/lib/agent-chat", () => ({
  sendToDesignAgentChat: vi.fn(),
}));

vi.mock("@/lib/pending-generation", () => ({
  writePendingGeneration: vi.fn(),
  clearPendingGeneration: vi.fn(),
}));

// The dropdown menu's open/close choreography (Radix pointer events, focus
// return) is orthogonal to what this test checks — collapse it to plain
// always-rendered markup so the "Rename" item is directly clickable.
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

// Same reasoning as the dropdown-menu mock above: Radix Tooltip needs a
// TooltipProvider ancestor the real page tree supplies elsewhere; strip it to
// plain markup since this test doesn't exercise tooltip behavior.
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
      // The app opens the rename dialog from a setTimeout (dodging a Radix
      // dropdown-close focus race) — flush that macrotask.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const input = document.body.querySelector<HTMLInputElement>(
      'input[placeholder="home.designName"]',
    );
    expect(input).toBeTruthy();

    // A placeholder is not an accessible name (WCAG) — screen readers and
    // Playwright's getByLabel() both need aria-label/aria-labelledby or a
    // paired <label>.
    expect(resolveAccessibleName(input!)).toBeTruthy();
  });

  it("gives the search text input an accessible name too (same placeholder-only pattern)", async () => {
    // The search input lives in header actions, which the real app renders
    // in app-shell chrome outside this component's own tree — mount the
    // captured node separately to inspect it.
    const headerContainer = document.createElement("div");
    document.body.append(headerContainer);
    const headerRoot = createRoot(headerContainer);
    await act(async () => {
      headerRoot.render(mocks.headerActions as React.ReactElement);
    });

    const search = headerContainer.querySelector<HTMLInputElement>(
      'input[placeholder="home.searchPlaceholder"]',
    );
    expect(search).toBeTruthy();
    expect(resolveAccessibleName(search!)).toBeTruthy();

    await act(async () => headerRoot.unmount());
    headerContainer.remove();
  });
});
