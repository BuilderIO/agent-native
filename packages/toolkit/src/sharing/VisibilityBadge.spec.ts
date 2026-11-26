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

  // oracle-change: merged the custom and default size tests (same four size assertions) and dropped the muted-foreground color token check, a copy of a style constant

  it("sizes the span font and the icon, defaulting to 12 and 14", () => {
    const custom = renderBadge({ visibility: "public", size: 20, labels });
    expect(custom.props.style.fontSize).toBe(20);
    expect(custom.props.children[0].props.size).toBe(22);
    const fallback = renderBadge({ visibility: "public", labels });
    expect(fallback.props.style.fontSize).toBe(12);
    expect(fallback.props.children[0].props.size).toBe(14);
  });

  it("passes className through to the span", () => {
    const el = renderBadge({
      visibility: "public",
      labels,
      className: "my-badge",
    });
    expect(el.props.className).toBe("my-badge");
  });
});
