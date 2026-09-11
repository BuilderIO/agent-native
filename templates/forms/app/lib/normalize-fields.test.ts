import type { FormField } from "@shared/types";
import { describe, expect, it } from "vitest";

import { normalizeFields } from "./normalize-fields";

describe("normalizeFields", () => {
  it("keeps file fields renderable", () => {
    const field = {
      id: "attachments",
      type: "file",
      label: "Attachments",
      required: false,
      multiple: true,
      accept: "image/*",
    } as FormField;

    expect(normalizeFields([field])[0]).toMatchObject({
      type: "file",
      multiple: true,
      accept: "image/*",
    });
  });
});
