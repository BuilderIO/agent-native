// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isBuildAppOrAgentRequest,
  isInBuilderFrame,
  sendToBuilderChat,
  shouldParentFrameOwnAgentPanel,
} from "./builder-frame.js";

function setParentWindow(value: unknown) {
  Object.defineProperty(window, "parent", {
    configurable: true,
    value,
  });
}

function setAncestorOrigin(origin: string | null) {
  Object.defineProperty(window.location, "ancestorOrigins", {
    configurable: true,
    value: origin
      ? {
          0: origin,
          length: 1,
          item: (index: number) => (index === 0 ? origin : null),
        }
      : undefined,
  });
}

describe("isInBuilderFrame", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    setParentWindow(window);
    setAncestorOrigin(null);
  });

  it("does not treat a plain top-level page as Builder", () => {
    expect(isInBuilderFrame()).toBe(false);
  });

  it("treats Builder preview params as Builder in top-level webviews", () => {
    window.history.replaceState({}, "", "/?builder.preview=interact");

    expect(isInBuilderFrame()).toBe(true);
  });
});

describe("shouldParentFrameOwnAgentPanel", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    setParentWindow(window);
    setAncestorOrigin(null);
  });

  afterEach(() => {
    setParentWindow(window);
    setAncestorOrigin(null);
  });

  it("defers to the parent frame for plain local dev iframes", () => {
    setParentWindow({ postMessage: vi.fn() });

    expect(shouldParentFrameOwnAgentPanel()).toBe(true);
  });

  it("keeps the app chat panel active for Builder web iframes marked by query params", () => {
    setParentWindow({ postMessage: vi.fn() });
    window.history.replaceState({}, "", "/?builder.preview=interact");

    expect(shouldParentFrameOwnAgentPanel()).toBe(false);
  });

  it("keeps the app chat panel active for Builder parent origins", () => {
    setParentWindow({ postMessage: vi.fn() });
    setAncestorOrigin("https://builder.io");

    expect(shouldParentFrameOwnAgentPanel()).toBe(false);
  });
});

describe("sendToBuilderChat", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    setParentWindow(window);
    setAncestorOrigin(null);
  });

  afterEach(() => {
    setParentWindow(window);
    setAncestorOrigin(null);
    vi.restoreAllMocks();
  });

  it("posts once to a Builder parent frame without using the console relay", () => {
    const parentPostMessage = vi.fn();
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    setParentWindow({ postMessage: parentPostMessage });
    setAncestorOrigin("https://builder.io");

    const sent = sendToBuilderChat({
      message: "build a dispatch helper app",
      submit: true,
    });

    expect(sent).toBe(true);
    expect(parentPostMessage).toHaveBeenCalledOnce();
    expect(parentPostMessage).toHaveBeenCalledWith(
      {
        type: "builder.submitChat",
        data: {
          message: "build a dispatch helper app",
          context: undefined,
          submit: true,
        },
      },
      "https://builder.io",
    );
    expect(consoleLog).not.toHaveBeenCalled();
  });

  it("keeps the console relay for top-level Builder webviews", () => {
    const windowPostMessage = vi.spyOn(window, "postMessage");
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    const sent = sendToBuilderChat({
      message: "build a dispatch helper app",
      submit: true,
    });

    expect(sent).toBe(true);
    expect(windowPostMessage).not.toHaveBeenCalled();
    expect(consoleLog).toHaveBeenCalledOnce();

    const logged = consoleLog.mock.calls[0][0];
    expect(logged).toMatch(/^BUILDER_PARENT_MESSAGE:/);
    const relay = JSON.parse(logged.replace("BUILDER_PARENT_MESSAGE:", ""));
    expect(relay).toEqual({
      message: {
        type: "builder.submitChat",
        data: {
          message: "build a dispatch helper app",
          submit: true,
        },
      },
      targetOrigin: "*",
    });
  });
});

describe("isBuildAppOrAgentRequest", () => {
  const positives = [
    "build an app",
    "build me an app",
    "Build me an app for tracking sales",
    "build a new app",
    "build me a new app",
    "build a sales tracker app",
    "build me a calendar app for the team",
    "Create an app",
    "create a CRM app",
    "make me an app",
    "make a forms app",
    "scaffold an app",
    "generate a new agent-native app",
    "build a workspace app",
    "build an agent",
    "build me an agent",
    "create an agent",
    "Make me a deck-review agent",
    "scaffold a content agent",
    "generate me an agent for daily standups",
    "I want to build an app",
    "please create an agent",
    "let's build a new app",
    "Build an Agent-Native App",
  ];

  for (const text of positives) {
    it(`matches: "${text}"`, () => {
      expect(isBuildAppOrAgentRequest(text)).toBe(true);
    });
  }

  const negatives = [
    "",
    "hello",
    "what apps do I have?",
    "list my apps",
    "show me the agent that handles slides",
    "remind me to check the build",
    "build me a tool",
    "create a tool",
    "make a sandboxed tool",
    "scaffold a tool",
    "build a recurring job",
    "create a destination",
    "create an automation",
    "build an automation",
    "make a new secret",
    "create a vault secret",
    "build me a Slack message",
    "send an email",
    "open the analytics app",
  ];

  for (const text of negatives) {
    it(`does not match: "${text}"`, () => {
      expect(isBuildAppOrAgentRequest(text)).toBe(false);
    });
  }
});
