import { describe, expect, it } from "vitest";

import {
  extensionCapabilityAllows,
  normalizeExtensionAcceptedGrants,
  normalizeExtensionCapabilityManifest,
  type ExtensionCapabilityBinding,
} from "./capability-policy.js";

const manifest = normalizeExtensionCapabilityManifest({
  version: 1,
  appActions: ["save-note", "list-notes"],
  appFetch: [
    {
      path: "/_agent-native/application-state/navigation",
      methods: ["GET", "PUT"],
    },
  ],
  database: { query: true, exec: true },
  extensionData: "write",
  externalFetch: [
    { origin: "https://api.example.com", methods: ["GET", "POST"] },
  ],
})!;

const grants = normalizeExtensionAcceptedGrants(manifest, manifest);
const granted: ExtensionCapabilityBinding = {
  manifestVersion: 1,
  manifestHash: "manifest-hash",
  consented: true,
  grants,
};

const ungranted: ExtensionCapabilityBinding = {
  manifestVersion: 1,
  manifestHash: "manifest-hash",
  consented: false,
  grants: null,
};

describe("extension capability policy", () => {
  it("normalizes exact, versioned manifests and rejects wildcard authority", () => {
    expect(manifest.appActions).toEqual(["list-notes", "save-note"]);
    expect(() =>
      normalizeExtensionCapabilityManifest({ version: 1, appActions: ["*"] }),
    ).toThrow(/exact actions/);
    expect(() =>
      normalizeExtensionCapabilityManifest({
        version: 1,
        externalFetch: [
          { origin: "https://api.example.com/path", methods: ["GET"] },
        ],
      }),
    ).toThrow(/exact HTTPS origins/);
  });

  it("keeps legacy and ungranted extensions read-only and no-egress for every role", () => {
    for (const role of ["owner", "editor", "viewer"] as const) {
      expect(
        extensionCapabilityAllows(ungranted, role, {
          helper: "appAction",
          action: "list-notes",
          readOnly: true,
        }),
      ).toBe(true);
      expect(
        extensionCapabilityAllows(ungranted, role, {
          helper: "appAction",
          action: "save-note",
          readOnly: false,
        }),
      ).toBe(false);
      expect(
        extensionCapabilityAllows(ungranted, role, { helper: "dbQuery" }),
      ).toBe(false);
      expect(
        extensionCapabilityAllows(ungranted, role, {
          helper: "extensionFetch",
          url: "https://api.example.com/notes",
          method: "GET",
        }),
      ).toBe(false);
    }
  });

  it("lets an editor use only accepted actions, SQL, data, and appFetch methods", () => {
    expect(
      extensionCapabilityAllows(granted, "editor", {
        helper: "appAction",
        action: "save-note",
        readOnly: false,
      }),
    ).toBe(true);
    expect(
      extensionCapabilityAllows(granted, "editor", {
        helper: "appAction",
        action: "delete-account",
        readOnly: false,
      }),
    ).toBe(false);
    expect(
      extensionCapabilityAllows(granted, "editor", { helper: "dbQuery" }),
    ).toBe(true);
    expect(
      extensionCapabilityAllows(granted, "editor", { helper: "dbExec" }),
    ).toBe(true);
    expect(
      extensionCapabilityAllows(granted, "editor", {
        helper: "extensionData",
        method: "POST",
      }),
    ).toBe(true);
    expect(
      extensionCapabilityAllows(granted, "editor", {
        helper: "appFetch",
        path: "/_agent-native/application-state/navigation",
        method: "PUT",
      }),
    ).toBe(true);
    expect(
      extensionCapabilityAllows(granted, "editor", {
        helper: "appFetch",
        path: "/_agent-native/application-state/compose",
        method: "GET",
      }),
    ).toBe(false);
  });

  it("retains the viewer write and raw-SQL ceiling even after consent", () => {
    expect(
      extensionCapabilityAllows(granted, "viewer", { helper: "dbQuery" }),
    ).toBe(false);
    expect(
      extensionCapabilityAllows(granted, "viewer", { helper: "dbExec" }),
    ).toBe(false);
    expect(
      extensionCapabilityAllows(granted, "viewer", {
        helper: "appAction",
        action: "save-note",
        readOnly: false,
      }),
    ).toBe(false);
    expect(
      extensionCapabilityAllows(granted, "viewer", {
        helper: "extensionData",
        method: "POST",
      }),
    ).toBe(false);
  });

  it("binds egress to the accepted origin and method", () => {
    expect(
      extensionCapabilityAllows(granted, "viewer", {
        helper: "extensionFetch",
        url: "https://api.example.com/notes?limit=2",
        method: "GET",
      }),
    ).toBe(true);
    expect(
      extensionCapabilityAllows(granted, "viewer", {
        helper: "extensionFetch",
        url: "https://api.example.com/notes",
        method: "DELETE",
      }),
    ).toBe(false);
    expect(
      extensionCapabilityAllows(granted, "viewer", {
        helper: "extensionFetch",
        url: "https://evil.example/collect",
        method: "GET",
      }),
    ).toBe(false);
  });

  it("treats revocation as an immediate return to the legacy floor", () => {
    expect(
      extensionCapabilityAllows({ ...granted, consented: false }, "editor", {
        helper: "extensionFetch",
        url: "https://api.example.com/notes",
        method: "GET",
      }),
    ).toBe(false);
  });

  it("rejects accepted grants that exceed the declaration", () => {
    expect(() =>
      normalizeExtensionAcceptedGrants(
        {
          version: 1,
          externalFetch: [{ origin: "https://evil.example", methods: ["GET"] }],
        },
        manifest,
      ),
    ).toThrow(/exceeds the manifest/);
  });
});
