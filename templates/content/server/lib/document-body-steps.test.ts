import { describe, expect, it } from "vitest";

import {
  applyDocumentBodySteps,
  documentBodyStep,
} from "./document-body-steps.js";

const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

// A small seeded generator, so a failure names the run that found it.
function random(seed: number) {
  let state = seed >>> 0;
  return (limit: number) => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state % limit;
  };
}

const ALPHABET = ["a", "b", " ", "\n", "#", "😀", "😃", "é", "`"];

describe("document body steps", () => {
  it("records a typed character as the empty text it replaced", () => {
    expect(documentBodyStep("Hello", "Hello!")).toEqual({
      start: 5,
      end: 6,
      text: "",
    });
  });

  it("keeps both halves of an emoji a commit changed in its step", () => {
    const step = documentBodyStep("Mood 😀 ok", "Mood 😃 ok");

    expect(step.text).toBe("😀");
    expect(applyDocumentBodySteps("Mood 😃 ok", [step])).toBe("Mood 😀 ok");
  });

  it("refuses a step whose range is outside the body it applies to", () => {
    expect(
      applyDocumentBodySteps("Hello", [{ start: 2, end: 9, text: "x" }]),
    ).toBeNull();
  });

  it("rebuilds every earlier body from the current one", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const next = random(seed);
      const bodies = [""];
      const steps: ReturnType<typeof documentBodyStep>[] = [];
      for (let commit = 0; commit < 40; commit += 1) {
        const before = bodies[bodies.length - 1];
        const chars = Array.from(before);
        const at = next(chars.length + 1);
        const removed = next(4);
        const inserted = Array.from(
          { length: next(4) },
          () => ALPHABET[next(ALPHABET.length)],
        );
        chars.splice(at, removed, ...inserted);
        const after = chars.join("");
        if (after === before) continue;
        const step = documentBodyStep(before, after);
        expect(LONE_SURROGATE.test(step.text), `seed ${seed}`).toBe(false);
        steps.push(step);
        bodies.push(after);
      }
      const current = bodies[bodies.length - 1];
      for (let back = 1; back < bodies.length; back += 1) {
        expect(
          applyDocumentBodySteps(current, steps.slice(-back).reverse()),
          `seed ${seed}, ${back} back`,
        ).toBe(bodies[bodies.length - 1 - back]);
      }
    }
  });
});
