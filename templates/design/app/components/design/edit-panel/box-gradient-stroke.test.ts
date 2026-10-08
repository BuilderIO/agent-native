import { describe, expect, it } from "vitest";

import {
  boxGradientStroke,
  boxStrokeLayerPatch,
  withBoxStrokeLayer,
  withoutBoxStrokeLayer,
} from "./box-gradient-stroke";

const STROKE = "linear-gradient(90deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)";
const FILL =
  "linear-gradient(180deg, rgb(0, 0, 0) 0%, rgb(255, 255, 255) 100%)";

describe("box gradient stroke layer", () => {
  it("adds the stroke as layer 0 clipped to border-area, keeping fill layers aligned", () => {
    const patch = boxStrokeLayerPatch(
      { backgroundImage: FILL, backgroundSize: "cover" },
      STROKE,
    );
    expect(patch).toEqual({
      backgroundImage: `${STROKE}, ${FILL}`,
      backgroundSize: "100% 100%, cover",
      backgroundRepeat: "no-repeat, repeat",
      backgroundPosition: "0% 0%, 0% 0%",
      backgroundClip: "border-area, border-box",
      backgroundOrigin: "border-box, padding-box",
    });
    expect(boxGradientStroke(patch)).toEqual({ layer: STROKE, hidden: false });
  });

  it("keeps a default bottom layer so background-color is not clipped to the border", () => {
    const patch = boxStrokeLayerPatch({ backgroundImage: "none" }, STROKE);
    expect(patch.backgroundImage).toBe(`${STROKE}, none`);
    expect(patch.backgroundClip).toBe("border-area, border-box");
    expect(boxGradientStroke(patch)).toEqual({ layer: STROKE, hidden: false });
    expect(withoutBoxStrokeLayer(patch).backgroundImage).toBe("none");
  });

  it("hides the Fill section's view of the stroke layer", () => {
    const styles = boxStrokeLayerPatch({ backgroundImage: FILL }, STROKE);
    expect(withoutBoxStrokeLayer(styles).backgroundImage).toBe(FILL);
    expect(withoutBoxStrokeLayer(styles).backgroundClip).toBe("border-box");
  });

  it("puts the stroke back on top when the Fill section adds a layer", () => {
    const styles = boxStrokeLayerPatch({ backgroundImage: FILL }, STROKE);
    const added = withBoxStrokeLayer(styles, {
      backgroundImage: `linear-gradient(rgb(1, 2, 3) 0 0), ${FILL}`,
      backgroundSize: "auto, auto",
    });
    expect(added.backgroundImage).toBe(
      `${STROKE}, linear-gradient(rgb(1, 2, 3) 0 0), ${FILL}`,
    );
    expect(added.backgroundClip).toBe("border-area, border-box, border-box");
  });

  it("leaves a fill patch alone when there is no gradient stroke", () => {
    const patch = { backgroundImage: FILL };
    expect(withBoxStrokeLayer({ backgroundImage: "none" }, patch)).toBe(patch);
  });

  it("removes only the stroke layer", () => {
    const styles = boxStrokeLayerPatch({ backgroundImage: FILL }, STROKE);
    expect(boxStrokeLayerPatch(styles, null).backgroundImage).toBe(FILL);
  });
});
