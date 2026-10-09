import { beforeEach, describe, expect, it, vi } from "vitest";

import enUS from "../../../i18n/en-US";
import {
  buildTextContrast,
  contrastAgentContext,
  contrastAgentMessage,
  readLargeText,
  type TextContrastContext,
} from "./text-contrast";

const mocks = vi.hoisted(() => ({
  sendToDesignAgentChat: vi.fn(),
  requestTextBackground: vi.fn(),
}));

vi.mock("@/lib/agent-chat", () => ({
  sendToDesignAgentChat: mocks.sendToDesignAgentChat,
}));
vi.mock("../multi-screen/measure-contrast-background", () => ({
  requestTextBackground: mocks.requestTextBackground,
}));

const t = (key: string, options?: Record<string, string>) => {
  const found = key
    .split(".")
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      enUS,
    );
  if (typeof found !== "string") throw new Error(`Missing i18n key ${key}`);
  return found.replace(/\{\{(\w+)\}\}/g, (_, name) => options?.[name] ?? "");
};

const context: TextContrastContext = {
  designId: "design-1",
  screenId: "screen-1",
  nodeId: "node-9",
  selector: '[data-agent-native-node-id="node-9"]',
};

beforeEach(() => {
  mocks.sendToDesignAgentChat.mockReset();
  mocks.requestTextBackground.mockReset();
});

describe("readLargeText", () => {
  it("is large from 24px at any weight", () => {
    expect(readLargeText({ fontSize: "24px", fontWeight: "400" })).toBe(true);
    expect(readLargeText({ fontSize: "23.9px", fontWeight: "400" })).toBe(
      false,
    );
  });

  it("is large from 18.66px when bold", () => {
    expect(readLargeText({ fontSize: "18.66px", fontWeight: "700" })).toBe(
      true,
    );
    expect(readLargeText({ fontSize: "18.66px", fontWeight: "600" })).toBe(
      false,
    );
    expect(readLargeText({ fontSize: "18.66px", fontWeight: "bold" })).toBe(
      true,
    );
    expect(readLargeText({ fontSize: "18px", fontWeight: "700" })).toBe(false);
  });

  it("reads the normal keyword as 400", () => {
    expect(readLargeText({ fontSize: "30px", fontWeight: "normal" })).toBe(
      true,
    );
    expect(readLargeText({ fontSize: "20px", fontWeight: "normal" })).toBe(
      false,
    );
  });

  it("is null, not body text, when the size or weight cannot be read", () => {
    expect(readLargeText({})).toBeNull();
    expect(readLargeText({ fontSize: "16px" })).toBeNull();
    expect(readLargeText({ fontWeight: "700" })).toBeNull();
    expect(readLargeText({ fontSize: "Mixed", fontWeight: "700" })).toBeNull();
    expect(readLargeText({ fontSize: "16px", fontWeight: "Mixed" })).toBeNull();
    expect(readLargeText({ fontSize: "0px", fontWeight: "400" })).toBeNull();
  });
});

describe("contrastAgentMessage", () => {
  it("states the target, the pair and the ratio now", () => {
    const message = contrastAgentMessage(t, {
      ratio: 2.681,
      targetRatio: 4.5,
      large: false,
      background: "#FFFFFF",
      foreground: "#9e9e9e",
    });
    expect(message).toContain("WCAG AA (4.5:1 for body text)");
    expect(message).toContain("#FFFFFF");
    expect(message).toContain("It's 2.7:1 now");
  });

  it("names large text", () => {
    expect(
      contrastAgentMessage(t, {
        ratio: 2,
        targetRatio: 3,
        large: true,
        background: "#000000",
        foreground: "#222222",
      }),
    ).toContain("3:1 for large text");
  });

  it("asks the agent to look, not to hit a number it was not given, when there is no background", () => {
    const message = contrastAgentMessage(t, {
      ratio: null,
      targetRatio: 4.5,
      large: null,
      background: null,
      foreground: "#9e9e9e",
    });
    expect(message).toContain("Check the contrast");
    expect(message).not.toMatch(/\d:1/);
  });
});

describe("contrastAgentContext", () => {
  it("points the agent at the layer and gives it the numbers", () => {
    const text = contrastAgentContext(context, {
      ratio: 2.681,
      targetRatio: 4.5,
      large: false,
      background: "#FFFFFF",
      foreground: "#9e9e9e",
    });
    expect(text).toContain("designId: design-1");
    expect(text).toContain("screenId: screen-1");
    expect(text).toContain("node-9");
    expect(text).toContain(`selector: ${context.selector}`);
    expect(text).toContain("text color: #9e9e9e");
    expect(text).toContain("background behind the text: #FFFFFF");
    expect(text).toContain("contrast now: 2.68:1");
    expect(text).toContain("AA target: 4.5:1 (body text)");
  });

  it("says the background is unknown rather than inventing one", () => {
    const text = contrastAgentContext(context, {
      ratio: null,
      targetRatio: 4.5,
      large: null,
      background: null,
      foreground: "#9e9e9e",
    });
    expect(text).toContain("not readable from the editor");
    expect(text).not.toContain("contrast now");
    expect(text).not.toContain("(body text)");
  });
});

describe("buildTextContrast", () => {
  const styles = { fontSize: "16px", fontWeight: "400" };

  it("carries the text size class", () => {
    expect(buildTextContrast({ context, styles, t }).large).toBe(false);
    expect(
      buildTextContrast({
        context,
        styles: { fontSize: "32px", fontWeight: "400" },
        t,
      }).large,
    ).toBe(true);
    expect(buildTextContrast({ context, styles: {}, t }).large).toBeNull();
  });

  it("reads the background of this layer on this screen", async () => {
    mocks.requestTextBackground.mockResolvedValue({
      kind: "ready",
      color: { r: 1, g: 2, b: 3 },
    });
    const contrast = buildTextContrast({ context, styles, t });
    await expect(contrast.readBackground()).resolves.toEqual({
      kind: "ready",
      color: { r: 1, g: 2, b: 3 },
    });
    expect(mocks.requestTextBackground).toHaveBeenCalledWith({
      screenId: "screen-1",
      selector: context.selector,
    });
  });

  it("sends the request through the agent chat, submitted and visible", () => {
    const contrast = buildTextContrast({ context, styles, t });
    contrast.onAskAgent({
      ratio: 2.681,
      targetRatio: 4.5,
      large: false,
      background: "#FFFFFF",
      foreground: "#9e9e9e",
    });
    expect(mocks.sendToDesignAgentChat).toHaveBeenCalledTimes(1);
    const sent = mocks.sendToDesignAgentChat.mock.calls[0]![0];
    expect(sent).toMatchObject({ submit: true, openSidebar: true });
    expect(sent.message).toContain("WCAG AA");
    expect(sent.context).toContain(context.selector);
  });
});
