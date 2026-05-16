import { describe, expect, it } from "vitest";
import {
  PROVIDER_READERS,
  getProviderReader,
  listProviderReaders,
  providerReaderSupports,
} from "./reader.js";

describe("provider reader registry", () => {
  it("registers conservative reader definitions for the initial providers", () => {
    expect(PROVIDER_READERS.map((reader) => reader.providerId)).toEqual([
      "slack",
      "github",
      "notion",
      "hubspot",
      "gmail",
      "google_drive",
      "generic",
    ]);
  });

  it("filters readers by provider, operation, capability, and implementation status", () => {
    expect(
      listProviderReaders({ operation: "listRecent" }).map(
        (reader) => reader.providerId,
      ),
    ).toEqual([
      "slack",
      "github",
      "notion",
      "hubspot",
      "gmail",
      "google_drive",
    ]);

    expect(
      listProviderReaders({ capability: "crm" }).map(
        (reader) => reader.providerId,
      ),
    ).toEqual(["hubspot"]);

    expect(
      listProviderReaders({ implementationStatus: "metadata-only" }).map(
        (reader) => reader.providerId,
      ),
    ).toEqual(["generic"]);

    expect(
      listProviderReaders({
        providerId: "google_drive",
        operation: "get",
      }).map((reader) => reader.providerId),
    ).toEqual(["google_drive"]);
  });

  it("looks up readers and checks operation support", () => {
    expect(getProviderReader("github")).toMatchObject({
      providerId: "github",
      implementationStatus: "template-owned",
      requiredCredentialKeys: ["GITHUB_TOKEN"],
    });
    expect(getProviderReader("missing")).toBeUndefined();

    expect(providerReaderSupports("slack", "search")).toBe(true);
    expect(providerReaderSupports("generic", "listRecent")).toBe(false);

    const genericReader = getProviderReader("generic");
    expect(genericReader).toBeDefined();
    expect(providerReaderSupports(genericReader!, "get")).toBe(true);
  });

  it("makes live implementation status explicit at reader and operation level", () => {
    for (const reader of PROVIDER_READERS) {
      expect(["metadata-only", "template-owned", "shared"]).toContain(
        reader.implementationStatus,
      );
      expect(reader.credentialKeys.map((credential) => credential.key)).toEqual(
        expect.arrayContaining(reader.requiredCredentialKeys),
      );

      for (const operation of reader.operations) {
        expect(["metadata-only", "template-owned", "shared"]).toContain(
          operation.implementationStatus,
        );
      }
    }

    expect(
      listProviderReaders({ implementationStatus: "shared" }),
    ).toHaveLength(0);
  });
});
