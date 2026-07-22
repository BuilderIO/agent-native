import { describe, expect, it, vi } from "vitest";

import {
  MAX_READ_THROUGH_RELATIONSHIPS,
  loadVerifiedReadThroughRecord,
  readThroughFieldNames,
  relatedSummaries,
  scopesAreCompatible,
} from "./read-through.js";

const scope = {
  key: "hubspot:grant",
  actorId: "owner@example.test",
  grantId: "grant",
  mode: "user" as const,
  objectReadable: true,
  objectCreateable: false,
  objectUpdateable: false,
  objectDeleteable: false,
  recordVisibility: "actor" as const,
};

describe("CRM read-through boundaries", () => {
  it("fails closed when the current provider scope differs from the mirror", () => {
    expect(
      scopesAreCompatible(scope, { ...scope, actorId: "other@example.test" }),
    ).toBe(false);
    expect(scopesAreCompatible(scope, scope)).toBe(true);
  });

  it("requests only readable mirrored fields", () => {
    expect(
      readThroughFieldNames([
        {
          fieldName: "name",
          storagePolicy: "mirrored",
          readable: true,
          sensitive: false,
        },
        {
          fieldName: "secret",
          storagePolicy: "redacted",
          readable: true,
          sensitive: true,
        },
        {
          fieldName: "unapproved",
          storagePolicy: "remote-only",
          readable: true,
          sensitive: false,
        },
      ]),
    ).toEqual(["name"]);
  });

  it("awaits an async provider scope before reading through a record", async () => {
    const getRecord = vi.fn().mockResolvedValue({
      ref: {
        connectionId: "salesforce-connection",
        provider: "salesforce",
        objectType: "Contact",
        kind: "person",
        remoteId: "003example",
      },
      displayName: "Ada Lovelace",
      fields: { Email: "ada@example.test" },
      deleted: false,
      accessScope: scope,
      provenance: [],
    });
    const adapter = {
      connection: {
        connectionId: "salesforce-connection",
        provider: "salesforce",
      },
      getAccessScope: vi.fn().mockResolvedValue(scope),
      getRecord,
      listRelationships: vi
        .fn()
        .mockResolvedValue({ relationships: [], complete: true }),
    };

    await expect(
      loadVerifiedReadThroughRecord({
        adapter: adapter as never,
        context: {
          id: "record-1",
          objectType: "Contact",
          kind: "person",
          remoteId: "003example",
          accessScopeJson: JSON.stringify(scope),
          fieldPolicies: [
            {
              fieldName: "Email",
              storagePolicy: "mirrored",
              readable: true,
              sensitive: false,
            },
          ],
        },
      }),
    ).resolves.toMatchObject({ remote: { displayName: "Ada Lovelace" } });
    expect(getRecord).toHaveBeenCalledWith(
      expect.objectContaining({ fields: ["Email"] }),
    );
  });

  it("fails closed before a read-through when Salesforce FLS changes", async () => {
    const storedScope = {
      ...scope,
      key: "salesforce-connection:grant",
      fieldPermissionsHash: "sf-fp-before",
      sharingFingerprint: "sf-share",
    };
    const getRecord = vi.fn();
    const adapter = {
      connection: {
        connectionId: "salesforce-connection",
        provider: "salesforce",
      },
      getAccessScope: vi.fn().mockResolvedValue({
        ...storedScope,
        fieldPermissionsHash: "sf-fp-after",
      }),
      getRecord,
      listRelationships: vi.fn(),
    };

    await expect(
      loadVerifiedReadThroughRecord({
        adapter: adapter as never,
        context: {
          id: "record-1",
          objectType: "Contact",
          kind: "person",
          remoteId: "003example",
          accessScopeJson: JSON.stringify(storedScope),
          fieldPolicies: [],
        },
      }),
    ).rejects.toThrow("CRM provider access changed");
    expect(getRecord).not.toHaveBeenCalled();
  });

  it("returns only locally accessible related summaries and caps the provider edge set", () => {
    const relationships = Array.from(
      { length: MAX_READ_THROUGH_RELATIONSHIPS + 1 },
      (_, index) => ({
        from: {
          connectionId: "hubspot",
          provider: "hubspot" as const,
          objectType: "companies",
          kind: "account" as const,
          remoteId: "company-1",
        },
        to: {
          connectionId: "hubspot",
          provider: "hubspot" as const,
          objectType: "contacts",
          kind: "person" as const,
          remoteId: `contact-${index}`,
        },
        relationshipType: "HUBSPOT_DEFINED:1",
      }),
    );
    const summaries = relatedSummaries("company-1", relationships, [
      {
        id: "person-1",
        remoteId: "contact-0",
        objectType: "contacts",
        displayName: "Ada Lovelace",
        kind: "person",
        primaryEmail: "ada@example.test",
        domain: null,
      },
    ]);

    expect(summaries).toEqual([
      expect.objectContaining({
        localId: "person-1",
        displayName: "Ada Lovelace",
        kind: "person",
      }),
    ]);
  });
});
