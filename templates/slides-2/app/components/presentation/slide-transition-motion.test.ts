import { describe, expect, it } from "vitest";

import {
  transitionDurationMs,
  type SlideTransitionType,
} from "../../../shared/slide-transitions";
import type { SlideDirection } from "./slide-navigation";
import {
  resolveSlideTransitionMotion,
  type LayerTiming,
} from "./slide-transition-motion";

const SPATIAL: SlideTransitionType[] = [
  "slide-from-right",
  "slide-from-left",
  "flip",
  "cube",
  "gallery",
];

describe("reduced motion", () => {
  it.each(SPATIAL)("plays %s as dissolve", (type) => {
    const reduced = resolveSlideTransitionMotion(type, "forward", {
      speed: 45,
      reducedMotion: true,
    });
    const dissolve = resolveSlideTransitionMotion("dissolve", "forward", {
      speed: 45,
      reducedMotion: false,
    });

    expect(reduced).toEqual(dissolve);
  });

  it("keeps spatial motion when reduced motion is off", () => {
    const flip = resolveSlideTransitionMotion("flip", "forward", {
      speed: 45,
      reducedMotion: false,
    });
    const dissolve = resolveSlideTransitionMotion("dissolve", "forward", {
      speed: 45,
      reducedMotion: false,
    });

    expect(flip).not.toEqual(dissolve);
  });

  it.each(["dissolve", "fade"] as const)(
    "leaves %s as it is under reduced motion",
    (type) => {
      const reduced = resolveSlideTransitionMotion(type, "forward", {
        speed: 45,
        reducedMotion: true,
      });
      const full = resolveSlideTransitionMotion(type, "forward", {
        speed: 45,
        reducedMotion: false,
      });

      expect(reduced).toEqual(full);
    },
  );

  it("keeps none instant under reduced motion", () => {
    expect(
      resolveSlideTransitionMotion("none", "forward", {
        speed: 45,
        reducedMotion: true,
      }),
    ).toBeNull();
  });
});

describe("transition duration", () => {
  it("takes the duration from the speed slider through transitionDurationMs", () => {
    for (const speed of [0, 20, 45, 49]) {
      const motion = resolveSlideTransitionMotion("dissolve", "forward", {
        speed,
        reducedMotion: false,
      });
      expect(motion?.durationMs).toBe(transitionDurationMs(speed));
    }
  });

  it("maps the slider ends to 5 s and 0.1 s", () => {
    const at = (speed: number | null | undefined) =>
      resolveSlideTransitionMotion("dissolve", "forward", {
        speed,
        reducedMotion: false,
      })?.durationMs;

    expect(at(0)).toBe(5000);
    expect(at(49)).toBe(100);
  });

  it("uses the default speed (45, 500 ms) when the slide has none", () => {
    expect(
      resolveSlideTransitionMotion("dissolve", "forward", {
        speed: undefined,
        reducedMotion: false,
      })?.durationMs,
    ).toBe(500);
  });

  it("clamps an out-of-range speed rather than failing", () => {
    expect(
      resolveSlideTransitionMotion("dissolve", "forward", {
        speed: 200,
        reducedMotion: false,
      })?.durationMs,
    ).toBe(100);
  });
});

describe("direction", () => {
  it("enters slide-from-right from the right going forward", () => {
    const motion = resolveSlideTransitionMotion("slide-from-right", "forward", {
      speed: 45,
      reducedMotion: false,
    });

    expect(motion?.incoming.keyframes[0].transform).toBe("translateX(100%)");
    expect(motion?.outgoing.keyframes[1].transform).toBe("translateX(-100%)");
  });

  it("mirrors slide-from-right when stepping backward", () => {
    const motion = resolveSlideTransitionMotion(
      "slide-from-right",
      "backward",
      {
        speed: 45,
        reducedMotion: false,
      },
    );

    expect(motion?.incoming.keyframes[0].transform).toBe("translateX(-100%)");
    expect(motion?.outgoing.keyframes[1].transform).toBe("translateX(100%)");
  });

  it("enters slide-from-left from the left going forward", () => {
    const motion = resolveSlideTransitionMotion("slide-from-left", "forward", {
      speed: 45,
      reducedMotion: false,
    });

    expect(motion?.incoming.keyframes[0].transform).toBe("translateX(-100%)");
  });
});

