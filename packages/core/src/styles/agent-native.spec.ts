import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("agent-native shell surface tokens", () => {
  it("keeps the raised app surface on the semantic background color", () => {
    const css = readFileSync(new URL("./agent-native.css", import.meta.url), {
      encoding: "utf8",
    });

    expect(css).toContain(
      "--agent-native-raised-surface: hsl(var(--background));",
    );
    expect(css).toContain("--agent-native-card-surface: hsl(var(--card));");
    expect(css).not.toMatch(/--agent-native-raised-surface:\s*color-mix\(/);
    expect(css).not.toMatch(/--agent-native-card-surface:\s*color-mix\(/);
  });

  it("keeps app and agent main surfaces borderless", () => {
    const css = readFileSync(new URL("./agent-native.css", import.meta.url), {
      encoding: "utf8",
    });
    const frameCss = readFileSync(
      new URL("../../../frame/client/styles.css", import.meta.url),
      { encoding: "utf8" },
    );

    expect(css).not.toContain("--agent-native-raised-outline");
    expect(css).toMatch(
      /\.agent-layout-main-surface,\s*\.agent-layout-shell > \.agent-sidebar-shell > \.agent-sidebar-main-surface \{[^}]*box-shadow: none;/s,
    );
    expect(frameCss).not.toContain("--agent-native-raised-outline");
    expect(frameCss).toMatch(
      /\.agent-frame-main-surface\[data-agent-frame-main-state="open"\] \{[^}]*box-shadow: none;/s,
    );
  });

  it("removes shell transitions while the agent sidebar is being resized", () => {
    const css = readFileSync(new URL("./agent-native.css", import.meta.url), {
      encoding: "utf8",
    });

    expect(css).toMatch(
      /\.agent-sidebar-shell\[data-agent-sidebar-resizing="true"\],\s*\.agent-sidebar-shell\[data-agent-sidebar-resizing="true"\] \* \{[^}]*transition: none !important;/s,
    );
  });

  it("keeps expanded left drawer contents at the revealed width", () => {
    const css = readFileSync(new URL("./agent-native.css", import.meta.url), {
      encoding: "utf8",
    });

    expect(css).toMatch(
      /\.agent-layout-left-drawer\[data-collapsed="false"\] > \* \{[\s\S]*?width: var\(--agent-layout-left-drawer-expanded-width, 14rem\);[\s\S]*?min-width: var\(--agent-layout-left-drawer-expanded-width, 14rem\);[\s\S]*?max-width: var\(--agent-layout-left-drawer-expanded-width, 14rem\);/,
    );
  });

  it("does not double-animate a named chat handoff through the drawer entry", () => {
    const css = readFileSync(new URL("./agent-native.css", import.meta.url), {
      encoding: "utf8",
    });

    expect(css).toMatch(
      /@starting-style[\s\S]*?\.agent-native-chat-view-transition\.agent-sidebar-panel\[data-agent-sidebar-animation="desktop"\]\[data-agent-sidebar-chat-handoff="true"\][^}]*width: var\(--agent-sidebar-width\);/s,
    );
    expect(css).toMatch(
      /@starting-style[\s\S]*?\.agent-native-chat-view-transition\.agent-sidebar-panel\[data-agent-sidebar-animation="desktop"\]\[data-agent-sidebar-chat-handoff="true"\][\s\S]*?> \.agent-sidebar-panel-inner[^}]*transform: translateX\(0\);/s,
    );
    expect(css).toMatch(
      /\.agent-sidebar-panel\[data-agent-sidebar-animation="desktop"\][\s\S]*?transition: width 260ms var\(--ease-drawer\);/s,
    );
  });

  it("keeps drawer shadows dark and wide-mode snapshots full height", () => {
    const css = readFileSync(new URL("./agent-native.css", import.meta.url), {
      encoding: "utf8",
    });

    expect(css).toMatch(
      /\.agent-sidebar-panel\[data-agent-sidebar-animation="drawer"\][\s\S]*?--agent-shadow: 0 0% 0%;[\s\S]*?box-shadow:[\s\S]*?hsl\(var\(--agent-shadow\) \/ var\(--agent-shadow-o\)\);/s,
    );
    expect(css).toMatch(
      /\.dark \.agent-sidebar-panel\[data-agent-sidebar-animation="drawer"\][\s\S]*?--agent-shadow-o: 0\.08;/s,
    );
    expect(css).toMatch(
      /::view-transition-old\(agent-native-sidebar-drawer\),\s*::view-transition-new\(agent-native-sidebar-drawer\)[\s\S]*?height: 100%;/s,
    );
  });

  it("keeps the active tool shine clipped to its label text", () => {
    const css = readFileSync(new URL("./agent-native.css", import.meta.url), {
      encoding: "utf8",
    });

    expect(css).toContain(".agent-running-shimmer");
    expect(css).toContain("background-clip: text;");
    expect(css).not.toContain(
      '.agent-tool-call[data-active-tail="true"]::after',
    );
  });

  it("uses a surface-independent mask for the scrolled chat fade", () => {
    const css = readFileSync(new URL("./agent-native.css", import.meta.url), {
      encoding: "utf8",
    });
    const source = readFileSync(
      new URL("../client/components/ui/message-scroller.tsx", import.meta.url),
      { encoding: "utf8" },
    );

    expect(css).toContain(".message-scroller-viewport--top-fade");
    expect(css).toContain("-webkit-mask-image: linear-gradient(");
    expect(css).toContain("black var(--message-scroller-top-fade-size)");
    expect(source).toContain("message-scroller-viewport--top-fade");
    expect(source).not.toContain("bg-gradient-to-b from-background");
  });
});

/**
 * These three properties each promote or re-promote a compositing layer on the
 * chat sidebar — the surface every template mounts and the one users reported
 * as "glitching out when you open chat": flow content painting as flat
 * rectangles while only separately-composited overlays survived. They read as
 * harmless performance hints, which is why they kept coming back. Each
 * assertion below names the element that must NOT carry the property.
 */
describe("agent chat sidebar compositing invariants", () => {
  const readCss = () =>
    readFileSync(new URL("./agent-native.css", import.meta.url), {
      encoding: "utf8",
    });

  /**
   * Bodies of every rule whose selector list matches `matches`. Comments are
   * stripped first: the declarations these tests forbid are also *named* in the
   * comments explaining why they are forbidden, and a guard that a comment can
   * satisfy is not a guard.
   */
  const ruleBodies = (
    css: string,
    matches: (selector: string) => boolean,
  ): string[] => {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const bodies: string[] = [];
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    let match: RegExpExecArray | null;
    while ((match = ruleRe.exec(withoutComments)) !== null) {
      const selector = (match[1] ?? "").trim();
      if (selector && matches(selector)) bodies.push(match[2] ?? "");
    }
    return bodies;
  };

  it("never leaves will-change on the always-mounted sidebar panel", () => {
    const css = readCss();

    const panelRules = ruleBodies(css, (s) =>
      s.includes(".agent-sidebar-panel"),
    );
    expect(panelRules.length).toBeGreaterThan(0);
    for (const body of panelRules) expect(body).not.toContain("will-change");
  });

  it("declares the chat fade mask unconditionally so it is never added or removed", () => {
    const css = readCss();

    // The mask itself belongs to the base class...
    const base = ruleBodies(css, (s) => s === ".message-scroller-viewport");
    expect(base.length).toBeGreaterThan(0);
    expect(base.some((body) => body.includes("mask-image"))).toBe(true);

    // ...and the scroll-dependent modifier may only retune its length.
    const modifier = ruleBodies(
      css,
      (s) => s === ".message-scroller-viewport--top-fade",
    );
    expect(modifier.length).toBeGreaterThan(0);
    for (const body of modifier) {
      expect(body).not.toContain("mask-image");
      expect(body).toContain("--message-scroller-top-fade-size");
    }
  });

  it("applies view-transition-name only while the drawer morph is running", () => {
    const source = readFileSync(
      new URL("../client/AgentPanel.tsx", import.meta.url),
      { encoding: "utf8" },
    );

    // A bare `viewTransitionName: NAME,` line is the unconditional form: it
    // makes the panel a containing block for fixed descendants for the life of
    // the page and enlists it in unrelated route view transitions.
    expect(source).not.toMatch(
      /^\s*viewTransitionName: SIDEBAR_DRAWER_VIEW_TRANSITION_NAME,/m,
    );
    expect(source).toContain("drawerMorphing");
  });
});
