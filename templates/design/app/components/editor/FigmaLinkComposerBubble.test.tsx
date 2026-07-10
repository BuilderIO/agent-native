// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { extractFigmaLink } from "@/lib/figma-url";

import { FigmaLinkComposerBubble } from "./FigmaLinkComposerBubble";

const connectionMocks = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
}));
const sendToDesignAgentChat = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client", () => ({
  useT:
    () =>
    (key: string, options?: Record<string, unknown>): string =>
      options ? `${key}:${JSON.stringify(options)}` : key,
}));

vi.mock("@/lib/figma-connection", () => ({
  getFigmaConnectionStatus: (...args: unknown[]) =>
    connectionMocks.get(...args),
  saveFigmaAccessToken: (...args: unknown[]) => connectionMocks.save(...args),
}));

vi.mock("@/lib/agent-chat", () => ({
  sendToDesignAgentChat: (...args: unknown[]) => sendToDesignAgentChat(...args),
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const frameLink = extractFigmaLink(
  "https://www.figma.com/design/FileKey1/Checkout?node-id=1-2",
)!;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  connectionMocks.get.mockReset();
  connectionMocks.save.mockReset();
  sendToDesignAgentChat.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.replaceChildren();
});

async function renderBubble(designId?: string) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <FigmaLinkComposerBubble link={frameLink} designId={designId} />,
    );
    await Promise.resolve();
  });
}

function button(label: string): HTMLButtonElement {
  const match = [...container!.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

describe("FigmaLinkComposerBubble", () => {
  it("asks for a token when Figma is not connected and saves it outside chat", async () => {
    connectionMocks.get.mockResolvedValue({
      connected: false,
      status: "unset",
      key: "FIGMA_ACCESS_TOKEN",
      label: "Figma access token",
    });
    connectionMocks.save.mockResolvedValue({
      connected: true,
      status: "set",
      key: "FIGMA_ACCESS_TOKEN",
      label: "Figma access token",
      last4: "1234",
    });
    await renderBubble("design-1");

    const input = container!.querySelector<HTMLInputElement>(
      'input[type="password"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "figma-token-example");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      button("chat.figmaLink.connect").click();
      await Promise.resolve();
    });

    expect(connectionMocks.save).toHaveBeenCalledWith("figma-token-example");
    expect(sendToDesignAgentChat).not.toHaveBeenCalled();
    expect(container!.querySelector('input[type="password"]')).toBeNull();
    expect(container!.textContent).toContain("chat.figmaLink.importFrame");
  });

  it("clears a rejected token from the password field", async () => {
    connectionMocks.get.mockResolvedValue({
      connected: false,
      status: "unset",
      key: "FIGMA_ACCESS_TOKEN",
      label: "Figma access token",
    });
    connectionMocks.save.mockRejectedValue(
      new Error("Figma rejected this token (401)."),
    );
    await renderBubble("design-1");

    const input = container!.querySelector<HTMLInputElement>(
      'input[type="password"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "figma-token-example");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      button("chat.figmaLink.connect").click();
      await Promise.resolve();
    });

    expect(input.value).toBe("");
    expect(container!.textContent).toContain(
      "Figma rejected this token (401).",
    );
  });

  it("prefills an explicit import request without exposing internal context markup", async () => {
    connectionMocks.get.mockResolvedValue({
      connected: true,
      status: "set",
      key: "FIGMA_ACCESS_TOKEN",
      label: "Figma access token",
      last4: "5678",
    });
    await renderBubble("design-42");

    await act(async () => button("chat.figmaLink.importFrame").click());

    expect(sendToDesignAgentChat).toHaveBeenCalledWith({
      message:
        "Import this Figma frame into the current Design and report any fidelity differences: https://www.figma.com/design/FileKey1/Checkout?node-id=1-2",
      submit: false,
      openSidebar: false,
    });
  });

  it("keeps the newest connection result when status checks finish out of order", async () => {
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    connectionMocks.get
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
      );
    await renderBubble("design-1");

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agent-engine:configured-changed", {
          detail: { key: "FIGMA_ACCESS_TOKEN" },
        }),
      );
      resolveSecond({
        connected: true,
        status: "set",
        key: "FIGMA_ACCESS_TOKEN",
        label: "Figma access token",
      });
      await Promise.resolve();
    });
    await act(async () => {
      resolveFirst({
        connected: false,
        status: "unset",
        key: "FIGMA_ACCESS_TOKEN",
        label: "Figma access token",
      });
      await Promise.resolve();
    });

    expect(container!.textContent).toContain("chat.figmaLink.importFrame");
    expect(container!.querySelector('input[type="password"]')).toBeNull();
  });

  it("does not ask for a token when connection status is unknown", async () => {
    connectionMocks.get.mockRejectedValue(new Error("status unavailable"));
    await renderBubble("design-1");

    expect(container!.textContent).toContain("status unavailable");
    expect(container!.querySelector('input[type="password"]')).toBeNull();
    expect(container!.textContent).toContain("chat.figmaLink.retry");
  });

  it("does not offer an export action when no Design is open", async () => {
    connectionMocks.get.mockResolvedValue({
      connected: true,
      status: "set",
      key: "FIGMA_ACCESS_TOKEN",
      label: "Figma access token",
    });
    await renderBubble();

    expect(button("chat.figmaLink.exportSvg").disabled).toBe(true);
  });
});
