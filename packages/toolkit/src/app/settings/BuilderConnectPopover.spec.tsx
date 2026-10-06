// @vitest-environment happy-dom

import { WORKSPACE_SERVICES } from "@agent-native/core/onboarding/workspace-services";
import { TooltipProvider } from "@agent-native/toolkit/ui/tooltip";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT:
    () => (_key: string, options?: { defaultValue?: string; count?: number }) =>
      (options?.defaultValue ?? _key).replace(
        "{{count}}",
        String(options?.count ?? ""),
      ),
}));

vi.mock("@agent-native/core/client/onboarding/use-onboarding", () => ({
  useOnboarding: () => ({
    loading: false,
    error: null,
    profile: {
      capabilities: [
        {
          id: "llm",
          label: "AI model",
          required: true,
          builderIncluded: true,
          service: "model",
          keySummary: "Connect your own AI model",
          why: "The agent uses a language model.",
        },
        {
          id: "design-system-intelligence",
          label: "Design system intelligence",
          required: false,
          builderIncluded: true,
          service: "design-system-intelligence",
        },
        {
          id: "background-agents",
          label: "Background agents",
          required: false,
          builderIncluded: true,
          service: "background-agents",
        },
      ],
    },
  }),
}));

import { BuilderConnectPopover } from "./BuilderConnectPopover.js";
import { getBuilderIncludedBenefitCapabilities } from "./BuilderIncludedBenefitsDisclosure.js";
import { DeferredBuilderConnectPopover } from "./deferred-builder-connect-popover.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

it("shows all eight included services when an app profile omits design intelligence", () => {
  const clipsCapabilities = [
    ...WORKSPACE_SERVICES.filter((service) => service.everyApp).map(
      (service) => ({ ...service.capability, service: service.id }),
    ),
    {
      id: "system-one",
      label: "Decision model (Jev)",
      required: false,
      suggested: true,
      builderIncluded: true,
      keySummary: "Jev decision model key",
      why: "Uses Builder-managed access when available.",
    },
  ];
  const included = getBuilderIncludedBenefitCapabilities(clipsCapabilities);

  expect(included.map((capability) => capability.id)).toContain(
    "design-system-intelligence",
  );
  expect(
    included.filter(
      (capability) => capability.id !== "llm" && capability.service !== "model",
    ),
  ).toHaveLength(8);
});

function connectButton(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    "[data-testid='connect-builder']",
  );
  if (!button) throw new Error("connect trigger not rendered");
  return button;
}

