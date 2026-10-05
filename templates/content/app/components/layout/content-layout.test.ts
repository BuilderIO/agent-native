import { describe, expect, it } from "vitest";

import {
  CONTENT_COMMENT_SURFACE_WIDTH,
  CONTENT_STARTUP_SIDEBAR_SCRIPT,
  CONTENT_TEXT_MIN_WIDTH,
  type ContentLayout,
  type ContentLayoutInput,
  contentPageWidth,
  resolveContentLayout,
  resolveContentSidebar,
} from "./content-layout";
import {
  COLLAPSED_SIDEBAR_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  SIDEBAR_COLLAPSED_KEY,
  SIDEBAR_WIDTH_KEY,
  STARTUP_SIDEBAR_COLLAPSED_ATTRIBUTE,
  STARTUP_SIDEBAR_DRAWER_ATTRIBUTE,
  STARTUP_SIDEBAR_WIDTH_PROPERTY,
} from "./sidebar-preferences";

const AGENT_WIDTH = 380;

function input(
  viewportWidth: number,
  {
    agentOpen = false,
    collapsed = false,
    sidebarWidth = DEFAULT_SIDEBAR_WIDTH,
    utilityRail = false,
    previous,
  }: {
    agentOpen?: boolean;
    collapsed?: boolean;
    sidebarWidth?: number;
    utilityRail?: boolean;
    previous?: ContentLayout;
  } = {},
): ContentLayoutInput {
  return {
    viewportWidth,
    sidebar: { collapsed, width: sidebarWidth },
    agentPanel: agentOpen
      ? { open: true, width: AGENT_WIDTH }
      : { open: false, width: 0 },
    utilityRail,
    previous,
  };
}

