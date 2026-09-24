import { describe, it, expect } from "vitest";

import {
  FREE_EMAIL_PROVIDER_DOMAINS,
  isFreeEmailProvider,
} from "./free-email-providers.js";

describe("isFreeEmailProvider", () => {
  it("flags well-known free/public mailbox providers", () => {
    // Security invariant: these must never be usable as an org auto-join
    // domain — anyone in the world can mint a matching address.
    for (const domain of [
      "gmail.com",
      "outlook.com",
      "yahoo.com",
      "icloud.com",
      "proton.me",
      "qq.com",
      "mailinator.com",
    ]) {
      expect(isFreeEmailProvider(domain)).toBe(true);
    }
  });

  it("does NOT flag company-owned domains", () => {
    for (const domain of [
      "builder.io",
      "acme.com",
      "anthropic.com",
      "example.org",
    ]) {
      expect(isFreeEmailProvider(domain)).toBe(false);
    }
  });

  it("is case-insensitive (a domain is just-as-free in any case)", () => {
    expect(isFreeEmailProvider("Gmail.com")).toBe(true);
    expect(isFreeEmailProvider("GMAIL.COM")).toBe(true);
    expect(isFreeEmailProvider("GmAiL.CoM")).toBe(true);
  });

  it("trims surrounding whitespace before matching", () => {
    expect(isFreeEmailProvider("  gmail.com  ")).toBe(true);
    expect(isFreeEmailProvider("\tyahoo.com\n")).toBe(true);
  });

  it("does not treat a subdomain of a free provider as free", () => {
    // We match the literal domain only; a crafted subdomain is a distinct
    // string and is (correctly) not in the set.
    expect(isFreeEmailProvider("mail.gmail.com")).toBe(false);
    expect(isFreeEmailProvider("corp.outlook.com")).toBe(false);
  });

  it("returns false for empty / whitespace-only input", () => {
    expect(isFreeEmailProvider("")).toBe(false);
    expect(isFreeEmailProvider("   ")).toBe(false);
  });

  it("covers regional Microsoft/Yahoo variants that share open signup", () => {
    expect(isFreeEmailProvider("outlook.co.uk")).toBe(true);
    expect(isFreeEmailProvider("hotmail.fr")).toBe(true);
    expect(isFreeEmailProvider("yahoo.co.jp")).toBe(true);
    expect(isFreeEmailProvider("yahoo.com.br")).toBe(true);
  });

  it("exposes a frozen-by-convention Set with no accidental empty entry", () => {
    expect(FREE_EMAIL_PROVIDER_DOMAINS.has("")).toBe(false);
    // Every entry must already be lowercase, or the lowercasing lookup
    // in isFreeEmailProvider would silently never match it.
    for (const domain of FREE_EMAIL_PROVIDER_DOMAINS) {
      expect(domain).toBe(domain.toLowerCase());
      expect(domain.trim()).toBe(domain);
    }
  });
});
