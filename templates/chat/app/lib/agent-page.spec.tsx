import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { resolveAgentPageComponent } from "./agent-page";

function ModernAgentPage() {
  return <div data-agent-page="modern" />;
}

function LegacyAgentChatSurface({
  mode,
  className,
}: {
  mode?: "panel" | "page";
  className?: string;
}) {
  return <div data-agent-page={mode} className={className} />;
}

describe("resolveAgentPageComponent", () => {
  it("uses AgentTabsPage when the installed core exports it", () => {
    const AgentPage = resolveAgentPageComponent({
      AgentTabsPage: ModernAgentPage,
      AgentChatSurface: LegacyAgentChatSurface,
    });

    expect(AgentPage).toBe(ModernAgentPage);
  });

  it("falls back to the page chat surface for older core versions", () => {
    const AgentPage = resolveAgentPageComponent({
      AgentChatSurface: LegacyAgentChatSurface,
    });
    const element = (
      AgentPage as (props: { appName?: string }) => ReactElement
    )({
      appName: "Chat",
    }) as ReactElement<{ mode?: "panel" | "page"; className?: string }>;

    expect(element.type).toBe(LegacyAgentChatSurface);
    expect(element.props.mode).toBe("page");
    expect(element.props.className).toBe("h-full");
  });

  it("keeps the legacy fallback component identity stable", () => {
    const client = { AgentChatSurface: LegacyAgentChatSurface };

    expect(resolveAgentPageComponent(client)).toBe(
      resolveAgentPageComponent(client),
    );
  });
});
