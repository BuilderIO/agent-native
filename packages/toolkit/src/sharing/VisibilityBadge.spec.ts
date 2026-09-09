import { IconLock, IconUsersGroup, IconWorld } from "@tabler/icons-react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { VisibilityBadge } from "./VisibilityBadge.js";

/**
 * VisibilityBadge is a plain function component with no hooks or DOM access,
 * so we can call it directly (no render, no jsdom) and inspect the React
 * element object the JSX runtime builds. This locks down the visibility ->
 * icon/label mapping and the derived-size math without needing a DOM
 * environment.
 */

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
    children: [ReactElement<{ size: number }>, string];
  };
}

function renderBadge(...args: Parameters<typeof VisibilityBadge>): SpanElement {
  return VisibilityBadge(...args) as unknown as SpanElement;
}

describe("VisibilityBadge", () => {
  it("renders the public icon and label", () => {
    const el = renderBadge({ visibility: "public" });
    expect(el.type).toBe("span");
    const [icon, label] = el.props.children;
    expect(icon.type).toBe(IconWorld);
    expect(label).toBe("Public");
  });

  it("renders the org icon and label", () => {
    const el = renderBadge({ visibility: "org" });
    const [icon, label] = el.props.children;
    expect(icon.type).toBe(IconUsersGroup);
    expect(label).toBe("Org");
  });

  it("renders the private icon and label", () => {
    const el = renderBadge({ visibility: "private" });
    const [icon, label] = el.props.children;
    expect(icon.type).toBe(IconLock);
    expect(label).toBe("Private");
  });

  it("falls back to private when visibility is null", () => {
    const el = renderBadge({ visibility: null });
    const [icon, label] = el.props.children;
    expect(icon.type).toBe(IconLock);
    expect(label).toBe("Private");
  });

  it("falls back to private when visibility is undefined", () => {
    const el = renderBadge({ visibility: undefined });
    const [icon, label] = el.props.children;
    expect(icon.type).toBe(IconLock);
    expect(label).toBe("Private");
  });

  it("applies a custom size to both the span font size and the icon size", () => {
    const el = renderBadge({ visibility: "public", size: 20 });
    expect(el.props.style.fontSize).toBe(20);
    const [icon] = el.props.children;
    expect(icon.props.size).toBe(22);
  });

  it("defaults size to 12 for the span and 14 for the icon when omitted", () => {
    const el = renderBadge({ visibility: "public" });
    expect(el.props.style.fontSize).toBe(12);
    const [icon] = el.props.children;
    expect(icon.props.size).toBe(14);
  });

  it("passes className through to the span", () => {
    const el = renderBadge({ visibility: "public", className: "my-badge" });
    expect(el.props.className).toBe("my-badge");
  });

  it("always uses the muted-foreground color token", () => {
    const el = renderBadge({ visibility: "org" });
    expect(el.props.style.color).toBe("hsl(var(--muted-foreground))");
  });
});
