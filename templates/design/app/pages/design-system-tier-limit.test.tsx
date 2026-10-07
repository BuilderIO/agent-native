// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import DesignSystems from "./DesignSystems";
import DesignSystemSetup from "./DesignSystemSetup";

const mocks = vi.hoisted(() => ({
  workflowsState: { status: "ready", enabled: true } as {
    status: "loading" | "ready" | "unavailable";
    enabled: boolean;
  },
  systems: [] as Array<Record<string, unknown>>,
  headerActions: null as unknown,
  queries: vi.fn(),
  navigate: vi.fn(),
  queryClient: { setQueryData: vi.fn(), invalidateQueries: vi.fn() },
  tierLimit: null as Record<string, unknown> | null,
  uploadAndIndexFigmaFiles: vi.fn(),
}));

vi.mock("@/hooks/use-design-system-workflows", () => ({
  useDesignSystemWorkflows: () =>
    mocks.workflowsState.status === "ready" && mocks.workflowsState.enabled,
  useDesignSystemWorkflowsState: () => mocks.workflowsState,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (action: string) => {
    mocks.queries(action);
    if (action === "get-design-system-tier-limit") {
      return { data: mocks.tierLimit };
    }
    if (action === "list-designs") {
      return { data: { designs: [] } };
    }
    if (action === "list-design-systems") {
      return {
        data: { designSystems: mocks.systems },
        isLoading: false,
        isError: false,
        isFetching: false,
        refetch: vi.fn(),
      };
    }
    return { data: undefined };
  },
  useActionMutation: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

vi.mock("@agent-native/core/client/navigation", () => ({
  openAgentSidebar: () => {},
}));

vi.mock("@agent-native/toolkit/app/sharing", () => ({
  ShareButton: () => null,
}));

vi.mock("@agent-native/toolkit/app-shell", () => ({
  useSetHeaderActions: (actions: unknown) => {
    mocks.headerActions = actions;
  },
  useSetPageTitle: () => {},
}));

vi.mock("@agent-native/toolkit/sharing", () => ({
  VisibilityBadge: () => null,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mocks.queryClient,
}));

vi.mock("@/lib/agent-chat", () => ({
  sendToDesignAgentChat: () => {},
}));

vi.mock("@/lib/builder-design-system-upload", () => ({
  uploadAndIndexFigmaFiles: mocks.uploadAndIndexFigmaFiles,
  pollDecodeJobStatus: vi.fn(),
}));

vi.mock("react-router", () => ({
  Link: ({
    to,
    onClick,
    children,
    ...rest
  }: {
    to: string;
    onClick?: (event: any) => void;
    children?: any;
    [key: string]: any;
  }) => (
    <a href={to} onClick={onClick} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [new URLSearchParams(""), vi.fn()],
}));

let container: HTMLDivElement;
let root: Root;
let headerContainer: HTMLDivElement;
let headerRoot: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.tierLimit = null;
  mocks.workflowsState = { status: "ready", enabled: true };
  mocks.systems = [];
  mocks.headerActions = null;
  mocks.uploadAndIndexFigmaFiles.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  headerContainer = document.createElement("div");
  document.body.append(headerContainer);
  headerRoot = createRoot(headerContainer);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
    headerRoot.unmount();
  });
  container.remove();
  headerContainer.remove();
});

