import { describe, expect, it } from "vitest";
import { PUBLIC_PLAN_ACTION_PATHS } from "./public-action-paths.js";

describe("PUBLIC_PLAN_ACTION_PATHS", () => {
  it("does not expose the account plan list to signed-out HTTP callers", () => {
    expect(PUBLIC_PLAN_ACTION_PATHS).not.toContain(
      "/_agent-native/actions/list-visual-plans",
    );
  });

  it("does not expose plan creation actions to signed-out HTTP callers", () => {
    expect(PUBLIC_PLAN_ACTION_PATHS).not.toContain(
      "/_agent-native/actions/create-visual-plan",
    );
    expect(PUBLIC_PLAN_ACTION_PATHS).not.toContain(
      "/_agent-native/actions/create-ui-plan",
    );
    expect(PUBLIC_PLAN_ACTION_PATHS).not.toContain(
      "/_agent-native/actions/create-prototype-plan",
    );
    expect(PUBLIC_PLAN_ACTION_PATHS).not.toContain(
      "/_agent-native/actions/create-plan-design",
    );
    expect(PUBLIC_PLAN_ACTION_PATHS).not.toContain(
      "/_agent-native/actions/create-visual-questions",
    );
    expect(PUBLIC_PLAN_ACTION_PATHS).not.toContain(
      "/_agent-native/actions/visualize-plan",
    );
    expect(PUBLIC_PLAN_ACTION_PATHS).not.toContain(
      "/_agent-native/actions/convert-visual-plan-to-prototype",
    );
  });

  it("keeps local no-account publish callable so it can return needsAuth", () => {
    expect(PUBLIC_PLAN_ACTION_PATHS).toContain(
      "/_agent-native/actions/publish-visual-plan",
    );
  });

  it("allows signed-out public-link viewers to submit bounded abuse reports", () => {
    expect(PUBLIC_PLAN_ACTION_PATHS).toContain(
      "/_agent-native/actions/report-visual-plan",
    );
  });
});
