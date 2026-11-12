import { describe, expect, it } from "vitest";

import { ForbiddenError as PublicForbiddenError } from "./access.js";
import { ForbiddenError } from "./errors.js";

describe("ForbiddenError public contract", () => {
  it("keeps both import paths interchangeable for caller catch boundaries", () => {
    const refusal = new PublicForbiddenError(
      "Only an owner may perform this operation",
    );
    expect(PublicForbiddenError).toBe(ForbiddenError);
    expect(refusal).toBeInstanceOf(ForbiddenError);
    expect(refusal).toBeInstanceOf(Error);
    expect(refusal.statusCode).toBe(403);
    expect(refusal.name).toBe("ForbiddenError");
    expect(refusal.message).toBe("Only an owner may perform this operation");
  });

  it("retains the default safe refusal consumed by HTTP handlers", () => {
    const refusal = new ForbiddenError();
    expect(refusal.statusCode).toBe(403);
    expect(refusal.message).toBe("Forbidden");
  });
});
