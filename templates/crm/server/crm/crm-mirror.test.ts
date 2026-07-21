import { describe, expect, it } from "vitest";

import {
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
    ).toThrow("Custom HubSpot objects");
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
