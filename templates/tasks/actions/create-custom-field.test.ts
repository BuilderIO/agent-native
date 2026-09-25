import { beforeEach, describe, expect, it, vi } from "vitest";

const { createCustomField } = vi.hoisted(() => ({
  createCustomField: vi.fn(),
}));

vi.mock("../server/custom-fields/store.js", () => ({
  createCustomField,
  requireUserEmail: (email: string | undefined) => {
    if (!email) throw new Error("Authentication required.");
    return email;
  },
}));

import createCustomFieldAction from "./create-custom-field.js";

describe("create-custom-field", () => {
  beforeEach(() => {
    createCustomField.mockReset();
    createCustomField.mockResolvedValue({
      id: "fld-1",
      title: "Estimate",
      type: "number",
      config: { precision: 0 },
    });
  });

  it("parses JSON config strings from CLI callers", async () => {
    await createCustomFieldAction.run(
      {
        title: "Estimate",
        type: "number",
        config: '{"precision":0}',
      },
      { userEmail: "alice@example.com", caller: "cli" },
    );

    expect(createCustomField).toHaveBeenCalledWith({
      ownerEmail: "alice@example.com",
      title: "Estimate",
      type: "number",
      config: { precision: 0 },
    });
  });
});
