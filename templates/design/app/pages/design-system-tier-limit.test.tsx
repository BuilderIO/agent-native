// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DesignSystems from "./DesignSystems";
import DesignSystemSetup from "./DesignSystemSetup";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  queryClient: { setQueryData: vi.fn(), invalidateQueries: vi.fn() },
  tierLimit: null as Record<string, unknown> | null,
  uploadAndIndexFigmaFiles: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (action: string) => {
    if (action === "get-design-system-tier-limit") {
      return { data: mocks.tierLimit };
    }
    if (action === "list-designs") {
      return { data: { designs: [] } };
    }
    if (action === "list-design-systems") {
      return {
        data: { designSystems: [] },
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

vi.mock("@agent-native/core/client/sharing", () => ({
  ShareButton: () => null,
}));

vi.mock("@agent-native/toolkit/app-shell", () => ({
  useSetHeaderActions: () => {},
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

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.tierLimit = null;
  mocks.uploadAndIndexFigmaFiles.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("DesignSystems list page tier-limit gating", () => {
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
