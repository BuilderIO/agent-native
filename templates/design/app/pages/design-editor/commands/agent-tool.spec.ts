// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";

const mocks = vi.hoisted(() => ({
  sendToDesignAgentChat: vi.fn(() => "tab-1"),
}));
vi.mock("@/lib/agent-chat", () => ({
  sendToDesignAgentChat: mocks.sendToDesignAgentChat,
}));

import {
  buildAgentSkillContext,
  runActivateAgentTool,
  runSendAgentSkill,
  type AgentSkillContextArgs,
} from "./agent-tool";

afterEach(() => {
  mocks.sendToDesignAgentChat.mockClear();
});

const screen = { id: "file-1", filename: "home.html" };

function context(
  overrides: Partial<AgentSkillContextArgs> = {},
): AgentSkillContextArgs {
  return {
    designId: "design-1",
    designTitle: "Landing",
    activeFile: screen,
    selectedScreens: [],
    selectedLayerIds: [],
    selectedElement: null,
    ...overrides,
  };
}

function element(overrides: Partial<ElementInfo> = {}): ElementInfo {
  return {
    tagName: "H1",
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 10, height: 10 },
    sourceId: "hero-title",
    selector: "[data-agent-native-node-id='hero-title']",
    textContent: "Welcome",
    ...overrides,
  } as ElementInfo;
}

describe("runActivateAgentTool", () => {
  function setters() {
    return {
      setActiveTool: vi.fn(),
      setDrawMode: vi.fn(),
      setMode: vi.fn(),
      setPinMode: vi.fn(),
    };
  }

  it("arms the Agent tool, drops drawing and pinning, and asks for the Agent panel", () => {
    const args = setters();
    const opened = vi.fn();
    window.addEventListener("agent-panel:open", opened);

    runActivateAgentTool(args);

    window.removeEventListener("agent-panel:open", opened);
    expect(args.setActiveTool).toHaveBeenCalledWith("agent");
    expect(args.setDrawMode).toHaveBeenCalledWith(false);
    expect(args.setPinMode).toHaveBeenCalledWith(false);
    expect(opened).toHaveBeenCalledOnce();
  });

  it("returns Annotate to Design but leaves Interact and Design alone", () => {
    const args = setters();
    runActivateAgentTool(args);
    const next = args.setMode.mock.calls[0]![0] as (current: string) => string;

    expect(next("annotate")).toBe("edit");
    expect(next("edit")).toBe("edit");
    expect(next("interact")).toBe("interact");
  });
});

describe("buildAgentSkillContext", () => {
  it("names the design and the active screen", () => {
    expect(buildAgentSkillContext(context())).toBe(
      [
        'Design "Landing" (designId: design-1)',
        "Active screen: home.html (fileId: file-1)",
        "Nothing is selected; use the active screen.",
      ].join("\n"),
    );
  });

  it("describes the selected element with its stable id and selector", () => {
    const lines = buildAgentSkillContext(
      context({
        selectedElement: element(),
        selectedLayerIds: ["hero-title"],
      }),
    ).split("\n");

    expect(lines).toContain('Selected element: <h1> "Welcome"');
    expect(lines).toContain("targetNodeId: hero-title");
    expect(lines).toContain(
      "targetSelector: [data-agent-native-node-id='hero-title']",
    );
    expect(lines).toContain("Selected layer ids: hero-title");
    expect(lines.some((line) => line.startsWith("Nothing is selected"))).toBe(
      false,
    );
  });

  it("trims a long text excerpt and caps the layer ids it lists", () => {
    const text = "x".repeat(200);
    const lines = buildAgentSkillContext(
      context({
        selectedElement: element({ textContent: text }),
        selectedLayerIds: Array.from({ length: 25 }, (_, index) => `n${index}`),
      }),
    );

    expect(lines).toContain(`"${"x".repeat(80)}..."`);
    expect(lines).not.toContain("x".repeat(81));
    expect(lines).toContain("(+5 more)");
    expect(lines).toContain("n19");
    expect(lines).not.toContain("n20");
  });

  it("falls back to the selected screens when no layer is selected", () => {
    const text = buildAgentSkillContext(
      context({
        selectedScreens: [screen, { id: "file-2", filename: "b.html" }],
      }),
    );

    expect(text).toContain(
      "Selected screens: home.html (fileId: file-1), b.html (fileId: file-2)",
    );
    expect(text).toContain(
      "No layer is selected; the selection is the screens above.",
    );
  });

  it("omits what it does not know", () => {
    expect(
      buildAgentSkillContext(
        context({ designTitle: null, activeFile: undefined }),
      ),
    ).toBe(
      [
        "designId: design-1",
        "Nothing is selected; use the active screen.",
      ].join("\n"),
    );
  });
});

describe("runSendAgentSkill", () => {
  it.each([
    ["inspiration", "Explore three alternative directions for the selection."],
    ["debug", "Find layout, overflow, and responsive problems on this screen."],
    ["polish", "Tighten spacing, type scale, and alignment on the selection."],
  ] as const)(
    "sends the %s prompt through the design agent chat, submitted and with the panel open",
    (skill, prompt) => {
      const args = context({ selectedElement: element() });

      runSendAgentSkill(skill, args);

      expect(mocks.sendToDesignAgentChat).toHaveBeenCalledExactlyOnceWith({
        message: prompt,
        context: buildAgentSkillContext(args),
        submit: true,
        openSidebar: true,
      });
    },
  );
});