function click(element: HTMLElement) {
  act(() => {
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
}

function render(node: React.ReactElement) {
  act(() => root.render(React.createElement(TooltipProvider, null, node)));
}

function trigger() {
  return React.createElement("button", {
    type: "button",
    "data-testid": "connect-builder",
  });
}

async function finishLazyLoad() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("BuilderConnectPopover", () => {
  it("shows the same chooser when one-click provisioning is unavailable", async () => {
    const onConnect = vi.fn();
    const flow = {
      connecting: false,
      start: vi.fn(),
      statusResolved: true,
      agentNativeProvisioningEnabled: false,
    };

    render(
      React.createElement(
        DeferredBuilderConnectPopover,
        {
          flow,
          onConnect,
          contentTestId: "consent",
          primaryTestId: "create",
          secondaryTestId: "sign-in",
        },
        trigger(),
      ),
    );
    click(connectButton());
    expect(flow.start).not.toHaveBeenCalled();
    expect(onConnect).not.toHaveBeenCalled();

    await finishLazyLoad();

    let consent = document.querySelector("[data-testid='consent']");
    expect(consent).not.toBeNull();
    expect(consent?.querySelector("[data-testid='create']")).not.toBeNull();
    expect(consent?.querySelector("[data-testid='sign-in']")).not.toBeNull();
    expect(
      consent?.querySelector<HTMLButtonElement>("[data-testid='create']")
        ?.disabled,
    ).toBe(true);

    click(consent?.querySelector("[data-testid='create']") as HTMLElement);
    expect(onConnect).not.toHaveBeenCalled();
    expect(flow.start).not.toHaveBeenCalled();

    click(consent?.querySelector("[data-testid='sign-in']") as HTMLElement);
    expect(onConnect).toHaveBeenLastCalledWith(false);
  });

  it("opens immediately while Builder status is unresolved", () => {
    const onConnect = vi.fn();
    const retry = vi.fn(() => true);
    const flow = {
      connecting: false,
      start: vi.fn(),
      retry,
      statusResolved: false,
      agentNativeProvisioningEnabled: false,
    };

    render(
      React.createElement(
        BuilderConnectPopover,
        {
          flow,
          onConnect,
          contentTestId: "consent",
          primaryTestId: "create",
          secondaryTestId: "sign-in",
        },
        trigger(),
      ),
    );
    click(connectButton());

    expect(document.querySelector("[data-testid='consent']")).not.toBeNull();
    expect(
      document.querySelector<HTMLButtonElement>("[data-testid='create']")
        ?.disabled,
    ).toBe(true);
    expect(retry).not.toHaveBeenCalled();
    expect(flow.start).not.toHaveBeenCalled();
  });

  it("offers a retry after a Builder status read fails", () => {
    const retry = vi.fn(() => true);
    const flow = {
      connecting: false,
      start: vi.fn(),
      retry,
      statusResolved: false,
      statusReadSettledCount: 1,
      agentNativeProvisioningEnabled: false,
    };

    render(
      React.createElement(
        BuilderConnectPopover,
        {
          flow,
          contentTestId: "consent",
          primaryTestId: "create",
          secondaryTestId: "sign-in",
        },
        trigger(),
      ),
    );
    click(connectButton());

    const consent = document.querySelector("[data-testid='consent']");
    expect(consent?.textContent).toContain(
      "Couldn't read the Builder.io connections.",
    );
    expect(consent?.querySelector("[data-testid='sign-in']")).not.toBeNull();
    click(
      [...(consent?.querySelectorAll("button") ?? [])].find(
        (button) => button.textContent === "Retry",
      ) as HTMLElement,
    );
    expect(retry).toHaveBeenCalledOnce();
    expect(
      consent?.querySelector<HTMLButtonElement>("[data-testid='create']")
        ?.disabled,
    ).toBe(true);
  });

  it("allows an explicit one-click handler for a custom flow", () => {
    const onConnect = vi.fn();
    const flow = {
      connecting: false,
      start: vi.fn(),
    };

    render(
      React.createElement(
        BuilderConnectPopover,
        {
          flow,
          onConnect,
          canProvisionAccount: true,
          contentTestId: "consent",
          primaryTestId: "create",
        },
        trigger(),
      ),
    );
    click(connectButton());

    const create = document.querySelector<HTMLButtonElement>(
      "[data-testid='create']",
    );
    expect(create?.disabled).toBe(false);
    click(create!);
    expect(onConnect).toHaveBeenCalledExactlyOnceWith(true);
    expect(flow.start).not.toHaveBeenCalled();
  });

  it("opens the chooser first and sends Create and activate to provisioning", async () => {
    const open = vi.spyOn(window, "open");
    const flow = {
      connecting: false,
      statusResolved: true,
      agentNativeProvisioningEnabled: true,
      start: vi.fn(),
    };

    render(
      React.createElement(
        DeferredBuilderConnectPopover,
        {
          flow,
          contentTestId: "consent",
          primaryTestId: "create",
          secondaryTestId: "sign-in",
        },
        trigger(),
      ),
    );
    click(connectButton());
    await finishLazyLoad();

    expect(document.body.textContent).toContain("Create and activate");
    expect(document.body.textContent).toContain("I have a Builder.io account");
    expect(flow.start).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();

    click(document.querySelector("[data-testid='create']") as HTMLElement);

    expect(flow.start).toHaveBeenCalledExactlyOnceWith({
      provisionAccount: true,
    });
    expect(open).not.toHaveBeenCalled();
  });

  it("keeps both choices and one-click creation when an account already exists", () => {
    const onConnect = vi.fn();
    const flow = {
      connecting: false,
      start: vi.fn(),
      statusResolved: true,
      agentNativeProvisioningEnabled: true,
      accountExists: true,
    };

    render(
      React.createElement(
        BuilderConnectPopover,
        {
          flow,
          onConnect,
          contentTestId: "consent",
          primaryTestId: "create",
          secondaryTestId: "sign-in",
        },
        trigger(),
      ),
    );
    click(connectButton());

    const consent = document.querySelector("[data-testid='consent']");
    expect(consent?.textContent).toContain(
      "Create or connect a Builder.io account in one click to get free credits.",
    );
    expect(consent?.textContent).toContain(
      "You already have a Builder.io account",
    );
    expect(consent?.querySelector("[data-testid='create']")?.textContent).toBe(
      "Create and activate",
    );
    expect(consent?.querySelector("[data-testid='sign-in']")?.textContent).toBe(
      "I have a Builder.io account",
    );
    expect(consent?.textContent).toContain("Activate free credits");
    expect(consent?.textContent).toContain("Terms of Service");
    expect(consent?.textContent).toContain("Privacy Policy");

    click(consent?.querySelector("[data-testid='create']") as HTMLElement);
    expect(onConnect).toHaveBeenLastCalledWith(true);
    click(connectButton());
    click(
      document.querySelector(
        "[data-testid='consent'] [data-testid='sign-in']",
      ) as HTMLElement,
    );
    expect(onConnect).toHaveBeenLastCalledWith(false);
  });

  it("reopens the same two choices after activation finds an existing account", () => {
    const flow = {
      connecting: false,
      start: vi.fn(),
      statusResolved: true,
      agentNativeProvisioningEnabled: true,
      accountExists: false,
    };
    const props = {
      flow,
      contentTestId: "consent",
      primaryTestId: "create",
      secondaryTestId: "sign-in",
    };

    render(React.createElement(BuilderConnectPopover, props, trigger()));
    click(connectButton());
    click(
      document.querySelector(
        "[data-testid='consent'] [data-testid='create']",
      ) as HTMLElement,
    );
    expect(flow.start).toHaveBeenCalledWith({ provisionAccount: true });

    render(
      React.createElement(
        BuilderConnectPopover,
        { ...props, flow: { ...flow, accountExists: true } },
        trigger(),
      ),
    );

    const consent = document.querySelector("[data-testid='consent']");
    expect(consent?.querySelector("[data-testid='create']")).not.toBeNull();
    expect(consent?.querySelector("[data-testid='sign-in']")).not.toBeNull();
    click(consent?.querySelector("[data-testid='create']") as HTMLElement);
    expect(flow.start).toHaveBeenLastCalledWith({ provisionAccount: true });
  });

  it("shows included services collapsed and stacks both choices above the terms", () => {
    const flow = {
      connecting: false,
      start: vi.fn(),
      statusResolved: true,
      agentNativeProvisioningEnabled: true,
    };
    const props = {
      flow,
      onConnect: vi.fn(),
      contentTestId: "consent",
      primaryTestId: "create",
      secondaryTestId: "sign-in",
    };

    render(React.createElement(BuilderConnectPopover, props, trigger()));
    click(connectButton());

    const consent = document.querySelector("[data-testid='consent']");
    const create = consent?.querySelector("[data-testid='create']");
    const signIn = consent?.querySelector("[data-testid='sign-in']");
    const terms = Array.from(consent?.querySelectorAll("p") ?? []).find((p) =>
      p.querySelector("a"),
    );
    expect(create && signIn && terms).toBeTruthy();
    expect(consent?.textContent).toContain("Included free");
    expect(consent?.textContent).toContain("60 monthly Agent Credits");
    expect(signIn?.parentElement).toBe(create?.parentElement);
    expect(create!.compareDocumentPosition(signIn!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(signIn!.compareDocumentPosition(terms!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(signIn!.className).toContain("bg-secondary");

    const services = consent?.querySelector<HTMLElement>(
      "[data-testid='builder-included-services']",
    );
    const servicesToggle = services?.querySelector<HTMLButtonElement>(
      "button[aria-expanded]",
    );
    expect(servicesToggle?.getAttribute("aria-expanded")).toBe("false");
    expect(
      Array.from(
        servicesToggle?.querySelectorAll(":scope > span > span") ?? [],
      ).map((line) => line.textContent),
    ).toEqual([
      "Included free",
      "60 monthly Agent Credits",
      "+ 2 more services",
    ]);
    click(servicesToggle!);
    expect(servicesToggle?.getAttribute("aria-expanded")).toBe("true");
  });
});

it("shows a cancel action while the Builder connection is waiting", () => {
  const cancel = vi.fn();
  render(
    React.createElement(
      BuilderConnectPopover,
      {
        flow: {
          connecting: true,
          start: vi.fn(),
          cancel,
          statusResolved: true,
          agentNativeProvisioningEnabled: false,
        },
      },
      trigger(),
    ),
  );

  const buttons = container.querySelectorAll("button");
  expect(buttons).toHaveLength(2);
  expect(buttons[1]?.textContent).toBe("common.cancel");
  click(buttons[1]!);
  expect(cancel).toHaveBeenCalledTimes(1);
});