describe("DesignSystems list page tier-limit gating", () => {
  it("hides creation links while leaving the saved systems route available", async () => {
    mocks.workflowsState = { status: "ready", enabled: false };
    await act(async () => root.render(<DesignSystems />));
    expect(
      container.querySelector('a[href="/design-systems/setup"]'),
    ).toBeNull();
    expect(container.textContent).toContain("designSystems.waitlist.join");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("offers the waitlist in the header when saved systems already exist", async () => {
    mocks.workflowsState = { status: "ready", enabled: false };
    mocks.systems = [
      {
        id: "system-1",
        title: "Acme",
        data: "{}",
        isDefault: false,
        visibility: "private",
        accessRole: "owner",
        canManage: true,
        createdAt: "2026-10-06T00:00:00.000Z",
      },
    ];

    await act(async () =>
      root.render(
        <TooltipProvider>
          <DesignSystems />
        </TooltipProvider>,
      ),
    );
    await act(async () =>
      headerRoot.render(
        <TooltipProvider>{mocks.headerActions as ReactNode}</TooltipProvider>,
      ),
    );

    expect(headerContainer.textContent).toContain(
      "designSystems.waitlist.join",
    );
    expect(
      headerContainer.querySelector('a[href="/design-systems/setup"]'),
    ).toBeNull();
  });

  it("does not show the waitlist until the feature flag is ready", async () => {
    mocks.workflowsState = { status: "loading", enabled: false };
    await act(async () => root.render(<DesignSystems />));

    expect(container.textContent).not.toContain("designSystems.waitlist.join");

    mocks.workflowsState = { status: "unavailable", enabled: false };
    await act(async () => root.render(<DesignSystems />));
    expect(container.textContent).not.toContain("designSystems.waitlist.join");
  });
  it("blocks the create link and shows upgrade messaging at the tier cap", async () => {
    mocks.tierLimit = {
      status: "ok",
      plan: "free",
      current: 1,
      max: 1,
      atMax: true,
      codeIndexingAllowed: false,
      upgradeUrl: "https://builder.io/account/subscription",
    };

    await act(async () => {
      root.render(<DesignSystems />);
    });

    const link = container.querySelector(
      'a[href="/design-systems/setup"]',
    ) as HTMLAnchorElement | null;
    expect(link).toBeTruthy();

    await act(async () => {
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      document.body.textContent?.includes("designSystems.tierLimitTitle"),
    ).toBe(true);
    expect(
      document.body.querySelector(
        'a[href="https://builder.io/account/subscription"]',
      ),
    ).toBeTruthy();
  });
});

describe("DesignSystemSetup tier-limit gating", () => {
  it("offers the waitlist only for a ready off flag and opens setup when enabled", async () => {
    mocks.workflowsState = { status: "ready", enabled: false };
    await act(async () => root.render(<DesignSystemSetup />));
    expect(container.querySelector('a[href="/design-systems"]')).not.toBeNull();
    expect(container.textContent).toContain("designSystems.waitlist.join");
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.queries).not.toHaveBeenCalled();

    mocks.workflowsState = { status: "loading", enabled: false };
    await act(async () => root.render(<DesignSystemSetup />));
    expect(container.textContent).not.toContain("designSystems.waitlist.join");

    mocks.workflowsState = { status: "ready", enabled: true };
    await act(async () => root.render(<DesignSystemSetup />));
    expect(container.textContent).toContain("designSystemSetup.title");
    expect(mocks.queries).toHaveBeenCalledWith("get-design-system-tier-limit");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("blocks the setup form entirely and shows upgrade messaging at the tier cap", async () => {
    mocks.tierLimit = {
      status: "ok",
      plan: "pro",
      current: 3,
      max: 3,
      atMax: true,
      codeIndexingAllowed: false,
      upgradeUrl: "https://builder.io/account/subscription",
    };

    await act(async () => {
      root.render(<DesignSystemSetup />);
    });

    expect(
      container.textContent?.includes("designSystems.tierLimitTitle"),
    ).toBe(true);
    expect(container.querySelector('a[href="/design-systems"]')).toBeTruthy();
    expect(
      container.querySelector(
        'a[href="https://builder.io/account/subscription"]',
      ),
    ).toBeTruthy();
  });

  it("locks the code/source-repo source for non-Enterprise plans, unlocks it for Enterprise", async () => {
    mocks.tierLimit = {
      status: "ok",
      plan: "free",
      current: 0,
      max: 1,
      atMax: false,
      codeIndexingAllowed: false,
      upgradeUrl: "https://builder.io/account/subscription",
    };

    await act(async () => {
      root.render(<DesignSystemSetup />);
    });

    const codeButton = () =>
      Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("designSystemSetup.sections.code.title"),
      );
    expect(codeButton()?.getAttribute("aria-disabled")).toBe("true");

    mocks.tierLimit = {
      status: "ok",
      plan: "enterprise",
      current: 12,
      max: null,
      atMax: false,
      codeIndexingAllowed: true,
      upgradeUrl: null,
    };
    await act(async () => {
      root.render(<DesignSystemSetup />);
    });
    expect(codeButton()?.getAttribute("aria-disabled")).toBe("false");
  });

  it("surfaces the upgrade link on a 402 from the Figma upload/index path", async () => {
    mocks.tierLimit = {
      status: "ok",
      plan: "free",
      current: 0,
      max: 1,
      atMax: false,
      codeIndexingAllowed: false,
      upgradeUrl: "https://builder.io/account/subscription",
    };
    mocks.uploadAndIndexFigmaFiles.mockRejectedValue(
      Object.assign(new Error("You have reached your design system limit"), {
        errorCode: "design_system_tier_limit_exceeded",
        details: {
          plan: "free",
          current: 1,
          max: 1,
          upgradeUrl: "https://builder.io/account/subscription",
        },
      }),
    );

    await act(async () => {
      root.render(<DesignSystemSetup />);
    });

    const figmaButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("designSystemSetup.sections.figma.title"),
    ) as HTMLButtonElement;
    await act(async () => {
      figmaButton?.click();
      await Promise.resolve();
    });

    const figInput = container.querySelector(
      'input[type="file"][accept=".fig"]',
    ) as HTMLInputElement;
    const file = new File(["fake"], "brand.fig", {
      type: "application/octet-stream",
    });
    Object.defineProperty(figInput, "files", { value: [file] });

    await act(async () => {
      figInput.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.textContent?.includes(
        "You have reached your design system limit",
      ),
    ).toBe(true);
    expect(
      container.querySelector(
        'a[href="https://builder.io/account/subscription"]',
      ),
    ).toBeTruthy();
  });
});
