import { z } from "zod";

import type { AskFixtureBridge } from "../../../server/lib/phase1-ask-fixture.js";

export const modelControlInput = z.strictObject({
  operation: z.literal("ask-model-unavailable"),
  prompt: z.string().min(1).max(200),
  unavailable: z.boolean(),
});

export const askControlInput = z.discriminatedUnion("operation", [
  modelControlInput,
  z.strictObject({
    operation: z.literal("ask-fail-upload"),
    filename: z.string().regex(/^phase1-ask-[a-f0-9-]{36}\.csv$/),
    armed: z.boolean(),
  }),
]);

export function createAskControl() {
  const uploads = new Set<string>();
  const prompts = new Set<string>();
  const bridge: AskFixtureBridge = {
    failUpload: (filename) => uploads.delete(filename),
    modelUnavailable: (prompt) => prompts.has(prompt),
  };
  function control(input: z.infer<typeof askControlInput>) {
    if (input.operation === "ask-fail-upload") {
      if (input.armed) uploads.add(input.filename);
      else uploads.delete(input.filename);
      return { armed: uploads.has(input.filename) };
    }
    if (input.unavailable) prompts.add(input.prompt);
    else prompts.delete(input.prompt);
    return { unavailable: prompts.has(input.prompt) };
  }
  return { bridge, control };
}
