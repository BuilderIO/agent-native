import { describe, expect, it } from "vitest";

import {
  MAX_READ_THROUGH_RELATIONSHIPS,
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