// Test-only sampler. Progress is local time run through the layer's easing, and
// keyframe offsets then interpolate between frames, as WAAPI does.
type Property = "opacity" | "translateX" | "rotateY";

// Solves x(s) = time for the cubic-bezier this module emits; `linear` is the identity.
function easeProgress(easing: string, time: number): number {
  if (easing === "linear") return time;
  const [x1, y1, x2, y2] = easing
    .slice("cubic-bezier(".length, -1)
    .split(",")
    .map(Number) as [number, number, number, number];
  const at = (a: number, b: number, s: number) =>
    3 * (1 - s) ** 2 * s * a + 3 * (1 - s) * s * s * b + s ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (at(x1, x2, mid) < time) lo = mid;
    else hi = mid;
  }
  return at(y1, y2, (lo + hi) / 2);
}

function valueAt(
  layer: LayerTiming,
  totalMs: number,
  fraction: number,
  property: Property,
): number {
  const progress = easeProgress(
    layer.easing,
    Math.min(
      1,
      Math.max(0, (fraction * totalMs - layer.delay) / layer.duration),
    ),
  );
  const frames = layer.keyframes;
  const read = (frame: Keyframe) =>
    property === "opacity"
      ? Number(frame.opacity)
      : Number(
          String(frame.transform).match(
            new RegExp(`${property}\\((-?[\\d.]+)`),
          )?.[1],
        );
  const offsets = frames.map(
    (frame, i) => frame.offset ?? i / (frames.length - 1),
  );
  for (let i = 0; i < frames.length - 1; i++) {
    if (progress <= offsets[i + 1]!) {
      const w = (progress - offsets[i]!) / (offsets[i + 1]! - offsets[i]!);
      const from = read(frames[i]!);
      return from + (read(frames[i + 1]!) - from) * w;
    }
  }
  return read(frames[frames.length - 1]!);
}

function sample(
  type: SlideTransitionType,
  direction: SlideDirection,
  layer: "outgoing" | "incoming",
  property: Property,
  fraction: number,
): number {
  const motion = resolveSlideTransitionMotion(type, direction, {
    speed: 45,
    reducedMotion: false,
  });
  if (!motion) throw new Error(`${type} has no motion`);
  return valueAt(motion[layer], motion.durationMs, fraction, property);
}

describe("linear transitions", () => {
  it.each(["dissolve", "fade", "flip", "cube"] as const)(
    "%s runs both layers linearly",
    (type) => {
      const motion = resolveSlideTransitionMotion(type, "forward", {
        speed: 45,
        reducedMotion: false,
      });
      expect(motion?.outgoing.easing).toBe("linear");
      expect(motion?.incoming.easing).toBe("linear");
    },
  );
});

describe("slide easing", () => {
  it.each([
    ["forward", [0.166, 0.53, 0.85]],
    ["backward", [0.162, 0.513, 0.852]],
  ] as const)(
    "eases both layers of both slide types through the recorded %s progress",
    (direction, targets) => {
      for (const type of ["slide-from-right", "slide-from-left"] as const) {
        const motion = resolveSlideTransitionMotion(type, direction, {
          speed: 45,
          reducedMotion: false,
        });
        if (!motion) throw new Error(`${type} has no motion`);
        for (const layer of [motion.outgoing, motion.incoming]) {
          expect(layer.easing).not.toBe("linear");
          [0.25, 0.5, 0.75].forEach((time, i) => {
            expect(
              Math.abs(easeProgress(layer.easing, time) - targets[i]!),
            ).toBeLessThan(0.02);
          });
        }
      }
    },
  );
});

