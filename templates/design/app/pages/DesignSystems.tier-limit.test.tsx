// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DesignSystems from "./DesignSystems";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  queryClient: { setQueryData: vi.fn(), invalidateQueries: vi.fn() },
  tierLimit: null as Record<string, unknown> | null,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (action: string) => {
    if (action === "get-design-system-tier-limit") {
      return { data: mocks.tierLimit };
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
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("DesignSystems tier-limit gating", () => {
  it("does not intercept the create link when under the tier cap", async () => {
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
      root.render(<DesignSystems />);
    });

    const link = container.querySelector(
      'a[href="/design-systems/setup"]',
    ) as HTMLAnchorElement | null;
    expect(link).toBeTruthy();

    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    link?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(
      container.textContent?.includes("designSystems.tierLimitTitle"),
    ).toBe(false);
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
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      link?.dispatchEvent(event);
    });

    expect(
      document.body.textContent?.includes("designSystems.tierLimitTitle"),
    ).toBe(true);
    const upgradeLink = document.body.querySelector(
      'a[href="https://builder.io/account/subscription"]',
    );
    expect(upgradeLink).toBeTruthy();
  });
});
