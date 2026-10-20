// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/uploads", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/uploads")
  >()),
  useFileUploadStatus: () => ({
    isSuccess: true,
    isError: false,
    data: { configured: true },
    refetch: vi.fn(),
  }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";

import { EditPanel } from "../EditPanel";
import type { ElementInfo } from "../types";
import {
  MOTION_MENU_BASIC_PROPERTIES,
  MOTION_MENU_MORE_PROPERTIES,
  isOutlineDrawingEligible,
  motionControlsOffered,
  motionStarterStyles,
} from "./motion-controls";

const ALL_PROPERTIES: readonly string[] = [
  ...MOTION_MENU_BASIC_PROPERTIES,
  ...MOTION_MENU_MORE_PROPERTIES,
];

function element(
  overrides: Partial<ElementInfo> & {
    computedStyles?: Record<string, string>;
  } = {},
): ElementInfo {
  return {
    tagName: "div",
    selector: ".layer",
    classes: [],
    inlineStyles: {},
    boundingRect: { x: 0, y: 0, width: 100, height: 50 },
    isFlexChild: false,
    isFlexContainer: false,
    childElementCount: 0,
    sourceId: "layer",
    ...overrides,
    computedStyles: {
      display: "block",
      position: "absolute",
      width: "100px",
      height: "50px",
      ...overrides.computedStyles,
    },
  };
}

const PAINTED = {
  backgroundColor: "rgb(10, 20, 30)",
  borderWidth: "2px",
  borderStyle: "solid",
  borderColor: "rgb(200, 0, 0)",
  boxShadow: "0px 4px 12px 0px rgba(0, 0, 0, 0.25)",
};

const rectangle = () =>
  element({ primitiveKind: "rectangle", computedStyles: PAINTED });
const boxlessText = () =>
  element({
    tagName: "p",
    hasOwnText: true,
    textContent: "Hello",
    computedStyles: { backgroundColor: "rgba(0, 0, 0, 0)" },
  });
const paintedText = () =>
  element({
    tagName: "p",
    hasOwnText: true,
    textContent: "Hello",
    computedStyles: { backgroundColor: "rgb(10, 20, 30)" },
  });
const openPath = (computedStyles: Record<string, string> = {}) =>
  element({
    tagName: "svg",
    primitiveKind: "path",
    vectorStrokeCanAlign: false,
    computedStyles: {
      stroke: "rgb(0, 0, 0)",
      strokeWidth: "2px",
      ...computedStyles,
    },
  });
const group = () => element({ isGroup: true, computedStyles: { ...PAINTED } });

describe("motionControlsOffered", () => {
  it("offers all nine controls for a painted rectangle", () => {
    expect(motionControlsOffered(rectangle())).toEqual(ALL_PROPERTIES);
  });

  it("offers a layer without fill or stroke the controls whose add button shows", () => {
    expect(motionControlsOffered(element({ primitiveKind: "frame" }))).toEqual(
      ALL_PROPERTIES,
    );
  });

  it("drops corner rounding, fill, stroke, and shadow for text without a box", () => {
    expect(motionControlsOffered(boxlessText())).toEqual(
      MOTION_MENU_BASIC_PROPERTIES,
    );
  });

  it("keeps corner rounding and fill for text that paints a box", () => {
    expect(motionControlsOffered(paintedText())).toEqual([
      ...MOTION_MENU_BASIC_PROPERTIES,
      "border-radius",
      "background-color",
    ]);
  });

  it("keeps vectors off the CSS fill and stroke controls", () => {
    expect(motionControlsOffered(openPath())).toEqual([
      ...MOTION_MENU_BASIC_PROPERTIES,
      "border-radius",
      "box-shadow",
    ]);
  });

  it("leaves a group's fill to its children", () => {
    expect(motionControlsOffered(group())).not.toContain("background-color");
    expect(motionControlsOffered(group())).toContain("border-color");
  });
});

describe("motionControlsOffered against the inspector", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function diamondProperties(selected: ElementInfo): Promise<string[]> {
    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <TooltipProvider>
            <EditPanel
              selectedElement={selected}
              viewMode="single"
              mode="edit"
              motionKeyframeState={{
                hasTimeline: true,
                keyframedProperties: [],
              }}
              onToggleMotionKeyframe={vi.fn()}
              onStyleChange={vi.fn()}
            />
          </TooltipProvider>
        </QueryClientProvider>,
      ),
    );
    const shown = new Set(
      Array.from(
        container.querySelectorAll<HTMLElement>("[data-motion-css-property]"),
      ).map((button) => button.dataset.motionCssProperty!),
    );
    return ALL_PROPERTIES.filter((property) => shown.has(property));
  }

  it.each([
    ["a painted rectangle", rectangle],
    ["text without a box", boxlessText],
    ["text that paints a box", paintedText],
    ["an open path", () => openPath({ boxShadow: PAINTED.boxShadow })],
    ["a group", group],
  ])(
    "offers the controls the panel shows a diamond for with %s",
    async (_name, make) => {
      const selected = make();
      expect(motionControlsOffered(selected)).toEqual(
        await diamondProperties(selected),
      );
    },
  );
});