describe("dissolve keyframes", () => {
  it("fades the incoming slide in linearly over the full duration", () => {
    const motion = resolveSlideTransitionMotion("dissolve", "forward", {
      speed: 45,
      reducedMotion: false,
    });
    expect(motion?.incoming).toMatchObject({ delay: 0, duration: 500 });
    expect(sample("dissolve", "forward", "incoming", "opacity", 0)).toBe(0);
    expect(
      sample("dissolve", "forward", "incoming", "opacity", 0.5),
    ).toBeCloseTo(0.5);
    expect(sample("dissolve", "forward", "incoming", "opacity", 1)).toBe(1);
  });

  it("keeps the outgoing slide at opacity 1 for the whole transition", () => {
    for (const fraction of [0, 0.5, 1]) {
      expect(
        sample("dissolve", "forward", "outgoing", "opacity", fraction),
      ).toBe(1);
    }
  });
});

describe("fade keyframes", () => {
  it("runs sequentially: the outgoing slide is gone at 0.49, a blank follows, and the incoming starts at 0.526", () => {
    const motion = resolveSlideTransitionMotion("fade", "forward", {
      speed: 45,
      reducedMotion: false,
    });

    expect(motion?.durationMs).toBe(500);
    expect(motion?.outgoing).toMatchObject({ delay: 0 });
    expect(motion?.outgoing.duration).toBeCloseTo(245);
    expect(motion?.incoming.delay).toBeCloseTo(263);
    expect(motion?.incoming.duration).toBeCloseTo(237);
  });

  it("is not a crossfade: before the split only the outgoing slide is visible", () => {
    expect(sample("fade", "forward", "incoming", "opacity", 0.25)).toBe(0);
    expect(
      sample("fade", "forward", "outgoing", "opacity", 0.25),
    ).toBeGreaterThan(0.4);
  });

  it("leaves both layers at 0 across the blank, then fades the incoming slide to 1", () => {
    expect(sample("fade", "forward", "outgoing", "opacity", 0.5)).toBe(0);
    expect(sample("fade", "forward", "incoming", "opacity", 0.5)).toBe(0);
    expect(sample("fade", "forward", "incoming", "opacity", 0.763)).toBeCloseTo(
      0.5,
    );
    expect(sample("fade", "forward", "incoming", "opacity", 1)).toBe(1);
  });
});

describe("slide keyframes", () => {
  it("pushes from the right on the slide curve: midpoint sits at the eased progress", () => {
    expect(
      sample("slide-from-right", "forward", "incoming", "translateX", 0),
    ).toBe(100);
    expect(
      sample("slide-from-right", "forward", "incoming", "translateX", 0.5),
    ).toBeCloseTo(48.2, 1);
    expect(
      sample("slide-from-right", "forward", "incoming", "translateX", 1),
    ).toBe(0);
    expect(
      sample("slide-from-right", "forward", "outgoing", "translateX", 0.5),
    ).toBeCloseTo(-51.8, 1);
    expect(
      sample("slide-from-right", "forward", "outgoing", "translateX", 1),
    ).toBe(-100);
  });

  it("pushes from the left on the same curve, mirrored", () => {
    expect(
      sample("slide-from-left", "forward", "incoming", "translateX", 0),
    ).toBe(-100);
    expect(
      sample("slide-from-left", "forward", "incoming", "translateX", 0.5),
    ).toBeCloseTo(-48.2, 1);
    expect(
      sample("slide-from-left", "forward", "outgoing", "translateX", 1),
    ).toBe(100);
  });
});

