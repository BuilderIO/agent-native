import { describe, expect, it } from "vitest";

import {
  NativeCrmAdapter,
  nativeObjectTemplate,
  nextNativeRevision,
} from "./native-adapter.js";

describe("native CRM contract", () => {
  it("exposes local-authoritative standard object fields", () => {
    const accounts = nativeObjectTemplate("accounts");
    expect(accounts).toMatchObject({
      provider: "native",
      kind: "account",
      custom: false,
    });
    expect(accounts.fields).toContainEqual(
      expect.objectContaining({
        name: "name",
        storagePolicy: "local-authoritative",
        createable: true,
        updateable: true,
      }),
    );
    expect(accounts.fields).toContainEqual(
      expect.objectContaining({
        name: "desiredCadenceDays",
        valueType: "number",
        storagePolicy: "local-authoritative",
      }),
    );
    expect(nativeObjectTemplate("renewals")).toMatchObject({
      provider: "native",
      kind: "custom",
      custom: true,
    });
  });

  it("uses monotonically increasing portable revisions", () => {
    expect(nextNativeRevision(undefined)).toBe("1");
    expect(nextNativeRevision("41")).toBe("42");
    expect(nextNativeRevision("not-a-number")).toBe("1");
  });

  it("uses a stable full-permission native workspace scope", () => {
    const adapter = new NativeCrmAdapter({
      id: "native-connection",
      accountId: null,
      accessScopeKey: "native:native-connection",
      accessScopeJson: JSON.stringify({
        key: "native:native-connection",
        mode: "native",
        recordVisibility: "workspace",
      }),
      ownerEmail: "owner@example.test",
      orgId: "org-42",
      visibility: "org",
    });
    expect(adapter.getAccessScope()).toEqual({
      key: "native:native-connection",
      actorId: "owner@example.test",
      mode: "native",
      objectReadable: true,
      objectCreateable: true,
      objectUpdateable: true,
      objectDeleteable: true,
      recordVisibility: "workspace",
    });
  });

  it("keeps private native connections actor-scoped", () => {
    const adapter = new NativeCrmAdapter({
      id: "private-native-connection",
      accountId: null,
      accessScopeKey: "native:private-native-connection",
      accessScopeJson: "{}",
      ownerEmail: "owner@example.test",
      orgId: null,
      visibility: "private",
    });
    expect(adapter.getAccessScope().recordVisibility).toBe("actor");
  });

  it("fails closed when a mutation addresses another connection", async () => {
    const adapter = new NativeCrmAdapter({
      id: "native-connection",
      accountId: null,
      accessScopeKey: "native:native-connection",
      accessScopeJson: "{}",
      ownerEmail: "owner@example.test",
      orgId: null,
      visibility: "private",
    });
    await expect(
      adapter.applyMutation({
        operation: "create",
        record: {
          connectionId: "other-connection",
          provider: "native",
          objectType: "accounts",
          kind: "account",
          remoteId: "acc-1",
        },
        fields: { name: "Acme" },
        idempotencyKey: "create-acc-1",
      }),
    ).resolves.toMatchObject({ status: "rejected" });
  });
});
