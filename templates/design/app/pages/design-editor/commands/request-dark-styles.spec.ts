// @vitest-environment happy-dom

import { detectDarkStyleSupport } from "@shared/preview-color-scheme";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendToDesignAgentChat: vi.fn(() => "tab-1"),
}));
vi.mock("@/lib/agent-chat", () => ({
  sendToDesignAgentChat: mocks.sendToDesignAgentChat,
}));

import {
  DARK_STYLE_CONVENTIONS,
  runRequestDarkStyles,
} from "./request-dark-styles";

afterEach(() => {
  mocks.sendToDesignAgentChat.mockClear();
});

const args = {
  designId: "design-1",
  designTitle: "Landing",
  activeFile: { id: "file-1", filename: "home.html" },
};

function sent() {
  expect(mocks.sendToDesignAgentChat).toHaveBeenCalledOnce();
  return (
    mocks.sendToDesignAgentChat.mock.calls[0] as unknown as [
      {
        message: string;
        context: string;
        submit: boolean;
        openSidebar: boolean;
      },
    ]
  )[0];
}

describe("runRequestDarkStyles", () => {
  it("fills the composer and opens the panel without sending", () => {
    runRequestDarkStyles(args);
    const request = sent();
    expect(request.submit).toBe(false);
    expect(request.openSidebar).toBe(true);
    expect(request.message).toMatch(/dark theme/i);
  });

  it("asks for the convention the design already follows, then prefers-color-scheme", () => {
    runRequestDarkStyles(args);
    const { message } = sent();
    expect(message).toContain("prefers-color-scheme: dark");
    expect(message).toContain(".dark");
    expect(message).toMatch(/already/i);
  });

  it("names only conventions the picker's own detection recognizes", () => {
    for (const convention of DARK_STYLE_CONVENTIONS) {
      expect(detectDarkStyleSupport({ css: [convention] }).support).toBe("yes");
    }
    runRequestDarkStyles(args);
    const { message } = sent();
    for (const convention of DARK_STYLE_CONVENTIONS) {
      expect(message).toContain(convention);
    }
  });

  it("points the agent at the design and the screen being previewed", () => {
    runRequestDarkStyles(args);
    const { context } = sent();
    expect(context).toContain("designId: design-1");
    expect(context).toContain("Active screen: home.html (fileId: file-1)");
  });

  it("still sends a usable request when the design has no active screen", () => {
    runRequestDarkStyles({ designId: undefined, activeFile: null });
    expect(sent().message).toMatch(/dark theme/i);
  });
});