describe("flip keyframes", () => {
  it("turns both faces over the full duration: outgoing edge-on at the midpoint", () => {
    const motion = resolveSlideTransitionMotion("flip", "forward", {
      speed: 45,
      reducedMotion: false,
    });
    expect(motion?.outgoing).toMatchObject({ delay: 0, duration: 500 });
    expect(motion?.incoming).toMatchObject({ delay: 0, duration: 500 });

    expect(sample("flip", "forward", "outgoing", "rotateY", 0)).toBe(0);
    expect(sample("flip", "forward", "outgoing", "rotateY", 0.5)).toBeCloseTo(
      -90,
    );
    expect(sample("flip", "forward", "outgoing", "rotateY", 1)).toBe(-180);
    expect(sample("flip", "forward", "incoming", "rotateY", 0)).toBe(180);
    expect(sample("flip", "forward", "incoming", "rotateY", 0.5)).toBeCloseTo(
      90,
    );
    expect(sample("flip", "forward", "incoming", "rotateY", 1)).toBe(0);
  });

  it("mirrors every sign when stepping backward", () => {
    expect(sample("flip", "backward", "outgoing", "rotateY", 1)).toBe(180);
    expect(sample("flip", "backward", "incoming", "rotateY", 0)).toBe(-180);
  });
});

describe("cube keyframes", () => {
  it("turns both faces over the full duration, linearly", () => {
    expect(sample("cube", "forward", "outgoing", "rotateY", 0)).toBeCloseTo(0);
    expect(sample("cube", "forward", "outgoing", "rotateY", 0.5)).toBeCloseTo(
      -45,
    );
    expect(sample("cube", "forward", "outgoing", "rotateY", 1)).toBe(-90);
    expect(sample("cube", "forward", "incoming", "rotateY", 0)).toBe(90);
    expect(sample("cube", "forward", "incoming", "rotateY", 0.5)).toBeCloseTo(
      45,
    );
    expect(sample("cube", "forward", "incoming", "rotateY", 1)).toBeCloseTo(0);
  });

  it("sweeps right to left going forward: outgoing hinges on its left edge, incoming on its right", () => {
    const forward = resolveSlideTransitionMotion("cube", "forward", {
      speed: 45,
      reducedMotion: false,
    });
    const backward = resolveSlideTransitionMotion("cube", "backward", {
      speed: 45,
      reducedMotion: false,
    });

    expect(forward?.outgoing.keyframes[0]?.transformOrigin).toBe("0% 50%");
    expect(forward?.incoming.keyframes[0]?.transformOrigin).toBe("100% 50%");
    expect(backward?.outgoing.keyframes[0]?.transformOrigin).toBe("100% 50%");
    expect(backward?.incoming.keyframes[0]?.transformOrigin).toBe("0% 50%");
  });
});

describe("cube translate", () => {
  // translateX is in % of the face width; rotateY in degrees. At progress 0.5
  // the angle is 45 degrees, which gives the sqrt(2) midpoints below. At the
  // end the hinge alone has carried the outgoing centre to the left edge, so
  // its translate is 0.
  const root2 = Math.SQRT2;
  const expected = {
    forward: {
      outgoing: {
        translateX: [0, 50 * (1 - root2), 0],
        rotateY: [0, -45, -90],
      },
      incoming: { translateX: [0, 50 * (root2 - 1), 0], rotateY: [90, 45, 0] },
    },
    backward: {
      outgoing: { translateX: [0, 50 * (root2 - 1), 0], rotateY: [0, 45, 90] },
      incoming: {
        translateX: [0, 50 * (1 - root2), 0],
        rotateY: [-90, -45, 0],
      },
    },
  } as const;

  it.each(["forward", "backward"] as const)(
    "%s: each face starts, crosses the midpoint and ends at its translateX and rotateY",
    (direction) => {
      for (const layer of ["outgoing", "incoming"] as const) {
        const want = expected[direction][layer];
        [0, 0.5, 1].forEach((fraction, i) => {
          expect(
            sample("cube", direction, layer, "translateX", fraction),
          ).toBeCloseTo(want.translateX[i]!, 1);
          expect(
            sample("cube", direction, layer, "rotateY", fraction),
          ).toBeCloseTo(want.rotateY[i]!, 6);
        });
      }
    },
  );
});

function galleryLayer(layer: "outgoing" | "incoming"): LayerTiming {
  const motion = resolveSlideTransitionMotion("gallery", "forward", {
    speed: 45,
    reducedMotion: false,
  });
  if (!motion) throw new Error("gallery has no motion");
  return motion[layer];
}

