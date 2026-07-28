import { describe, expect, it } from "vitest";

import {
  crmRecordIdentityColumns,
  crmRecordSummaryColumns,
  fieldsForPolicyDiscovery,
  resolveMirrorFields,
  safeMirroredValue,
  storagePolicyFor,
} from "./crm-mirror.js";

const object = {
  connectionId: "connection",
  provider: "hubspot" as const,
  objectType: "contacts",
  kind: "person" as const,
  label: "Contact",
  pluralLabel: "Contacts",
  custom: false,
  queryable: true,
  searchable: true,
  createable: false,
  updateable: false,
  deleteable: false,
  fields: [
    {
      name: "email",
      label: "Email",
      valueType: "string" as const,
      storagePolicy: "remote-only" as const,
      sensitive: false,
      readable: true,
      createable: false,
      updateable: false,
      required: false,
    },
    {
      name: "secret",
      label: "Secret",
      valueType: "string" as const,
      storagePolicy: "redacted" as const,
      sensitive: true,
      readable: true,
      createable: false,
      updateable: false,
      required: false,
    },
    {
      name: "meeting_transcript",
      label: "Transcript",
      valueType: "string" as const,
      storagePolicy: "remote-only" as const,
      sensitive: false,
      readable: true,
      createable: false,
      updateable: false,
      required: false,
    },
  ],
};

describe("CRM mirror firewall", () => {
  it("defaults to the core allow-list and never mirrors sensitive or transcript fields", () => {
    expect(
      resolveMirrorFields({
        object,
        requested: undefined,
        allowCustomObject: false,
      }),
    ).toEqual(["email"]);
    expect(storagePolicyFor(object.fields[1]!, new Set(["secret"]))).toBe(
      "redacted",
    );
  });

  it("rejects media-shaped, base64-shaped, and oversized values before persistence", () => {
    expect(safeMirroredValue("data:audio/wav;base64,AAAA")).toBeNull();
    expect(safeMirroredValue("A".repeat(400))).toBeNull();
    expect(safeMirroredValue("x".repeat(2_001))).toBeNull();
    expect(safeMirroredValue(["active", "customer"])).toEqual([
      "active",
      "customer",
    ]);
  });

  it("requires an explicit opt-in and fields for custom objects", () => {
    expect(() =>
      resolveMirrorFields({
        object: { ...object, objectType: "2-100", custom: true },
        requested: ["email"],
        allowCustomObject: false,
      }),
    ).toThrow("Custom CRM objects");
  });

  it("uses a bounded Salesforce allow-list for standard objects", () => {
    expect(
      resolveMirrorFields({
        object: {
          ...object,
          provider: "salesforce",
          objectType: "Contact",
          fields: [
            { ...object.fields[0]!, name: "Email" },
            { ...object.fields[0]!, name: "FirstName" },
            { ...object.fields[0]!, name: "LastName" },
            { ...object.fields[0]!, name: "OwnerId" },
            { ...object.fields[2]!, name: "CallTranscript__c" },
          ],
        },
        requested: undefined,
        allowCustomObject: false,
      }),
    ).toEqual(["FirstName", "LastName", "Email", "OwnerId"]);
  });

  it("retains Salesforce identity and projects its standard summary aliases", () => {
    const record = {
      ref: {
        connectionId: "salesforce-connection",
        provider: "salesforce" as const,
        objectType: "Opportunity",
        kind: "opportunity" as const,
        remoteId: "006example",
      },
      displayName: "Renewal",
      fields: {
        Email: "owner@example.test",
        Website: "https://example.test",
        StageName: "Proposal",
        Amount: 12000,
        CloseDate: "2026-08-01",
        OwnerId: "005example",
        RecordTypeId: "012example",
      },
      remoteRevision: "2026-07-21T00:00:00.000Z",
      remoteUpdatedAt: "2026-07-21T00:00:00.000Z",
      deleted: false,
      accessScope: {
        key: "salesforce-connection:grant",
        mode: "user" as const,
        objectReadable: true,
        objectCreateable: false,
        objectUpdateable: false,
        objectDeleteable: false,
        recordVisibility: "actor" as const,
      },
      provenance: [],
    };

    expect(crmRecordIdentityColumns(record)).toEqual({
      provider: "salesforce",
      objectType: "Opportunity",
      kind: "opportunity",
    });
    expect(crmRecordSummaryColumns(record)).toMatchObject({
      primaryEmail: "owner@example.test",
      domain: "https://example.test",
      stage: "Proposal",
      amount: 12000,
      closeDate: "2026-08-01",
      ownerRemoteId: "005example",
      pipelineId: "012example",
    });
  });

  it("keeps CRM-owned cadence policy outside the remote field allow-list", () => {
    expect(
      fieldsForPolicyDiscovery(object).map((field) => [
        field.name,
        field.storagePolicy,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["desiredCadenceDays", "local-authoritative"],
        ["lastMeaningfulInteractionAt", "derived-local"],
        ["nextContactAt", "derived-local"],
      ]),
    );
  });
});