describe("resolveContentLayout", () => {
  it("draws a phone with a drawer sidebar, cards on the text, and the comments sheet", () => {
    for (const agentOpen of [false, true]) {
      expect(resolveContentLayout(input(375, { agentOpen }))).toEqual({
        sidebar: "drawer",
        sidebarAutoCollapsed: true,
        agentPanel: agentOpen ? "overlay" : "closed",
        comments: { margin: "anchored", list: "sheet" },
      });
    }
    expect(resolveContentLayout(input(560)).sidebar).toBe("drawer");
  });

  it("rails the sidebar at 768 and opens comments over the page", () => {
    expect(resolveContentLayout(input(768))).toEqual({
      sidebar: "rail",
      sidebarAutoCollapsed: true,
      agentPanel: "closed",
      comments: { margin: "anchored", list: "region-list" },
    });
  });

  it("overlays the agent panel until the page can keep its minimum width", () => {
    const tooNarrow = input(768, { agentOpen: true });
    const wideEnough = input(940, { agentOpen: true });
    const wideEnoughLayout = resolveContentLayout(wideEnough);

    expect(resolveContentLayout(tooNarrow)).toMatchObject({
      agentPanel: "overlay",
    });
    expect(wideEnoughLayout).toMatchObject({
      agentPanel: "docked",
      sidebar: "drawer",
    });
    expect(contentPageWidth(wideEnough, wideEnoughLayout.sidebar)).toBe(
      CONTENT_TEXT_MIN_WIDTH,
    );
  });

  it("docks the sidebar at 1024 with the agent panel closed", () => {
    const layout = resolveContentLayout(input(1024));

    expect(layout.sidebar).toBe("docked");
    expect(layout.sidebarAutoCollapsed).toBe(false);
  });

  it("gives up the docked sidebar, then the comment margin, when the agent docks at 1024", () => {
    const opened = input(1024, { agentOpen: true });
    const layout = resolveContentLayout(opened);

    expect(layout).toEqual({
      sidebar: "rail",
      sidebarAutoCollapsed: true,
      agentPanel: "docked",
      comments: { margin: "anchored", list: "region-list" },
    });
    expect(contentPageWidth(opened, layout.sidebar)).toBeGreaterThanOrEqual(
      CONTENT_TEXT_MIN_WIDTH,
    );
  });

  it("keeps the sidebar docked at 1280 beside the agent and moves comments off the margin", () => {
    const opened = input(1280, {
      agentOpen: true,
      previous: resolveContentLayout(input(1280)),
    });
    const layout = resolveContentLayout(opened);

    expect(layout.sidebar).toBe("docked");
    expect(layout.agentPanel).toBe("docked");
    expect(layout.comments).toEqual({
      margin: "anchored",
      list: "region-list",
    });
    expect(contentPageWidth(opened, layout.sidebar)).toBeGreaterThanOrEqual(
      CONTENT_TEXT_MIN_WIDTH,
    );
  });

  it("gives up the sidebar before an open comments list covers the text", () => {
    const opened = input(1280, {
      agentOpen: true,
      utilityRail: true,
      previous: resolveContentLayout(input(1280, { utilityRail: true })),
    });
    const layout = resolveContentLayout(opened);

    expect(layout.sidebar).toBe("drawer");
    expect(layout.comments.list).toBe("rail");
    expect(contentPageWidth(opened, layout.sidebar)).toBeGreaterThanOrEqual(
      CONTENT_TEXT_MIN_WIDTH + CONTENT_COMMENT_SURFACE_WIDTH,
    );
    expect(
      resolveContentLayout(input(1100, { utilityRail: true })),
    ).toMatchObject({ sidebar: "rail", comments: { list: "rail" } });
    expect(
      resolveContentLayout(input(1280, { utilityRail: true })),
    ).toMatchObject({ sidebar: "docked", comments: { list: "rail" } });
  });

  it("keeps the sidebar for the text when even a drawer leaves no room for the list", () => {
    expect(
      resolveContentLayout(input(1024, { agentOpen: true, utilityRail: true })),
    ).toMatchObject({ sidebar: "rail", comments: { list: "region-list" } });
    expect(
      resolveContentLayout(input(375, { utilityRail: true })),
    ).toMatchObject({ sidebar: "drawer", comments: { list: "sheet" } });
  });

  it("keeps the comment lane and rail at 1600, with or without the agent", () => {
    for (const agentOpen of [false, true]) {
      expect(resolveContentLayout(input(1600, { agentOpen }))).toMatchObject({
        sidebar: "docked",
        comments: { margin: "lane", list: "rail" },
      });
    }
  });

  it("never lets the page drop below the text minimum while the sidebar can give way", () => {
    for (let viewport = 616; viewport <= 2000; viewport += 8) {
      for (const agentOpen of [false, true]) {
        const resolved = input(viewport, { agentOpen });
        const layout = resolveContentLayout(resolved);
        if (layout.sidebar === "drawer") continue;
        expect(
          contentPageWidth(resolved, layout.sidebar),
        ).toBeGreaterThanOrEqual(CONTENT_TEXT_MIN_WIDTH);
      }
    }
  });

  it("holds a mode on screen through small resizes past its threshold", () => {
    const dockedEdge = DEFAULT_SIDEBAR_WIDTH + CONTENT_TEXT_MIN_WIDTH;
    const docked = resolveContentLayout(input(dockedEdge));
    expect(docked.sidebar).toBe("docked");

    const narrowed = resolveContentLayout(
      input(dockedEdge - 16, { previous: docked }),
    );
    expect(narrowed.sidebar).toBe("docked");
    expect(
      resolveContentLayout(input(dockedEdge - 32, { previous: narrowed }))
        .sidebar,
    ).toBe("rail");

    const railed = resolveContentLayout(input(dockedEdge - 32));
    expect(railed.sidebar).toBe("rail");
    expect(
      resolveContentLayout(input(dockedEdge - 16, { previous: railed }))
        .sidebar,
    ).toBe("rail");
    expect(
      resolveContentLayout(input(dockedEdge, { previous: railed })).sidebar,
    ).toBe("docked");

    const laneEdge =
      DEFAULT_SIDEBAR_WIDTH +
      CONTENT_TEXT_MIN_WIDTH +
      CONTENT_COMMENT_SURFACE_WIDTH;
    const lane = resolveContentLayout(input(laneEdge));
    expect(lane.comments).toEqual({ margin: "lane", list: "rail" });
    expect(
      resolveContentLayout(input(laneEdge - 16, { previous: lane })).comments,
    ).toEqual({ margin: "lane", list: "rail" });
    expect(resolveContentLayout(input(laneEdge - 16)).comments).toEqual({
      margin: "anchored",
      list: "region-list",
    });
  });

  it("derives the auto-collapse without touching the saved preference", () => {
    const expanded = input(1024, { agentOpen: true });
    const before = structuredClone(expanded);
    const layout = resolveContentLayout(expanded);

    expect(layout.sidebarAutoCollapsed).toBe(true);
    expect(expanded).toEqual(before);
    expect(expanded.sidebar.collapsed).toBe(false);

    const widened = resolveContentLayout(input(1600, { previous: layout }));
    expect(widened.sidebar).toBe("docked");
    expect(widened.sidebarAutoCollapsed).toBe(false);
  });

  it("shows the rail the user chose without calling it an auto-collapse", () => {
    expect(
      resolveContentLayout(input(1600, { collapsed: true })),
    ).toMatchObject({ sidebar: "rail", sidebarAutoCollapsed: false });
  });
});

