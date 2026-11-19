import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("../server/lib/intelligence.js", () => ({
  writeIntelligence: vi.fn(),
}));
vi.mock("../server/lib/brain.js", () => ({
  getAccessibleCapture: vi.fn(),
  readBrainAgentGuidance: vi.fn(),
}));
vi.mock("../server/lib/distillation-queue.js", () => ({
  enqueueCaptureDistillation: vi.fn(),
}));
vi.mock("../server/lib/search.js", () => ({
  redactSensitiveText: vi.fn(),
}));

import enqueueCaptures from "./enqueue-captures-distillation.js";
import writeIntelligence from "./write-intelligence.js";

function schemaOf(action: object): z.ZodType {
  if ("schema" in action && action.schema instanceof z.ZodType) {
    return action.schema;
  }
  throw new Error("Action has no Zod schema.");
}

const writeIntelligenceSchema = schemaOf(writeIntelligence);
const enqueueCapturesSchema = schemaOf(enqueueCaptures);

describe("action input contracts", () => {
  it("advertises evidence as required", () => {
    expect(writeIntelligence.tool.parameters?.required).toEqual(
      expect.arrayContaining(["kind", "title", "body", "evidence"]),
    );
  });

  it("parses CLI evidence", () => {
    const input = {
      kind: "action",
      title: "Follow up",
      body: "Review the proposal",
    };
    const evidence = [{ captureId: "capture-1", quote: "Review the proposal" }];
    for (const value of [undefined, null, [], "", "[]", "null", "invalid"]) {
      expect(
        writeIntelligenceSchema.safeParse({ ...input, evidence: value })
          .success,
      ).toBe(false);
    }
    for (const value of [
      evidence,
      JSON.stringify(evidence),
      JSON.stringify(JSON.stringify(evidence)),
    ]) {
      const parsed = writeIntelligenceSchema.parse({
        ...input,
        evidence: value,
      });
      expect(parsed).toMatchObject({ evidence, entities: [] });
    }
    const entities = [{ type: "person", name: "Alex" }];
    expect(
      writeIntelligenceSchema.parse({
        ...input,
        evidence,
        entities: JSON.stringify(entities),
      }),
    ).toMatchObject({ entities });
  });

  it("advertises capture IDs as required", () => {
    expect(enqueueCaptures.tool.parameters?.required ?? []).toContain(
      "captureIds",
    );
  });

  it("parses CLI capture IDs", () => {
    for (const value of [undefined, null, [], "", "[]"]) {
      expect(
        enqueueCapturesSchema.safeParse({ captureIds: value }).success,
      ).toBe(false);
    }
    const ids = ["capture-1"];
    for (const value of [
      ids,
      JSON.stringify(ids),
      JSON.stringify(JSON.stringify(ids)),
    ]) {
      expect(enqueueCapturesSchema.parse({ captureIds: value })).toMatchObject({
        captureIds: ids,
      });
    }
  });
});
