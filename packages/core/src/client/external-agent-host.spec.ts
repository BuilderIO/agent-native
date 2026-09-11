// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import {
  detectExternalAgentHost,
  isExternalAgentNudgeSurfaceVisible,
} from "./external-agent-host.js";

describe("external agent host detection", () => {
  it("uses explicit host bridge signals instead of generic browser identity", () => {
    expect(
      detectExternalAgentHost({
        hostname: "app.example.com",
        openAiBridge: {},
      }),
    ).toEqual({ id: "chatgpt", label: "ChatGPT" });
    expect(
      detectExternalAgentHost({
        frameOrigin: "https://web-sandbox.oaiusercontent.com",
      }),
    ).toEqual({ id: "chatgpt", label: "ChatGPT" });
    expect(
      detectExternalAgentHost({
        hostname: "123.claudemcpcontent.com",
      }),
    ).toEqual({ id: "claude", label: "Claude" });
    expect(
      detectExternalAgentHost({
        hostInfo: { name: "Claude Code" },
      }),
    ).toEqual({ id: "claude", label: "Claude" });
    expect(
      detectExternalAgentHost({
        hostInfo: { name: "Codex" },
      }),
    ).toEqual({ id: "codex", label: "Codex" });
    expect(
      detectExternalAgentHost({
        hostname: "app.example.com",
        referrer: "https://claudemcpcontent.com/embedded",
      }),
    ).toBeNull();
    expect(
      detectExternalAgentHost({
        hostname: "app.example.com",
        referrer: "https://claudemcpcontent.com/embedded",
        isEmbedded: true,
      }),
    ).toEqual({ id: "claude", label: "Claude" });
    expect(
      detectExternalAgentHost({ hostname: "localhost", referrer: null }),
    ).toBeNull();
  });
});

describe("external agent nudge surface visibility", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("skips hidden or inaccessible ancestors", () => {
    const ancestor = document.createElement("div");
    const surface = document.createElement("div");
    ancestor.append(surface);
    document.body.append(ancestor);

    expect(isExternalAgentNudgeSurfaceVisible(surface)).toBe(true);

    ancestor.classList.add("hidden");
    expect(isExternalAgentNudgeSurfaceVisible(surface)).toBe(false);
    ancestor.classList.remove("hidden");

    ancestor.hidden = true;
    expect(isExternalAgentNudgeSurfaceVisible(surface)).toBe(false);
    ancestor.hidden = false;

    ancestor.style.visibility = "hidden";
    expect(isExternalAgentNudgeSurfaceVisible(surface)).toBe(false);
    ancestor.style.visibility = "";

    ancestor.setAttribute("aria-hidden", "true");
    expect(isExternalAgentNudgeSurfaceVisible(surface)).toBe(false);
  });
});
