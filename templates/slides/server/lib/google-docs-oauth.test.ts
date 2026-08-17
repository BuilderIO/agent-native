import { describe, expect, it } from "vitest";

import {
  GOOGLE_DOCS_SCOPES,
  GOOGLE_DRIVE_READONLY_SCOPE,
  hasGoogleDriveExportScope,
} from "./google-docs-oauth.js";

describe("Google Slides URL import OAuth scopes", () => {
  it("requests Drive read access for pasted presentation links", () => {
    expect(GOOGLE_DOCS_SCOPES).toContain(GOOGLE_DRIVE_READONLY_SCOPE);
  });

  it("recognizes export-capable Drive grants", () => {
    expect(hasGoogleDriveExportScope(GOOGLE_DRIVE_READONLY_SCOPE)).toBe(true);
    expect(
      hasGoogleDriveExportScope("https://www.googleapis.com/auth/drive"),
    ).toBe(true);
    expect(
      hasGoogleDriveExportScope("https://www.googleapis.com/auth/drive.file"),
    ).toBe(false);
    expect(hasGoogleDriveExportScope()).toBe(false);
  });
});
