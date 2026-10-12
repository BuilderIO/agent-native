import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import { POINTER_RUN_SORT_DEFINITIONS } from "./native-effect-owned-an-pointer-sort";
import { OWNED_FEEDBACK_TEST_DEFINITION } from "./native-effect-owned-test-fixtures";
import { hashEffectDefinition } from "./native-effect-trust";
import {
  validateEffectDocument,
  type EffectDefinition,
} from "./native-effects";
import {
  adaptNativeFeedbackDefinition,
  planNativeFeedback,
} from "./native-feedback-plan";

const candidate = OWNED_FEEDBACK_TEST_DEFINITION;

function errors(definition: EffectDefinition): string[] {
  return validateEffectDocument({
    schemaVersion: 2,
    definitions: [definition],
    instances: [],
  }).errors;
}

describe("Design-owned texture feedback contract", () => {
  it("requires an authored interaction for optional cursor feedback", () => {
    const definition = POINTER_RUN_SORT_DEFINITIONS[0];
    expect(errors(definition)).toEqual([]);
    expect(planEffectGraph(definition).errors).toEqual([]);
    const adapted = adaptNativeFeedbackDefinition(definition);
    expect(adapted.ok && adapted.definition.pointer).toBe("interaction-v1");
    const missingInteraction = { ...definition, interaction: undefined };
    expect(errors(missingInteraction)).toContainEqual(
      expect.stringContaining("feedback is invalid"),
    );
    const legacy = adaptNativeFeedbackDefinition(candidate);
    expect(
      legacy.ok &&
        Object.prototype.hasOwnProperty.call(legacy.definition, "pointer"),
    ).toBe(false);
  });
  it("accepts an explicit sequential source history requirement", () => {
    const definition: EffectDefinition = {
      ...candidate,
      feedback: {
        ...candidate.feedback!,
        sourceHistory: "sequential-captures",
      },
    };
    expect(errors(definition)).toEqual([]);
    expect(planEffectGraph(definition).errors).toEqual([]);
    const adapted = adaptNativeFeedbackDefinition(definition);
    expect(adapted.ok && adapted.definition.sourceHistory).toBe(
      "sequential-captures",
    );
    const legacy = adaptNativeFeedbackDefinition(candidate);
    expect(
      legacy.ok &&
        Object.prototype.hasOwnProperty.call(
          legacy.definition,
          "sourceHistory",
        ),
    ).toBe(false);
  });

  it("rejects unsupported history modes and hashes the declared requirement", async () => {
    const definition: EffectDefinition = {
      ...candidate,
      feedback: {
        ...candidate.feedback!,
        sourceHistory: "sequential-captures",
      },
    };
    expect(await hashEffectDefinition(definition)).not.toBe(
      await hashEffectDefinition(candidate),
    );
    const invalid = {
      ...definition,
      feedback: {
        ...definition.feedback!,
        sourceHistory: "replay-unseen-source",
      },
    } as unknown as EffectDefinition;
    expect(errors(invalid)).toContainEqual(
      expect.stringContaining("feedback is invalid"),
    );
    expect(planEffectGraph(invalid).errors).toContain(
      "feedback specification is malformed or unbounded",
    );
  });

  it("accepts bounded instanced resolves without changing the legacy adapter", () => {
    const definition: EffectDefinition = {
      ...candidate,
      feedback: {
        ...candidate.feedback!,
        resolveDraw: { vertices: 6, instances: 64 },
      },
    };
    expect(errors(definition)).toEqual([]);
    expect(planEffectGraph(definition).errors).toEqual([]);
    const adapted = adaptNativeFeedbackDefinition(definition);
    expect(adapted.ok && adapted.definition.resolveDraw).toEqual({
      vertices: 6,
      instances: 64,
    });
    if (!adapted.ok) throw new Error("Instanced feedback did not adapt.");
    const legacy = adaptNativeFeedbackDefinition(candidate);
    expect(
      legacy.ok &&
        Object.prototype.hasOwnProperty.call(legacy.definition, "resolveDraw"),
    ).toBe(false);
    for (const instances of [0, 257, 1.5]) {
      const invalid = {
        ...definition,
        feedback: {
          ...definition.feedback!,
          resolveDraw: { vertices: 6, instances },
        },
      };
      expect(errors(invalid as unknown as EffectDefinition)).toContainEqual(
        expect.stringContaining("feedback is invalid"),
      );
      expect(
        planEffectGraph(invalid as unknown as EffectDefinition).errors,
      ).toContain("feedback specification is malformed or unbounded");
      expect(
        planNativeFeedback(
          {
            ...adapted.definition,
            resolveDraw: { vertices: 6, instances },
          },
          {
            maxTextureDimension2D: 8192,
            maxComputeWorkgroupsPerDimension: 65535,
          },
        ),
      ).toEqual({ ok: false, code: "feedback-definition-invalid" });
    }
  });

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
