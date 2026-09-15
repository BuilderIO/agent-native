import { describe, expect, it } from "vitest";

import type { FormField } from "../../shared/types.js";
import {
  assertNotUnconfirmedFieldLoss,
  detectMassFieldLoss,
} from "./assert-not-unconfirmed-field-loss.js";

function field(id: string, label = id): FormField {
  return { id, type: "text", label, required: false };
}

describe("detectMassFieldLoss", () => {
  it("reports an unrelated schema that keeps nothing", () => {
    expect(
      detectMassFieldLoss(
        [field("rating"), field("comments"), field("email")],
        [field("room_type"), field("check_in")],
      ),
    ).toMatchObject({ existingCount: 3, droppedCount: 3, retainedCount: 0 });
  });

  it("reports a rewrite that keeps only the generic fields", () => {
    expect(
      detectMassFieldLoss(
        [
          field("full_name"),
          field("email"),
          field("rating"),
          field("comments"),
        ],
        [field("full_name"), field("email"), field("hotel_pass")],
      ),
    ).toMatchObject({ droppedCount: 2, retainedCount: 2 });
  });

  it("ignores a single removed field", () => {
    expect(
      detectMassFieldLoss(
        [field("a"), field("b"), field("c")],
        [field("a"), field("b")],
      ),
    ).toBeNull();
  });

  it("ignores appends and reorders", () => {
    expect(
      detectMassFieldLoss(
        [field("a"), field("b")],
        [field("b"), field("a"), field("c")],
      ),
    ).toBeNull();
  });

  it("ignores a form too small to lose anything meaningful", () => {
    expect(detectMassFieldLoss([field("a")], [field("z")])).toBeNull();
  });

  it("treats a regenerated id for the same question as retained", () => {
    expect(
      detectMassFieldLoss(
        [field("full_name", "Full Name"), field("email", "Email")],
        [field("name", "Full Name"), field("email_address", "Email")],
      ),
    ).toBeNull();
  });

  it("ignores an empty existing schema", () => {
    expect(detectMassFieldLoss([], [field("a"), field("b")])).toBeNull();
  });
});

describe("assertNotUnconfirmedFieldLoss", () => {
  const existing = [
    field("full_name", "Full Name"),
    field("email", "Email"),
    field("rating", "Rating"),
    field("comments", "Feedback Comments"),
  ];
  const incoming = [
    field("full_name", "Full Name"),
    field("email", "Email"),
    field("hotel_pass", "Do you need a hotel pass?"),
  ];

  it("points the caller at create-form and names what would be lost", () => {
    try {
      assertNotUnconfirmedFieldLoss({
        existing,
        incoming,
        confirmed: false,
        existingTitle: "Customer Feedback",
        incomingTitle: "Event Registration",
      });
      expect.unreachable("should have failed");
    } catch (error) {
      const failure = error as Error & { errorCode?: string };
      expect(failure.errorCode).toBe("unconfirmed_field_loss");
      expect(failure.message).toContain("Rating, Feedback Comments");
      expect(failure.message).toContain('renames it to "Event Registration"');
      expect(failure.message).toContain("call create-form instead");
      expect(failure.message).toContain("confirmReplaceFields: true");
    }
  });

  it("passes once the caller confirms the rewrite", () => {
    expect(() =>
      assertNotUnconfirmedFieldLoss({
        existing,
        incoming,
        confirmed: true,
        existingTitle: "Customer Feedback",
        incomingTitle: "Event Registration",
      }),
    ).not.toThrow();
  });

  it("does not mention a rename when the title is unchanged", () => {
    try {
      assertNotUnconfirmedFieldLoss({
        existing,
        incoming,
        confirmed: false,
        existingTitle: "Customer Feedback",
      });
      expect.unreachable("should have failed");
    } catch (error) {
      expect((error as Error).message).not.toContain("renames it");
    }
  });
});
