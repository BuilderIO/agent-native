import { describe, expect, it } from "vitest";

import { isSqlInputName } from "./sql-input-name";

describe("isSqlInputName reserved words", () => {
  it.each(["class", "for", "None", "True", "lambda", "import", "in", "is"])(
    "rejects the keyword %s",
    (name) => expect(isSqlInputName(name)).toBe(false),
  );
  it.each(["Class", "none", "class_", "_class", "classes", "input_1"])(
    "accepts %s",
    (name) => expect(isSqlInputName(name)).toBe(true),
  );
});
