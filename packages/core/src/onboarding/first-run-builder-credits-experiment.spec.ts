import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAssignment, upsertAssignment } = vi.hoisted(() => ({
  getAssignment: vi.fn(),
  upsertAssignment: vi.fn(),
}));

vi.mock("../observability/store.js", () => ({
  getAssignment,
  upsertAssignment,
}));

import { runWithRequestContext } from "../server/request-context.js";
import { assignFirstRunBuilderCreditsV2 } from "../shared/first-run-builder-credits-experiment.js";
import {
  loadFirstRunBuilderCreditsV2Assignment,
  recordFirstRunBuilderCreditsV2Exposure,
  resolveFirstRunBuilderCreditsV2Assignment,
} from "./first-run-builder-credits-experiment.js";

describe("first-run Builder credits v2 persistence", () => {
  beforeEach(() => {
    getAssignment.mockReset();
    upsertAssignment.mockReset().mockResolvedValue(undefined);
  });

  it("resolves an arm without persistence, then records only after confirmation", async () => {
    getAssignment.mockResolvedValue(null);
    const authUserId = "auth-user-1";
    const expected = assignFirstRunBuilderCreditsV2(authUserId);

    await runWithRequestContext(
      { userEmail: "alice@example.com", authUserId },
      async () => {
        const assignment = await resolveFirstRunBuilderCreditsV2Assignment({
          flagEnabled: true,
        });
        expect(assignment).toMatchObject({
          authUserId,
          experiment_id: "first_run_builder_credits_v2",
          experiment_variant: expected?.experiment_variant,
        });
        expect(upsertAssignment).not.toHaveBeenCalled();

        await recordFirstRunBuilderCreditsV2Exposure({
          flagEnabled: true,
          experimentVariant: expected!.experiment_variant,
        });
        expect(upsertAssignment).toHaveBeenCalledWith({
          experimentId: "first_run_builder_credits_v2",
          userId: authUserId,
          variantId: expected?.experiment_variant,
          assignedAt: expect.any(Number),
        });
      },
    );
  });

  it("reuses a matching persisted arm after flag evaluation", async () => {
    const authUserId = "auth-user-2";
    const expected = assignFirstRunBuilderCreditsV2(authUserId);
    getAssignment.mockResolvedValue({
      experimentId: "first_run_builder_credits_v2",
      userId: authUserId,
      variantId: expected?.experiment_variant,
      assignedAt: 123,
    });

    await runWithRequestContext({ authUserId }, async () => {
      await expect(
        resolveFirstRunBuilderCreditsV2Assignment({ flagEnabled: true }),
      ).resolves.toMatchObject({
        authUserId,
        experiment_variant: expected?.experiment_variant,
      });
      expect(upsertAssignment).not.toHaveBeenCalled();
    });
  });

  it("does not assign by email when authenticated id is missing", async () => {
    await runWithRequestContext(
      { userEmail: "alice@example.com" },
      async () => {
        await expect(
          resolveFirstRunBuilderCreditsV2Assignment({ flagEnabled: true }),
        ).resolves.toBeNull();
        expect(getAssignment).not.toHaveBeenCalled();
        expect(upsertAssignment).not.toHaveBeenCalled();
      },
    );
  });

  it("does not read or persist an assignment while the feature flag is off", async () => {
    await runWithRequestContext({ authUserId: "auth-user-4" }, async () => {
      await expect(
        recordFirstRunBuilderCreditsV2Exposure({
          flagEnabled: false,
          experimentVariant: "control",
        }),
      ).resolves.toBeNull();
      expect(getAssignment).not.toHaveBeenCalled();
      expect(upsertAssignment).not.toHaveBeenCalled();
    });
  });

  it("fails loudly when persisted variant no longer matches the stable arm", async () => {
    const authUserId = "auth-user-3";
    const expected = assignFirstRunBuilderCreditsV2(authUserId);
    const wrongVariant =
      expected?.experiment_variant === "credits" ? "control" : "credits";
    getAssignment.mockResolvedValue({
      experimentId: "first_run_builder_credits_v2",
      userId: authUserId,
      variantId: wrongVariant,
      assignedAt: 123,
    });

    await runWithRequestContext({ authUserId }, async () => {
      await expect(loadFirstRunBuilderCreditsV2Assignment()).rejects.toThrow(
        "disagrees with the authenticated user assignment",
      );
    });
  });

  it("rejects confirmation for a different stable arm", async () => {
    const authUserId = "auth-user-5";
    const expected = assignFirstRunBuilderCreditsV2(authUserId);
    const wrongVariant =
      expected?.experiment_variant === "credits" ? "control" : "credits";

    await runWithRequestContext({ authUserId }, async () => {
      await expect(
        recordFirstRunBuilderCreditsV2Exposure({
          flagEnabled: true,
          experimentVariant: wrongVariant,
        }),
      ).rejects.toThrow(
        "Confirmed first-run Builder credits v2 assignment disagrees",
      );
      expect(upsertAssignment).not.toHaveBeenCalled();
    });
  });
});
