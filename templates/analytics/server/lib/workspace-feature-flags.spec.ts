import { describe, expect, it } from "vitest";

import {
  classifyWorkspaceFeatureFlagList,
  validateWorkspaceFeatureFlagMutation,
  workspaceFeatureFlagTargetInput,
} from "./workspace-feature-flags.js";
const app = {
  id: "mail",
  name: "Mail",
  url: "https://mail.example.com",
  a2aUrl: "https://mail.example.com",
};
describe("fleet feature flag contracts", () => {
  it("does not mistake no-definitions for forbidden", () =>
    expect(
      classifyWorkspaceFeatureFlagList(app, {
        status: 200,
        body: {
          contractVersion: 1,
          status: "no-definitions",
          flags: [],
          canManage: false,
        },
      }).state,
    ).toBe("no-definitions"));
  it("keeps successful legacy shapes unknown", () =>
    expect(
      classifyWorkspaceFeatureFlagList(app, {
        status: 200,
        body: { flags: [{ key: "x" }], canManage: true },
      }).state,
    ).toBe("unknown-legacy"));
  it("classifies permission and unsupported responses", () => {
    expect(
      classifyWorkspaceFeatureFlagList(app, { status: 403, body: null }).state,
    ).toBe("forbidden");
    expect(
      classifyWorkspaceFeatureFlagList(app, { status: 404, body: null }).state,
    ).toBe("unsupported");
  });
  it("rejects legacy or mismatched mutation responses", () => {
    const expected = {
      key: "new-editor",
      orgId: "org-1",
      rules: { percentage: 50, rolloutEpoch: "epoch-1" },
    };
    expect(() =>
      validateWorkspaceFeatureFlagMutation(
        { key: "new-editor", rules: expected.rules },
        expected,
      ),
    ).toThrow("unsupported or unverified");
    expect(() =>
      validateWorkspaceFeatureFlagMutation(
        {
          contractVersion: 1,
          status: "ready",
          key: "new-editor",
          rules: { percentage: 25, rolloutEpoch: "epoch-1" },
          scope: { orgId: "org-1" },
        },
        expected,
      ),
    ).toThrow("did not persist");
  });
  it("accepts an exact versioned persisted mutation", () => {
    const rules = { percentage: 50, rolloutEpoch: "epoch-1" };
    expect(
      validateWorkspaceFeatureFlagMutation(
        {
          contractVersion: 1,
          status: "ready",
          key: "new-editor",
          rules,
          scope: { orgId: "org-1" },
        },
        { key: "new-editor", orgId: "org-1", rules },
      ),
    ).toMatchObject({ contractVersion: 1, key: "new-editor", rules });
  });
  it("accepts a server-generated epoch when the caller omitted one", () => {
    expect(
      validateWorkspaceFeatureFlagMutation(
        {
          contractVersion: 1,
          status: "ready",
          key: "new-editor",
          rules: { mode: "rules", percentage: 25, rolloutEpoch: "generated" },
          scope: { orgId: "org-1" },
        },
        {
          key: "new-editor",
          orgId: "org-1",
          rules: { mode: "rules", percentage: 25 },
        },
      ),
    ).toMatchObject({ contractVersion: 1, key: "new-editor" });
  });
  it("verifies off and enable-for-operator persisted semantics", () => {
    const base = {
      contractVersion: 1 as const,
      status: "ready" as const,
      key: "new-editor",
      scope: { orgId: "org-1" },
    };
    expect(() =>
      validateWorkspaceFeatureFlagMutation(
        { ...base, rules: { mode: "on", percentage: 100 } },
        {
          key: "new-editor",
          orgId: "org-1",
          rules: { mode: "off", emails: [], orgIds: [], percentage: 0 },
        },
      ),
    ).toThrow("did not persist");
    expect(() =>
      validateWorkspaceFeatureFlagMutation(
        { ...base, rules: { mode: "off", percentage: 0 } },
        {
          key: "new-editor",
          orgId: "org-1",
          rules: { mode: "off", emails: [], orgIds: [], percentage: 0 },
        },
      ),
    ).toThrow("did not persist");
    expect(() =>
      validateWorkspaceFeatureFlagMutation(
        { ...base, rules: { mode: "rules", emails: [] } },
        {
          key: "new-editor",
          orgId: "org-1",
          enabledForEmail: "admin@example.com",
        },
      ),
    ).toThrow("did not enable");
    expect(
      validateWorkspaceFeatureFlagMutation(
        {
          ...base,
          rules: { mode: "rules", emails: ["ADMIN@EXAMPLE.COM"] },
        },
        {
          key: "new-editor",
          orgId: "org-1",
          enabledForEmail: "admin@example.com",
        },
      ),
    ).toMatchObject({ key: "new-editor" });
  });
  it("compares canonicalized target arrays", () => {
    expect(
      validateWorkspaceFeatureFlagMutation(
        {
          contractVersion: 1,
          status: "ready",
          key: "new-editor",
          rules: {
            mode: "rules",
            emails: ["a@example.com", "B@example.com"],
            orgIds: ["org-a", "org-b"],
          },
          scope: { orgId: "org-1" },
        },
        {
          key: "new-editor",
          orgId: "org-1",
          rules: {
            mode: "rules",
            emails: ["b@example.com", "A@example.com"],
            orgIds: ["org-b", "org-a"],
          },
        },
      ),
    ).toMatchObject({ key: "new-editor" });
  });
  it("rejects stale targets from a percentage-only replacement", () => {
    expect(() =>
      validateWorkspaceFeatureFlagMutation(
        {
          contractVersion: 1,
          status: "ready",
          key: "new-editor",
          rules: {
            mode: "rules",
            emails: ["stale@example.com"],
            orgIds: [],
            percentage: 50,
            rolloutEpoch: "epoch-1",
          },
          scope: { orgId: "org-1" },
        },
        {
          key: "new-editor",
          orgId: "org-1",
          rules: {
            mode: "rules",
            emails: [],
            orgIds: [],
            percentage: 50,
            rolloutEpoch: "epoch-1",
          },
        },
      ),
    ).toThrow("did not persist");
  });
  it("rejects malformed targets instead of normalizing them away", () => {
    expect(() =>
      validateWorkspaceFeatureFlagMutation(
        {
          contractVersion: 1,
          status: "ready",
          key: "new-editor",
          rules: {
            mode: "rules",
            emails: [123],
            orgIds: [],
            percentage: 50,
          },
          scope: { orgId: "org-1" },
        },
        {
          key: "new-editor",
          orgId: "org-1",
          rules: {
            mode: "rules",
            emails: [],
            orgIds: [],
            percentage: 50,
          },
        },
      ),
    ).toThrow("did not persist");
  });
  it("sends explicit empty target lists for percentage replacements", () => {
    expect(
      workspaceFeatureFlagTargetInput({
        appId: "mail",
        key: "new-editor",
        operation: "replace-rules",
        rules: { mode: "rules", percentage: 50, rolloutEpoch: "epoch-1" },
      }),
    ).toEqual({
      key: "new-editor",
      operation: "replace-rules",
      rules: {
        mode: "rules",
        emails: [],
        orgIds: [],
        percentage: 50,
        rolloutEpoch: "epoch-1",
      },
    });
  });
});
