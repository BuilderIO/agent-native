import { describe, expect, it } from "vitest";

import {
  ATTRIBUTE_TYPE_SPECS,
  CRM_ATTRIBUTE_TYPES,
  legacyValueTypeFor,
  parseEmail,
  parsePersonalName,
  parsePhone,
  rootDomainOf,
  storageColumnFor,
  subFieldColumnsFor,
} from "./crm-attributes.js";

describe("CRM attribute registry", () => {
  it("specifies every declared type exactly once", () => {
    expect(Object.keys(ATTRIBUTE_TYPE_SPECS).sort()).toEqual(
      [...CRM_ATTRIBUTE_TYPES].sort(),
    );
  });

  it("keeps interaction and personal-name system-created only", () => {
    const systemOnly = CRM_ATTRIBUTE_TYPES.filter(
      (type) => ATTRIBUTE_TYPE_SPECS[type].systemOnly,
    );
    expect(systemOnly).toEqual(["interaction", "personal-name"]);
  });

  it("stores multi values as json regardless of the scalar column", () => {
    expect(storageColumnFor("select", false)).toBe("stringValue");
    expect(storageColumnFor("select", true)).toBe("jsonValue");
    expect(storageColumnFor("currency", false)).toBe("numberValue");
  });

  it("only status and select take managed options", () => {
    const withOptions = CRM_ATTRIBUTE_TYPES.filter(
      (type) => ATTRIBUTE_TYPE_SPECS[type].usesOptions,
    );
    expect(withOptions).toEqual(["status", "select"]);
  });
});

describe("legacy value type mapping", () => {
  it("gives every attribute type a NOT NULL legacy value_type", () => {
    for (const type of CRM_ATTRIBUTE_TYPES) {
      expect(legacyValueTypeFor(type, false)).toBeTruthy();
    }
  });

  it("maps every attribute type to its closest legacy value_type", () => {
    expect(legacyValueTypeFor("text", false)).toBe("string");
    expect(legacyValueTypeFor("number", false)).toBe("number");
    expect(legacyValueTypeFor("checkbox", false)).toBe("boolean");
    expect(legacyValueTypeFor("currency", false)).toBe("currency");
    expect(legacyValueTypeFor("date", false)).toBe("date");
    expect(legacyValueTypeFor("timestamp", false)).toBe("datetime");
    expect(legacyValueTypeFor("rating", false)).toBe("number");
    expect(legacyValueTypeFor("status", false)).toBe("enum");
    expect(legacyValueTypeFor("select", false)).toBe("enum");
    expect(legacyValueTypeFor("record-reference", false)).toBe("reference");
    expect(legacyValueTypeFor("actor-reference", false)).toBe("reference");
    expect(legacyValueTypeFor("location", false)).toBe("json");
    expect(legacyValueTypeFor("domain", false)).toBe("string");
    expect(legacyValueTypeFor("email-address", false)).toBe("string");
    expect(legacyValueTypeFor("phone-number", false)).toBe("string");
    expect(legacyValueTypeFor("interaction", false)).toBe("json");
    expect(legacyValueTypeFor("personal-name", false)).toBe("string");
  });

  it("only widens an enum base to multi-enum when multi is set", () => {
    expect(legacyValueTypeFor("select", true)).toBe("multi-enum");
    // record-reference's base isn't "enum", so multi leaves it alone.
    expect(legacyValueTypeFor("record-reference", true)).toBe("reference");
  });
});

describe("CRM composite parsers", () => {
  it("distinguishes absent from unparseable email", () => {
    expect(parseEmail(null)).toEqual({ status: "absent" });
    expect(parseEmail("   ")).toEqual({ status: "absent" });
    expect(parseEmail("not-an-email")).toMatchObject({
      status: "unparseable",
      local: null,
      domain: null,
      rootDomain: null,
    });
    expect(parseEmail("Ada@mail.Example.co.uk")).toEqual({
      status: "parsed",
      local: "ada",
      domain: "mail.example.co.uk",
      rootDomain: "example.co.uk",
    });
  });

  it("normalizes only explicitly international phone numbers", () => {
    expect(parsePhone(undefined)).toEqual({ status: "absent" });
    expect(parsePhone("555-0134")).toMatchObject({ status: "unparseable" });
    expect(parsePhone("+44 20 7946 0958")).toEqual({
      status: "parsed",
      e164: "+442079460958",
      country: "GB",
    });
    // +1 spans several countries — parsed, region deliberately undetermined.
    expect(parsePhone("+1 (415) 555-0134")).toEqual({
      status: "parsed",
      e164: "+14155550134",
      country: null,
    });
  });

  it("splits personal names in both written orders", () => {
    expect(parsePersonalName("")).toEqual({ status: "absent" });
    expect(parsePersonalName("Ada Lovelace")).toEqual({
      status: "parsed",
      first: "Ada",
      last: "Lovelace",
    });
    expect(parsePersonalName("Lovelace, Ada")).toEqual({
      status: "parsed",
      first: "Ada",
      last: "Lovelace",
    });
    expect(parsePersonalName("Prince")).toEqual({
      status: "parsed",
      first: "Prince",
      last: null,
    });
  });

  it("roots domains past multi-label public suffixes", () => {
    expect(rootDomainOf("https://www.shop.example.com/pricing?x=1")).toBe(
      "example.com",
    );
    expect(rootDomainOf("mail.example.co.uk")).toBe("example.co.uk");
    expect(rootDomainOf("localhost")).toBeNull();
    expect(rootDomainOf(null)).toBeNull();
  });

  it("derives only the sub-columns its type owns", () => {
    expect(subFieldColumnsFor("email-address", "ada@example.com")).toEqual({
      emailLocal: "ada",
      emailDomain: "example.com",
      emailRootDomain: "example.com",
    });
    expect(subFieldColumnsFor("phone-number", "+442079460958")).toEqual({
      phoneE164: "+442079460958",
      phoneCountry: "GB",
    });
    expect(subFieldColumnsFor("personal-name", "Ada Lovelace")).toEqual({
      nameFirst: "Ada",
      nameLast: "Lovelace",
    });
    expect(subFieldColumnsFor("domain", "https://example.co.uk")).toEqual({
      domainRoot: "example.co.uk",
    });
    expect(subFieldColumnsFor("text", "anything")).toEqual({});
  });
});
