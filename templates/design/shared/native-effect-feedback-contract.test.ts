import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import { OWNED_FEEDBACK_TEST_DEFINITION } from "./native-effect-owned-test-fixtures";
import { hashEffectDefinition } from "./native-effect-trust";
import {
  validateEffectDocument,
  type EffectDefinition,
} from "./native-effects";
import { adaptNativeFeedbackDefinition } from "./native-feedback-plan";

const candidate = OWNED_FEEDBACK_TEST_DEFINITION;

function errors(definition: EffectDefinition): string[] {
  return validateEffectDocument({
    schemaVersion: 2,
    definitions: [definition],
    instances: [],
  }).errors;
}

describe("Design-owned texture feedback contract", () => {
  it("validates two-output persistent compute and a bounded float resolve", () => {
    expect(errors(candidate)).toEqual([]);
    const plan = planEffectGraph(candidate);
    expect(plan.errors).toEqual([]);
    expect(plan.passes.map((pass) => pass.id)).toEqual(["advance", "resolve"]);
    expect(plan.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "feedbackState",
          producer: "advance",
          persistent: true,
        }),
        expect.objectContaining({
          name: "feedbackDisplay",
          producer: "advance",
          lastUse: 1,
        }),
      ]),
    );
    const adapted = adaptNativeFeedbackDefinition(candidate);
    expect(adapted.ok).toBe(true);
    if (adapted.ok) {
      expect(adapted.definition.computeWgsl).toContain("fn cs(");
      expect(adapted.definition.resolveWgsl).toContain("fn fs(");
      expect(adapted.definition.grid).toEqual({
        width: 768,
        height: 768,
        format: "rgba16float",
        workgroup: [8, 8],
      });
      expect(adapted.definition.uniformProperties).toEqual({
        intensity: "pigment",
        blockSize: "foldScale",
        drift: "flow",
        churn: "injection",
        blend: "mix",
        seed: "phase",
      });
    }
  });

  it("rejects missing display writes, unbounded resources, and invalid dispatch", () => {
    expect(
      errors({
        ...candidate,
        passes: [
          { ...candidate.passes[0], additionalOutputs: undefined },
          candidate.passes[1],
        ],
      }),
    ).toContainEqual(expect.stringContaining("feedback needs"));
    expect(
      errors({
        ...candidate,
        resources: candidate.resources?.map((resource) =>
          resource.name === "feedbackState"
            ? { ...resource, persistent: false }
            : resource,
        ),
      }),
    ).toContainEqual(expect.stringContaining("feedback needs"));
    expect(
      errors({
        ...candidate,
        feedback: {
          ...candidate.feedback!,
          grid: { ...candidate.feedback!.grid, width: 8192 },
        },
      }),
    ).toContainEqual(expect.stringContaining("feedback is invalid"));
    expect(
      planEffectGraph({
        ...candidate,
        feedback: {
          ...candidate.feedback!,
          timing: { ...candidate.feedback!.timing, maxStepsPerCall: 100_000 },
        },
      }).errors,
    ).toContain("feedback specification is malformed or unbounded");
    expect(errors({ ...candidate, feedback: undefined })).toContainEqual(
      expect.stringContaining("without an opt-in ABI"),
    );
    expect(
      adaptNativeFeedbackDefinition({ ...candidate, feedback: undefined }),
    ).toEqual({ ok: false, code: "feedback-definition-invalid" });
  });

  it("pins slot aliases into the hash and rejects duplicate or unbounded controls", async () => {
    const hash = await hashEffectDefinition(candidate);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      await hashEffectDefinition({ ...candidate, feedback: undefined }),
    ).not.toBe(hash);
    expect(
      await hashEffectDefinition({
        ...candidate,
        feedback: {
          ...candidate.feedback!,
          uniformProperties: {
            ...candidate.feedback!.uniformProperties,
            intensity: "flow",
          },
        },
      }),
    ).not.toBe(hash);
    for (const aliases of [
      { ...candidate.feedback!.uniformProperties, intensity: "flow" },
      {
        ...candidate.feedback!.uniformProperties,
        intensity: "missingProperty",
      },
      { ...candidate.feedback!.uniformProperties, extra: "pigment" },
    ]) {
      expect(
        errors({
          ...candidate,
          feedback: {
            ...candidate.feedback!,
            uniformProperties: aliases,
          },
        }),
      ).toContainEqual(expect.stringContaining("feedback is invalid"));
    }
    expect(
      errors({
        ...candidate,
        properties: {
          ...candidate.properties,
          pigment: {
            ...candidate.properties.pigment,
            max: 10,
          } as EffectDefinition["properties"][string],
        },
      }),
    ).toContainEqual(expect.stringContaining("feedback is invalid"));
  });
});
