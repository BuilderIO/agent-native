// @vitest-environment happy-dom

import { act, createElement, type ReactNode } from "react";
// @ts-expect-error This test needs only the React DOM root methods.
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Root = { render(node: ReactNode): void; unmount(): void };

function nativeHost(tag: string) {
  return ({ children, ...props }: { children?: ReactNode }) =>
    createElement(tag, props, children);
}

vi.mock("react-native", () => ({
  Text: nativeHost("span"),
  View: nativeHost("div"),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    key === "message.mobileInteractiveTitle"
      ? "Interactive content"
      : key === "message.mobileInteractiveDescription"
        ? "This interactive view is available in web chat, but not in native chat yet."
        : key,
}));

import type { ChatContentPart } from "@/lib/agent-chat/types";

import { NativeInteractiveResult } from "./NativeInteractiveResult";

describe("native AgentKit interactive results", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function render(part: Extract<ChatContentPart, { type: "tool-call" }>) {
    act(() => root.render(<NativeInteractiveResult part={part} />));
  }

  it("renders a validated action data table as native rows", () => {
    render({
      type: "tool-call",
      toolCallId: "table-1",
      toolName: "top-customers",
      inputText: "{}",
      status: "completed",
      chatUI: { renderer: "core.data-table", title: "Top customers" },
      resultText: JSON.stringify({
        columns: [{ key: "name", label: "Name" }],
        rows: [{ name: "Ada" }],
      }),
    });

    expect(container.textContent).toContain("Top customers");
    expect(container.textContent).toContain("Name");
    expect(container.textContent).toContain("Ada");
    expect(container.textContent).not.toContain("available in web chat");
  });

  it("shows MCP tool text while never rendering the app resource HTML", () => {
    render({
      type: "tool-call",
      toolCallId: "mcp-1",
      toolName: "search_docs",
      inputText: "{}",
      status: "completed",
      mcpApp: {
        tool: { title: "Search results" },
        resource: {
          text: "<script>window.nativePayloadExecuted = true</script>",
        },
        toolResult: {
          content: [{ type: "text", text: "Found three useful pages." }],
        },
      },
    });

    expect(container.textContent).toContain("Search results");
    expect(container.textContent).toContain("Found three useful pages.");
    expect(container.textContent).not.toContain("nativePayloadExecuted");
    expect(container.textContent).toContain("available in web chat");
  });

  it("shows safe text from custom renderers and ignores HTML fields", () => {
    render({
      type: "tool-call",
      toolCallId: "custom-1",
      toolName: "render-summary",
      inputText: "{}",
      status: "completed",
      chatUI: { renderer: "example.custom-summary", title: "Summary" },
      resultText: JSON.stringify({
        message: "Three items are ready.",
        html: "<script>window.nativePayloadExecuted = true</script>",
      }),
    });

    expect(container.textContent).toContain("Summary");
    expect(container.textContent).toContain("Three items are ready.");
    expect(container.textContent).not.toContain("nativePayloadExecuted");
    expect(container.textContent).toContain("available in web chat");
  });

  it("does not treat an unknown renderer as a data widget", () => {
    render({
      type: "tool-call",
      toolCallId: "unknown-1",
      toolName: "custom-renderer",
      inputText: "{}",
      status: "completed",
      chatUI: { renderer: "unknown.renderer", title: "Custom result" },
      resultText: JSON.stringify({
        widget: "table",
        columns: [{ key: "name", label: "Name" }],
        rows: [{ name: "Ada" }],
      }),
    });

    expect(container.textContent).toContain("Custom result");
    expect(container.textContent).not.toContain("Ada");
    expect(container.textContent).toContain("available in web chat");
  });
});
