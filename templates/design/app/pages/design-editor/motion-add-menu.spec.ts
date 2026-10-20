import type { MotionNativeStyleKey } from "@shared/motion-native-style";
import { describe, expect, it } from "vitest";

import type { MotionDockTrack } from "@/components/design/MotionDock";
import type { ElementInfo } from "@/components/design/types";

import {
  addMotionMarkers,
  motionMarkerValue,
  motionMenuProperties,
  nextReadyMadeStyle,
  READY_MADE_STYLE_ORDER,
  selectionHasOutermostFrame,
} from "./motion-add-menu";

function element(
  tagName: string,
  computedStyles: Record<string, string> = {},
  overrides: Partial<ElementInfo> = {},
): ElementInfo {
  return {
    tagName,
    selector: tagName,
    classes: [],
    computedStyles,
    inlineStyles: {},
    boundingRect: { x: 0, y: 0, width: 100, height: 50 },
    isFlexChild: false,
    isFlexContainer: false,
    childElementCount: 0,
    ...overrides,
  };
}

const rectangle = element(
  "div",
  { transform: "matrix(0.866, 0.5, -0.5, 0.866, 0, 0)" },
  { primitiveKind: "rectangle" },
);
const text = element("p", {}, { hasOwnText: true, textContent: "Hello" });

const ease = "ease-out" as const;

describe("selectionHasOutermostFrame", () => {
  it("is true for the screen's root layer and false for layers inside it", () => {
    expect(selectionHasOutermostFrame([element("div"), element("body")])).toBe(
      true,
    );
    expect(selectionHasOutermostFrame([element("html")])).toBe(true);
    expect(selectionHasOutermostFrame([element("div"), element("p")])).toBe(
      false,
    );
  });
});

describe("motionMenuProperties", () => {
  it("offers a choice only when every selected layer's panel offers it", () => {
    expect(motionMenuProperties([rectangle])).toEqual({
      basic: ["translate", "scale", "rotate", "opacity"],
      more: [
        "border-radius",
        "background-color",
        "border-color",
        "border-width",
        "box-shadow",
      ],
    });
    expect(motionMenuProperties([text, rectangle])).toEqual({
      basic: ["translate", "scale", "rotate", "opacity"],
      more: [],
    });
  });

  it("omits the menu for an empty selection and for outermost frames", () => {
    expect(motionMenuProperties([])).toBeNull();
    expect(motionMenuProperties([rectangle, element("body")])).toBeNull();
    expect(motionMenuProperties([element("html")])).toBeNull();
  });
});

describe("motionMarkerValue", () => {
  it("reads the current angle from the transform when rotate is none", () => {
    expect(
      motionMarkerValue(
        { rotate: "none", transform: "rotate(30deg)" },
        "rotate",
      ),
    ).toBe("30deg");
    expect(motionMarkerValue(rectangle.computedStyles, "rotate")).toBe("30deg");
  });

  it("prefers an authored rotate property and defaults to no turn", () => {
    expect(motionMarkerValue({ rotate: "45deg" }, "rotate")).toBe("45deg");
    expect(motionMarkerValue({ transform: "none" }, "rotate")).toBe("0deg");
    expect(motionMarkerValue({}, "rotate")).toBe("0deg");
  });

  it("falls back to the neutral value for unset properties", () => {
    expect(motionMarkerValue({ translate: "none" }, "translate")).toBe(
      "0px 0px",
    );
    expect(motionMarkerValue({ scale: "none" }, "scale")).toBe("1");
    expect(motionMarkerValue({}, "opacity")).toBe("1");
    expect(motionMarkerValue({ opacity: "0.4" }, "opacity")).toBe("0.4");
    expect(
      motionMarkerValue({ borderTopLeftRadius: "8px" }, "border-radius"),
    ).toBe("8px");
    expect(motionMarkerValue({ boxShadow: "none" }, "box-shadow")).toBe("none");
  });
});

