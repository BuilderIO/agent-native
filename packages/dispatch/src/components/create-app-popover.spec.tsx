// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreateAppFlow } from "./create-app-popover";

const sendToAgentChatMock = vi.hoisted(() => vi.fn());
const devState = vi.hoisted(() => ({ isDevMode: false }));
const frameState = vi.hoisted(() => ({ inBuilderFrame: false }));
const builderConnectFlowState = vi.hoisted(() => ({
  connecting: false,
  start: vi.fn(),
}));
const startWorkspaceAppCreationResponse = vi.hoisted<{ result: unknown }>(
  () => ({
    result: {
      mode: "builder",
      appId: "qa-dashboard",
      url: "https://branch.example.test",
    },
  }),
);

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: sendToAgentChatMock,
  useDevMode: () => ({ isDevMode: devState.isDevMode }),
}));

vi.mock("@agent-native/core/client/host", () => ({
  isInBuilderFrame: () => frameState.inBuilderFrame,
}));

vi.mock("@agent-native/core/client/settings/useBuilderStatus", () => ({
  useBuilderConnectFlow: () => ({
    configured: false,
    connecting: builderConnectFlowState.connecting,
    error: null,
    start: builderConnectFlowState.start,
  }),
}));

vi.mock("@agent-native/core/client/composer", async () => {
  const ReactModule = await import("react");
  return {
    PromptComposer: ({
      onSubmit,
      placeholder,
      disabled,
    }: {
      onSubmit: (text: string, files: File[], references: unknown[]) => void;
      placeholder?: string;
      disabled?: boolean;
    }) => {
      const [value, setValue] = ReactModule.useState("");
      return ReactModule.createElement(
        "div",
        null,
        ReactModule.createElement("textarea", {
          "aria-label": "Prompt",
          placeholder,
          value,
          onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
            setValue(event.target.value),
        }),
        ReactModule.createElement(
          "button",
          {
            disabled: disabled || !value.trim(),
            onClick: () => onSubmit(value, [], []),
            type: "button",
          },
          "Create app",
        ),
      );
    },
  };
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes(text),
  );
  if (!button) throw new Error(`Button not found: ${text}`);
  return button as HTMLButtonElement;
}

function changeValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(element),
    "value",
  )?.set;
  act(() => {
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("CreateAppFlow", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    devState.isDevMode = false;
    frameState.inBuilderFrame = false;
    builderConnectFlowState.connecting = false;
    builderConnectFlowState.start.mockReset();
    startWorkspaceAppCreationResponse.result = {
      mode: "builder",
      appId: "qa-dashboard",
      url: "https://branch.example.test",
    };
    sendToAgentChatMock.mockReset();
    fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("get-vault-access-settings")) {
        return jsonResponse({ mode: "all-apps" });
      }
      if (url.includes("list-vault-secret-options")) {
        return jsonResponse([]);
      }
      if (url.includes("list-workspace-resource-options")) {
        return jsonResponse([]);
      }
      if (url.includes("start-workspace-app-creation")) {
        return jsonResponse(startWorkspaceAppCreationResponse.result);
      }
      return jsonResponse({ error: `Unexpected URL: ${url}` }, 404);
    });
    vi.stubGlobal("fetch", fetchSpy);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function renderAndSubmit(prompt: string) {
    await act(async () => {
      root.render(React.createElement(CreateAppFlow, {}));
    });

    changeValue(
      container.querySelector('textarea[aria-label="Prompt"]')!,
      prompt,
    );

    await act(async () => {
      findButton(container, "Create app").click();
    });
  }

  it("renders a Connect Builder control when Builder is not connected", async () => {
    startWorkspaceAppCreationResponse.result = {
      mode: "builder-unavailable",
      reason: "builder-not-connected",
      message: "Connect Builder for this user",
      appId: "quality",
    };
    await renderAndSubmit("Build a quality dashboard");

    await act(async () => {
      await vi.waitFor(() =>
        expect(container.textContent).toContain(
          "Connect Builder for this user",
        ),
      );
    });

    const connectButton = findButton(container, "Connect Builder");
    act(() => {
      connectButton.click();
    });
    expect(builderConnectFlowState.start).toHaveBeenCalledTimes(1);
  });

  it("renders the error affordance and a Try again control for builder-error, without a Connect Builder control", async () => {
    startWorkspaceAppCreationResponse.result = {
      mode: "builder-unavailable",
      reason: "builder-error",
      message: "Builder rejected the request.",
      appId: "quality",
      detail: "500 from Builder",
      projectId: "proj_1",
    };
    await renderAndSubmit("Build a quality dashboard");

    await act(async () => {
      await vi.waitFor(() =>
        expect(container.textContent).toContain(
          "Builder rejected the request.",
        ),
      );
    });

    const matchingDivs = Array.from(container.querySelectorAll("div")).filter(
      (el) => el.textContent?.includes("Builder rejected the request."),
    );
    expect(
      matchingDivs.some((el) => el.className.includes("border-destructive")),
    ).toBe(true);

    expect(() => findButton(container, "Connect Builder")).toThrow();
    expect(findButton(container, "Try again")).toBeTruthy();
  });

  it("renders coming-soon messages neutrally with no Connect Builder control", async () => {
    startWorkspaceAppCreationResponse.result = {
      mode: "coming-soon",
      message: "This template is coming soon.",
      appId: "quality",
    };
    await renderAndSubmit("Build a quality dashboard");

    await act(async () => {
      await vi.waitFor(() =>
        expect(container.textContent).toContain(
          "This template is coming soon.",
        ),
      );
    });

    const matchingDivs = Array.from(container.querySelectorAll("div")).filter(
      (el) => el.textContent?.includes("This template is coming soon."),
    );
    expect(
      matchingDivs.some((el) => el.className.includes("border-destructive")),
    ).toBe(false);
    expect(() => findButton(container, "Connect Builder")).toThrow();
    expect(() => findButton(container, "Try again")).toThrow();
  });
});
