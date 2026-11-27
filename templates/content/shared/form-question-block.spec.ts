import { describe, expect, it } from "vitest";

import { contentFormCanvasQuestions } from "../actions/_content-form-questions.js";
import {
  FORM_QUESTION_BLOCK_TYPE,
  formQuestionBlockRaw,
  readFormQuestionData,
} from "./form-question-block.js";
import { registryBlockSpecByTag } from "./nfm-registry.js";

describe("form-question block", () => {
  it("is a registered Content block whose page source round-trips its question", async () => {
    expect(registryBlockSpecByTag("FormQuestion")?.type).toBe(
      FORM_QUESTION_BLOCK_TYPE,
    );
    const canvas = [
      "# Request a design",
      "",
      "Tell us what you need.",
      "",
      formQuestionBlockRaw("q-name", { propertyId: "name", required: true }),
      "",
      "Pick the most honest priority.",
      "",
      formQuestionBlockRaw("q-priority", {
        propertyId: "priority_1",
        required: false,
        help: "P0 means a customer is blocked",
        placeholder: "Choose one",
      }),
    ].join("\n");

    await expect(contentFormCanvasQuestions(canvas)).resolves.toEqual([
      { propertyId: "name", required: true },
      {
        propertyId: "priority_1",
        required: false,
        help: "P0 means a customer is blocked",
        placeholder: "Choose one",
      },
    ]);
  });

  it("accepts only a property ID, a required flag, and optional help and placeholder", () => {
    expect(readFormQuestionData({ propertyId: "p1", required: true })).toEqual({
      propertyId: "p1",
      required: true,
    });
    expect(readFormQuestionData({ propertyId: "", required: true })).toBe(null);
    expect(
      readFormQuestionData({ propertyId: "p1", required: true, label: "x" }),
    ).toBe(null);
    expect(readFormQuestionData({ propertyId: "p1" })).toBe(null);
  });
});
