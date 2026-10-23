// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const agentConnectionMocks = vi.hoisted(() => ({
  state: "unknown" as "unknown" | "configured" | "missing" | "unavailable",
}));

vi.mock("@agent-native/core/client/use-agent-engine-configured", () => ({
  useAgentEngineConfigured: () => ({
    canChat: agentConnectionMocks.state === "configured",
    missing: agentConnectionMocks.state === "missing",
    state: agentConnectionMocks.state,
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    key === "slides2Editor.agentConnected" ? "Agent connected" : key,
}));

import { Slides2AgentConnectionBadge } from "./Slides2AgentConnectionBadge";

afterEach(cleanup);

beforeEach(() => {
  agentConnectionMocks.state = "unknown";
});

describe("Slides2AgentConnectionBadge", () => {
  it("shows the connected badge only after readiness is confirmed", () => {
    agentConnectionMocks.state = "configured";

    const { container } = render(<Slides2AgentConnectionBadge />);

    const status = screen.getByRole("status", { name: "Agent connected" });
    expect(status.getAttribute("data-agent-connection-status")).toBe(
      "configured",
    );
    expect(status.textContent).toContain("Agent connected");
    expect(
      container.querySelector(".slides2-agent-connected-dot"),
    ).not.toBeNull();
  });

  it.each(["unknown", "missing", "unavailable"] as const)(
    "does not claim a connection when readiness is %s",
    (state) => {
      agentConnectionMocks.state = state;

      const { container } = render(<Slides2AgentConnectionBadge />);

      expect(screen.queryByRole("status")).toBeNull();
      const placeholder = container.querySelector(
        "[data-agent-connection-placeholder]",
      );
      expect(placeholder).not.toBeNull();
      expect(placeholder?.getAttribute("aria-hidden")).toBe("true");
      expect(placeholder?.classList.contains("invisible")).toBe(true);
      expect(placeholder?.classList.contains("size-3.5")).toBe(false);
      expect(placeholder?.textContent).toContain("Agent connected");
      expect(placeholder?.firstElementChild).not.toBeNull();
    },
  );
});
