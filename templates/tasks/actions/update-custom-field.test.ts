import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateCustomField } = vi.hoisted(() => ({
  updateCustomField: vi.fn(),
}));

vi.mock("../server/custom-fields/store.js", () => ({
  updateCustomField,
  requireUserEmail: (email: string | undefined) => {
    if (!email) throw new Error("Authentication required.");
    return email;
  },
}));

import updateCustomFieldAction from "./update-custom-field.js";

describe("update-custom-field", () => {
  beforeEach(() => {
    updateCustomField.mockReset();
    updateCustomField.mockResolvedValue({
      id: "fld-1",
      title: "Priority",
      type: "single_select",
      config: { options: [{ id: "high", name: "High", sortOrder: 0 }] },
    });
  });

  it("preserves select config through the action schema", async () => {
    const config = {
      options: [{ id: "high", name: "High", color: "red", sortOrder: 0 }],
    };

    await updateCustomFieldAction.run(
      { fieldId: "fld-1", config },
      { userEmail: "alice@example.com", caller: "cli" },
    );

    expect(updateCustomField).toHaveBeenCalledWith({
      ownerEmail: "alice@example.com",
      fieldId: "fld-1",
      title: undefined,
      config,
    });
  });

  it("preserves currency config through the action schema", async () => {
    const config = { symbol: "€", precision: 2 };

    await updateCustomFieldAction.run(
      { fieldId: "fld-1", config },
      { userEmail: "alice@example.com", caller: "cli" },
    );

    expect(updateCustomField).toHaveBeenCalledWith({
      ownerEmail: "alice@example.com",
      fieldId: "fld-1",
      title: undefined,
      config,
    });
  });

  it("parses JSON config strings from CLI callers", async () => {
    await updateCustomFieldAction.run(
      {
        fieldId: "fld-1",
        config: '{"options":[{"id":"high","name":"High","color":"red"}]}',
      },
      { userEmail: "alice@example.com", caller: "cli" },
    );

    expect(updateCustomField).toHaveBeenCalledWith({
      ownerEmail: "alice@example.com",
      fieldId: "fld-1",
      title: undefined,
      config: { options: [{ id: "high", name: "High", color: "red" }] },
    });
  });
});
