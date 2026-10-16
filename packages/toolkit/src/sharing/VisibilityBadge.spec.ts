import { IconLock, IconUsersGroup, IconWorld } from "@tabler/icons-react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { VisibilityBadge } from "./VisibilityBadge.js";

interface SpanStyle {
  display: string;
  alignItems: string;
  gap: number;
  fontSize: number;
  color: string;
}

interface SpanElement extends ReactElement {
  type: "span";
  props: {
    className?: string;
    style: SpanStyle;
    "data-visibility": string;
    children: [ReactElement<{ size: number; "aria-hidden"?: string }>, string];
  };
}

const labels = { private: "Privé", org: "Équipe", public: "Public·fr" };

function renderBadge(...args: Parameters<typeof VisibilityBadge>): SpanElement {
  return VisibilityBadge(...args) as unknown as SpanElement;
}

describe("VisibilityBadge", () => {
  it("renders the icon and the supplied label for each visibility", () => {
    const cases = [
      ["public", IconWorld, "Public·fr"],
      ["org", IconUsersGroup, "Équipe"],
      ["private", IconLock, "Privé"],
    ] as const;
    for (const [visibility, expectedIcon, expectedLabel] of cases) {
      const el = renderBadge({ visibility, labels });
      const [icon, label] = el.props.children;
      expect(el.type).toBe("span");
      expect(icon.type).toBe(expectedIcon);
      expect(label).toBe(expectedLabel);
      expect(el.props["data-visibility"]).toBe(visibility);
    }
  });

  it("keeps the legacy English text for consumers that pass no labels", () => {
    const text = (visibility: "private" | "org" | "public") =>
      renderBadge({ visibility }).props.children[1];
    expect(text("public")).toBe("Public");
    expect(text("org")).toBe("Org");
    expect(text("private")).toBe("Private");
  });

  it("lets labels override one visibility while the others keep the default", () => {
    expect(
      renderBadge({ visibility: "org", labels: { org: "Team" } }).props
        .children[1],
    ).toBe("Team");
    expect(
      renderBadge({ visibility: "public", labels: { org: "Team" } }).props
        .children[1],
    ).toBe("Public");
  });

  it("hides the icon from assistive tech because the text names it", () => {
    const [icon] = renderBadge({ visibility: "org" }).props.children;
    expect(icon.props["aria-hidden"]).toBe("true");
  });

  it("falls back to private when visibility is null or undefined", () => {
    for (const visibility of [null, undefined]) {
      const el = renderBadge({ visibility, labels });
      const [icon, label] = el.props.children;
      expect(icon.type).toBe(IconLock);
      expect(label).toBe("Privé");
    }
  });

  it("applies a custom size to both the span font size and the icon size", () => {
    const el = renderBadge({ visibility: "public", size: 20, labels });
    expect(el.props.style.fontSize).toBe(20);
    expect(el.props.children[0].props.size).toBe(22);
  });

  it("defaults size to 12 for the span and 14 for the icon when omitted", () => {
    const el = renderBadge({ visibility: "public", labels });
    expect(el.props.style.fontSize).toBe(12);
    expect(el.props.children[0].props.size).toBe(14);
  });

  it("passes className through to the span", () => {
    const el = renderBadge({
      visibility: "public",
      labels,
      className: "my-badge",
    });
    expect(el.props.className).toBe("my-badge");
  });

  it("always uses the muted-foreground color token", () => {
    const el = renderBadge({ visibility: "org", labels });
    expect(el.props.style.color).toBe("hsl(var(--muted-foreground))");
  });
});
