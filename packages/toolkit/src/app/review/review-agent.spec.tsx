// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveReviewAgent } from "./review-agent.js";
import { ReviewAgentMark } from "./ReviewAgentMark.js";

describe("resolveReviewAgent", () => {
  it("returns null unless the comment was created by an agent", () => {
    expect(
      resolveReviewAgent({ createdBy: "human", authorName: "Claude" }),
    ).toBeNull();
    expect(
      resolveReviewAgent({ createdBy: "system", authorName: "Codex" }),
    ).toBeNull();
    expect(
      resolveReviewAgent({ createdBy: null, authorName: "Codex" }),
    ).toBeNull();
    expect(resolveReviewAgent({})).toBeNull();
  });

  it.each([
    ["Claude", "claude"],
    ["Claude Code", "claude-code"],
    ["Codex", "codex"],
    ["OpenAI", "codex"],
    ["GPT-5.4", "codex"],
    ["Research helper", "agent"],
  ] as const)("maps the author name %s to kind %s", (authorName, kind) => {
    expect(resolveReviewAgent({ createdBy: "agent", authorName })).toEqual({
      kind,
      label: authorName,
    });
  });

  it("falls back to the generic agent when the name is empty", () => {
    expect(
      resolveReviewAgent({ createdBy: "agent", authorName: null }),
    ).toEqual({
      kind: "agent",
      label: "Agent",
    });
    expect(resolveReviewAgent({ createdBy: "agent", authorName: "" })).toEqual({
      kind: "agent",
      label: "Agent",
    });
    expect(
      resolveReviewAgent({ createdBy: "agent", authorName: "   " }),
    ).toEqual({
      kind: "agent",
      label: "Agent",
    });
    expect(resolveReviewAgent({ createdBy: "agent" })).toEqual({
      kind: "agent",
      label: "Agent",
    });
  });

  it("matches names case-insensitively and trims the label", () => {
    expect(
      resolveReviewAgent({ createdBy: "agent", authorName: "  CODEX  " }),
    ).toEqual({ kind: "codex", label: "CODEX" });
    expect(
      resolveReviewAgent({ createdBy: "agent", authorName: "CLAUDE-CODE" }),
    ).toEqual({ kind: "claude-code", label: "CLAUDE-CODE" });
  });

  it("prefers Claude Code over Claude when both appear", () => {
    expect(
      resolveReviewAgent({ createdBy: "agent", authorName: "Claude Code" })
        ?.kind,
    ).toBe("claude-code");
    expect(
      resolveReviewAgent({
        createdBy: "agent",
        authorName: "claude-code helper for Claude",
      })?.kind,
    ).toBe("claude-code");
    expect(
      resolveReviewAgent({ createdBy: "agent", authorName: "Claude" })?.kind,
    ).toBe("claude");
  });
});

describe("ReviewAgentMark", () => {
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
  });

  it.each(["claude", "claude-code", "codex", "agent"] as const)(
    "renders a decorative mark for %s",
    (kind) => {
      act(() => root.render(<ReviewAgentMark kind={kind} />));
      expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
        "true",
      );
    },
  );

  it("renders the Claude and Claude Code brand logos", () => {
    act(() => root.render(<ReviewAgentMark kind="claude" />));
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe(
      "0 0 100 100",
    );
    act(() => root.render(<ReviewAgentMark kind="claude-code" />));
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe(
      "0 0 20 20",
    );
  });
});