describe("addMotionMarkers", () => {
  const base = {
    property: "rotate" as const,
    timelineDurationMs: 2000,
    ease,
  };

  it("adds one marker at the playhead with the layer's current value", () => {
    const tracks = addMotionMarkers({
      ...base,
      tracks: [],
      targets: [{ nodeId: "box", label: "Box", value: "30deg" }],
      playhead: 0.25,
    });
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      targetNodeId: "box",
      property: "rotate",
      label: "Box",
      keyframes: [{ t: 0.25, value: "30deg", ease }],
    });
  });

  it("adds a marker for every selected layer", () => {
    const tracks = addMotionMarkers({
      ...base,
      tracks: [],
      targets: [
        { nodeId: "a", label: "A", value: "0deg" },
        { nodeId: "b", label: "B", value: "90deg" },
      ],
      playhead: 0,
    });
    expect(
      tracks.map((track) => [track.targetNodeId, track.keyframes]),
    ).toEqual([
      ["a", [{ t: 0, value: "0deg", ease }]],
      ["b", [{ t: 0, value: "90deg", ease }]],
    ]);
  });

  it("adds to an existing track and never removes a marker", () => {
    const existing: MotionDockTrack = {
      targetNodeId: "box",
      property: "rotate",
      label: "Box",
      keyframes: [{ t: 0.5, value: "10deg", ease }],
    };
    const added = addMotionMarkers({
      ...base,
      tracks: [existing],
      targets: [{ nodeId: "box", label: "Box", value: "30deg" }],
      playhead: 1,
    });
    expect(added[0]?.keyframes).toEqual([
      { t: 0.5, value: "10deg", ease },
      { t: 1, value: "30deg", ease },
    ]);

    const again = addMotionMarkers({
      ...base,
      tracks: added,
      targets: [{ nodeId: "box", label: "Box", value: "55deg" }],
      playhead: 1,
    });
    expect(again).toBe(added);
  });

  it("places the marker on a track's own timing", () => {
    const delayed: MotionDockTrack = {
      targetNodeId: "box",
      property: "rotate",
      label: "Box",
      delayMs: 1000,
      durationMs: 1000,
      keyframes: [{ t: 0, value: "0deg", ease }],
    };
    const [track] = addMotionMarkers({
      ...base,
      tracks: [delayed],
      targets: [{ nodeId: "box", label: "Box", value: "20deg" }],
      playhead: 0.75,
    });
    expect(track?.keyframes).toEqual([
      { t: 0, value: "0deg", ease },
      { t: 0.5, value: "20deg", ease },
    ]);
  });

  it("covers worked case (a): turn on a rectangle marks its current angle", () => {
    expect(motionMenuProperties([rectangle])?.basic).toContain("rotate");
    const [track] = addMotionMarkers({
      ...base,
      tracks: [],
      targets: [
        {
          nodeId: "rectangle",
          label: "Rectangle",
          value: motionMarkerValue(rectangle.computedStyles, "rotate"),
        },
      ],
      playhead: 0.5,
    });
    expect(track?.keyframes).toEqual([{ t: 0.5, value: "30deg", ease }]);
  });
});

describe("nextReadyMadeStyle", () => {
  const textTarget = { nodeId: "text", isText: true };
  const boxTarget = { nodeId: "box", isText: false };
  const has = (targetNodeId: string, styleKey: MotionNativeStyleKey) => ({
    targetNodeId,
    styleKey,
  });

  it("adds text cascade to text layers that lack it", () => {
    expect(
      nextReadyMadeStyle({ targets: [textTarget], nativeStyles: [] }),
    ).toEqual({
      styleKey: "TextStagger",
      nodeIds: ["text"],
    });
  });

  it("does not offer text cascade when a non-text layer is selected (worked case b)", () => {
    expect(
      nextReadyMadeStyle({
        targets: [textTarget, boxTarget],
        nativeStyles: [],
      }),
    ).toEqual({ styleKey: "Position", nodeIds: ["text", "box"] });
  });

  it("adds move after text cascade on a text layer (worked case c)", () => {
    const first = nextReadyMadeStyle({
      targets: [textTarget],
      nativeStyles: [],
    });
    expect(first?.styleKey).toBe("TextStagger");
    expect(
      nextReadyMadeStyle({
        targets: [textTarget],
        nativeStyles: [has("text", "TextStagger")],
      }),
    ).toEqual({ styleKey: "Position", nodeIds: ["text"] });
  });

  it("continues after the last style in order the layers already have", () => {
    expect(
      nextReadyMadeStyle({
        targets: [boxTarget],
        nativeStyles: [has("box", "Position"), has("box", "Scale")],
      })?.styleKey,
    ).toBe("Rotation");
    expect(
      nextReadyMadeStyle({
        targets: [boxTarget],
        nativeStyles: [has("box", "Rotation")],
      })?.styleKey,
    ).toBe("Size");
  });

  it("wraps around to a style missed earlier in the order", () => {
    expect(
      nextReadyMadeStyle({
        targets: [boxTarget],
        nativeStyles: [has("box", "Opacity")],
      })?.styleKey,
    ).toBe("Position");
    expect(
      nextReadyMadeStyle({
        targets: [boxTarget],
        nativeStyles: [has("box", "Scale"), has("box", "Opacity")],
      })?.styleKey,
    ).toBe("Position");
  });

  it("adds only to the layers that lack the style", () => {
    expect(
      nextReadyMadeStyle({
        targets: [boxTarget, { nodeId: "other", isText: false }],
        nativeStyles: [has("box", "Position")],
      }),
    ).toEqual({ styleKey: "Position", nodeIds: ["other"] });
  });

  it("returns null when the layers have every style", () => {
    expect(
      nextReadyMadeStyle({
        targets: [boxTarget],
        nativeStyles: READY_MADE_STYLE_ORDER.map((styleKey) =>
          has("box", styleKey),
        ),
      }),
    ).toBeNull();
  });
});