// Largest tilt either way over the whole transition. The tilt keyframe is
// matched against eased progress, so its peak is not at a fixed time.
function tiltPeak(
  direction: SlideDirection,
  layer: "outgoing" | "incoming",
): number {
  let peak = 0;
  for (let i = 0; i <= 1000; i++) {
    const angle = sample("gallery", direction, layer, "rotateY", i / 1000);
    if (Math.abs(angle) > Math.abs(peak)) peak = angle;
  }
  return peak;
}

describe("back face", () => {
  it.each(["flip", "cube"] as const)(
    "hides the back face of both %s layers, which turn past 90 degrees",
    (type) => {
      const motion = resolveSlideTransitionMotion(type, "forward", {
        speed: 45,
        reducedMotion: false,
      });

      expect(motion?.outgoing.backfaceVisibility).toBe("hidden");
      expect(motion?.incoming.backfaceVisibility).toBe("hidden");
    },
  );

  it.each(["dissolve", "fade", "slide-from-right", "gallery"] as const)(
    "leaves %s layers showing their back face",
    (type) => {
      const motion = resolveSlideTransitionMotion(type, "forward", {
        speed: 45,
        reducedMotion: false,
      });

      expect(motion?.outgoing.backfaceVisibility).toBe("visible");
      expect(motion?.incoming.backfaceVisibility).toBe("visible");
    },
  );
});

describe("gallery keyframes", () => {
  it("travels past one slide width: outgoing from 0 to -115%, incoming from +110% to 0", () => {
    expect(
      sample("gallery", "forward", "outgoing", "translateX", 0),
    ).toBeCloseTo(0);
    expect(
      sample("gallery", "forward", "outgoing", "translateX", 1),
    ).toBeCloseTo(-115);
    expect(
      sample("gallery", "forward", "incoming", "translateX", 0),
    ).toBeCloseTo(110);
    expect(
      sample("gallery", "forward", "incoming", "translateX", 1),
    ).toBeCloseTo(0);
  });

  it.each([
    ["outgoing", [0.04, 0.38, 0.76]],
    ["incoming", [0.239, 0.509, 0.822]],
  ] as const)(
    "eases the %s layer through the recorded progress",
    (layer, targets) => {
      const { easing } = galleryLayer(layer);
      expect(easing).not.toBe("linear");
      [0.25, 0.5, 0.75].forEach((time, i) => {
        expect(Math.abs(easeProgress(easing, time) - targets[i]!)).toBeLessThan(
          0.02,
        );
      });
    },
  );

  it("moves the outgoing and incoming layers along those curves at the midpoint", () => {
    expect(
      -sample("gallery", "forward", "outgoing", "translateX", 0.5) / 115,
    ).toBeCloseTo(0.38, 2);
    expect(
      sample("gallery", "forward", "incoming", "translateX", 0.5),
    ).toBeCloseTo(54.6, 1);
  });

  it("tilts both layers 35 degrees at the peak and lies them flat at the ends", () => {
    expect(tiltPeak("forward", "outgoing")).toBeCloseTo(35, 0);
    expect(tiltPeak("forward", "incoming")).toBeCloseTo(35, 0);
    for (const layer of ["outgoing", "incoming"] as const) {
      expect(sample("gallery", "forward", layer, "rotateY", 0)).toBeCloseTo(0);
      expect(sample("gallery", "forward", layer, "rotateY", 1)).toBeCloseTo(0);
    }
  });

  it("mirrors every sign when stepping backward", () => {
    expect(
      sample("gallery", "backward", "outgoing", "translateX", 1),
    ).toBeCloseTo(115);
    expect(tiltPeak("backward", "outgoing")).toBeCloseTo(-35, 0);
    expect(
      sample("gallery", "backward", "incoming", "translateX", 0),
    ).toBeCloseTo(-110);
    expect(tiltPeak("backward", "incoming")).toBeCloseTo(-35, 0);
  });
});