describe("CONTENT_STARTUP_SIDEBAR_SCRIPT", () => {
  function runStartupScript(
    viewportWidth: number,
    stored: Record<string, string> | "unavailable",
  ) {
    const attributes = new Set<string>();
    const properties = new Map<string, string>();
    const root = {
      setAttribute: (name: string) => attributes.add(name),
      style: {
        setProperty: (name: string, value: string) =>
          properties.set(name, value),
      },
    };
    const window = {
      innerWidth: viewportWidth,
      get localStorage() {
        if (stored === "unavailable") throw new Error("storage blocked");
        return { getItem: (key: string) => stored[key] ?? null };
      },
    };
    new Function("window", "document", CONTENT_STARTUP_SIDEBAR_SCRIPT)(window, {
      documentElement: root,
    });
    if (attributes.has(STARTUP_SIDEBAR_DRAWER_ATTRIBUTE)) return "drawer";
    if (attributes.has(STARTUP_SIDEBAR_COLLAPSED_ATTRIBUTE)) {
      expect(properties.get(STARTUP_SIDEBAR_WIDTH_PROPERTY)).toBe(
        `${COLLAPSED_SIDEBAR_WIDTH}px`,
      );
      return "rail";
    }
    return properties.get(STARTUP_SIDEBAR_WIDTH_PROPERTY);
  }

  it("draws the sidebar the app resolves beside a closed agent panel", () => {
    for (const viewport of [375, 560, 616, 700, 768, 800, 1024, 1280]) {
      for (const collapsed of [false, true]) {
        for (const width of [240, 360]) {
          const expected = resolveContentSidebar(viewport, {
            collapsed,
            width,
          });
          expect(
            runStartupScript(viewport, {
              [SIDEBAR_COLLAPSED_KEY]: String(collapsed),
              [SIDEBAR_WIDTH_KEY]: String(width),
            }),
          ).toBe(expected === "docked" ? `${width}px` : expected);
        }
      }
    }
  });

  it("falls back to the default expanded sidebar without storage", () => {
    expect(runStartupScript(1280, "unavailable")).toBe(
      `${DEFAULT_SIDEBAR_WIDTH}px`,
    );
    expect(runStartupScript(1280, { [SIDEBAR_WIDTH_KEY]: "9000" })).toBe(
      `${DEFAULT_SIDEBAR_WIDTH}px`,
    );
  });
});
