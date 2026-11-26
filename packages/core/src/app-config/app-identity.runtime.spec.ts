import { describe, expect, it } from "vitest";

import { deriveAppIdentity, isFirstPartyApp } from "./app-identity.js";
type App = Parameters<typeof deriveAppIdentity>[0];
describe("application identity runtime", () => {
  it("fills first-party defaults while retaining explicit identity", () => {
    const derived = deriveAppIdentity({ packageName: "mail" } as App);
    expect(derived.name).toBe("Mail");
    expect(derived.slug).toBe("mail");
    expect(derived.description).toBeTruthy();
    const explicit = {
      packageName: "mail",
      name: "Personal inbox",
      slug: "personal",
      description: "My workspace",
    } as App;
    expect(deriveAppIdentity(explicit)).toBe(explicit);
    const partial = deriveAppIdentity({
      packageName: "mail",
      name: "Personal inbox",
    } as App);
    expect(partial.name).toBe("Personal inbox");
    expect(partial.slug).toBe("mail");
  });
  it("does not grant first-party identity to a custom package or a different source", () => {
    const custom = { packageName: "personal-example" } as App;
    expect(deriveAppIdentity(custom)).toBe(custom);
    expect(
      isFirstPartyApp({ packageName: "personal-example", slug: "mail" } as App),
    ).toBe(false);
    expect(
      isFirstPartyApp({
        packageName: "mail",
        slug: "mail",
        sourceTemplate: "chat",
      } as App),
    ).toBe(false);
    expect(
      isFirstPartyApp({
        packageName: "mail",
        slug: "mail",
        sourceTemplate: " MAIL ",
      } as App),
    ).toBe(true);
  });
});
