import { describe, expect, it } from "vitest";

import type { FormField } from "../../shared/types.js";
import { assertPublishableForm } from "./assert-publishable-form.js";

describe("assertPublishableForm", () => {
  it("rejects an empty published form", () => {
    expect(() => assertPublishableForm([])).toThrow(
      "Cannot publish: form has no fields",
    );
  });

  it("accepts a usable anonymous feedback form", () => {
    const fields: FormField[] = [
      {
        id: "rating",
        type: "rating",
        label: "How was your experience?",
        required: true,
      },
      {
        id: "comments",
        type: "textarea",
        label: "What could we improve?",
        required: false,
      },
    ];

    expect(() => assertPublishableForm(fields)).not.toThrow();
  });

  it("rejects unusable option and numeric fields", () => {
    const fields: FormField[] = [
      {
        id: "choice",
        type: "radio",
        label: "Choose one",
        required: true,
        options: [],
      },
      {
        id: "score",
        type: "number",
        label: "Score",
        required: true,
        validation: { min: 10, max: 1 },
      },
    ];

    expect(() => assertPublishableForm(fields)).toThrow(
      'field "Choose one" has no options; required field "Score" has min > max',
    );
  });
});
