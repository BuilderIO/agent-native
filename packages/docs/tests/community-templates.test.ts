import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  communityApps,
  findCommunityApp,
} from "../app/components/community-apps";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

describe("community apps", () => {
  it("includes the seeded Nomad listing with a screenshot gallery", () => {
    const nomad = findCommunityApp("nomad");

    expect(nomad).toMatchObject({
      name: "Nomad",
      sourceUrl: "https://github.com/BuilderIO/agent-native/pull/2454",
      status: "new",
    });
    expect(nomad?.screenshots).toHaveLength(3);
    for (const screenshot of nomad?.screenshots ?? []) {
      expect(screenshot).toMatch(/^\/community\/nomad\/.+\.jpg$/);
    }
  });

  it("keeps community slugs unique and URLs reviewable", () => {
    const slugs = new Set<string>();

    for (const app of communityApps) {
      expect(app.slug).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(slugs.has(app.slug)).toBe(false);
      slugs.add(app.slug);
      expect(app.name.trim()).not.toBe("");
      expect(app.description.trim()).not.toBe("");
      for (const screenshot of app.screenshots) {
        expect(screenshot).toMatch(/^(\/|https:\/\/)/);
      }
      for (const url of [app.demoUrl, app.repositoryUrl, app.sourceUrl]) {
        if (url) expect(new URL(url).protocol).toBe("https:");
      }
      if (app.githubStars !== undefined) {
        expect(app.githubStars).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("uses a native multipart form for screenshot uploads", () => {
    const form = fs.readFileSync(
      path.join(
        repoRoot,
        "packages",
        "docs",
        "app",
        "components",
        "CommunityAppSubmissionForm.tsx",
      ),
      "utf-8",
    );
    expect(form).toContain('encType="multipart/form-data"');
    expect(form).toContain('data-netlify="true"');
    expect(form).toContain('name="form-name"');
    expect(form).toContain("multiple");
    expect(form).toContain("onDrop={handleDrop}");
    expect(form).toContain("removeScreenshot");
    expect(form).toContain("typeof DataTransfer");
    expect(form).toContain("ClipboardEvent");
    expect(form).toContain("new DataTransfer()");
    expect(form).toContain("name={field}");
    expect(form).toContain('"screenshot_5"');
    expect(form).not.toContain("Screenshot URLs");
  });
});
