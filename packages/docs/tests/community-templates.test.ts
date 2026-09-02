import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  communityApps,
  findCommunityApp,
} from "../app/components/community-apps";
import {
  isGitHubRepositoryUrl,
  normalizeHttpUrl,
} from "../app/components/CommunityAppSubmissionForm";

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

  it("uses the Forms upload flow for screenshot uploads", () => {
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
    expect(form).toContain("uploadCommunityScreenshot");
    expect(form).toContain("submitCommunityApp");
    expect(form).toContain("multiple");
    expect(form).toContain("onDrop={handleDrop}");
    expect(form).toContain("removeScreenshot");
    expect(form).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(form).not.toContain("data-netlify");
    expect(form).not.toContain("form-name");
    expect(form).not.toContain("https for you");
    expect(form).not.toContain("Screenshot URLs");
  });

  it("accepts friendly app links and validates GitHub repositories", () => {
    expect(normalizeHttpUrl("example.com")).toBe("https://example.com");
    expect(normalizeHttpUrl(" https://example.com ")).toBe(
      "https://example.com",
    );
    expect(isGitHubRepositoryUrl("github.com/owner/repository")).toBe(true);
    expect(isGitHubRepositoryUrl("https://gitlab.com/owner/repository")).toBe(
      false,
    );
    expect(isGitHubRepositoryUrl("github.com/owner")).toBe(false);
  });

  it("does not declare a Netlify submission form in the route", () => {
    const route = fs.readFileSync(
      path.join(
        repoRoot,
        "packages",
        "docs",
        "app",
        "routes",
        "templates._index.tsx",
      ),
      "utf-8",
    );
    expect(route).not.toContain("Netlify");
    expect(route).not.toContain("data-netlify");
  });
});