describe("the inspector's add animation button for a top-level frame", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function addButton(selected: ElementInfo) {
    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <TooltipProvider>
            <EditPanel
              selectedElement={selected}
              viewMode="single"
              mode="edit"
              motionSelectedTarget={{ nodeId: "layer", label: "Layer" }}
              onCreateMotionNativeStyle={vi.fn()}
              onStyleChange={vi.fn()}
            />
          </TooltipProvider>
        </QueryClientProvider>,
      ),
    );
    return container.querySelector<HTMLButtonElement>(
      'button[aria-label="designEditor.motion.addMotion"]',
    );
  }

  it("greys the button with a tip that says the frame cannot be animated", async () => {
    const trigger = await addButton(element({ tagName: "body" }));
    expect(trigger?.disabled).toBe(true);
    await act(async () => {
      trigger!.parentElement!.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true }),
      );
      // The panel's own provider delays tooltips by 300ms.
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toBe(
      "designEditor.motion.addMenu.outermostFrame",
    );
  });

  it("leaves the button enabled for a layer inside the frame", async () => {
    expect((await addButton(rectangle()))?.disabled).toBe(false);
  });
});

describe("motionStarterStyles", () => {
  it("gives a layer with no fill the add-fill color", () => {
    expect(
      motionStarterStyles(
        element({ computedStyles: { backgroundColor: "rgba(0, 0, 0, 0)" } }),
        "background-color",
      ),
    ).toEqual({ backgroundColor: "#d9d9d9" });
  });

  it("gives a layer with no border the add-stroke border", () => {
    const bare = element({
      computedStyles: { borderWidth: "0px", borderStyle: "none" },
    });
    const starter = {
      borderWidth: "1px",
      borderStyle: "solid",
      borderColor: "#000000",
    };
    expect(motionStarterStyles(bare, "border-color")).toEqual(starter);
    expect(motionStarterStyles(bare, "border-width")).toEqual(starter);
  });

  it("gives a layer with no shadow the add-shadow drop shadow", () => {
    expect(
      motionStarterStyles(
        element({ computedStyles: { boxShadow: "none" } }),
        "box-shadow",
      ),
    ).toEqual({ boxShadow: "0px 4px 12px 0px rgba(0, 0, 0, 0.25)" });
  });

  it("leaves a layer that already has the look alone", () => {
    for (const property of MOTION_MENU_MORE_PROPERTIES) {
      expect(motionStarterStyles(rectangle(), property)).toBeNull();
    }
  });

  it("has no starter for the basic controls", () => {
    for (const property of MOTION_MENU_BASIC_PROPERTIES) {
      expect(motionStarterStyles(element(), property)).toBeNull();
    }
  });
});

describe("isOutlineDrawingEligible", () => {
  it.each([
    ["an open path", openPath()],
    [
      "a centered open path",
      openPath({ "--an-vector-stroke-position": "center" }),
    ],
    [
      "a line",
      element({
        tagName: "svg",
        primitiveKind: "line",
        vectorStrokeCanAlign: false,
        computedStyles: { stroke: "rgb(0, 0, 0)", strokeWidth: "1px" },
      }),
    ],
    ["a path with dashes set to none", openPath({ strokeDasharray: "none" })],
  ])("accepts %s", (_name, layer) => {
    expect(isOutlineDrawingEligible(layer)).toBe(true);
  });

  it.each(["rectangle", "ellipse", "circle", "polygon", "star"])(
    "rejects a %s",
    (primitiveKind) => {
      expect(
        isOutlineDrawingEligible(
          element({
            tagName: "svg",
            primitiveKind,
            vectorStrokeCanAlign: true,
            computedStyles: { stroke: "rgb(0, 0, 0)", strokeWidth: "2px" },
          }),
        ),
      ).toBe(false);
    },
  );

  it.each([
    [
      "a closed path",
      element({
        tagName: "svg",
        primitiveKind: "path",
        vectorStrokeCanAlign: true,
        computedStyles: { stroke: "rgb(0, 0, 0)", strokeWidth: "2px" },
      }),
    ],
    [
      "a complex vector",
      element({
        tagName: "svg",
        primitiveKind: "pasted-svg",
        vectorStrokeCanAlign: false,
        computedStyles: { stroke: "rgb(0, 0, 0)", strokeWidth: "2px" },
      }),
    ],
    ["an inside stroke", openPath({ "--an-vector-stroke-position": "inside" })],
    [
      "an outside stroke",
      openPath({ "--an-vector-stroke-position": "outside" }),
    ],
    ["a dashed stroke", openPath({ strokeDasharray: "4 2" })],
    ["a layer with no stroke", openPath({ stroke: "none" })],
    ["a layer with a zero-width stroke", openPath({ strokeWidth: "0px" })],
    ["a box layer", rectangle()],
  ])("rejects %s", (_name, layer) => {
    expect(isOutlineDrawingEligible(layer)).toBe(false);
  });
});
