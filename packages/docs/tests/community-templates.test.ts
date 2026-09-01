import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  COMMUNITY_APP_SUBMISSION_URL,
  communityApps,
  findCommunityApp,
} from "../app/components/community-apps";
import { buildCommunitySubmissionUrl } from "../app/components/CommunityAppSubmissionForm";

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

  it("builds a prefilled GitHub issue URL from the submission form", () => {
    const url = new URL(
      buildCommunitySubmissionUrl({
        name: "Example app",
        appUrl: "https://example.com/app",
        description: "A useful community app.",
        repositoryUrl: "https://github.com/acme/example",
        screenshots: "https://example.com/one.png\nhttps://example.com/two.png",
      }),
    );

    expect(url.origin + url.pathname).toBe(
      "https://github.com/BuilderIO/agent-native/issues/new",
    );
    expect(url.searchParams.get("title")).toBe("Community app: Example app");
    expect(url.searchParams.get("body")).toContain(
      "https://example.com/two.png",
    );
  });

  it("keeps a manual GitHub issue form available for reviewers", () => {
    expect(COMMUNITY_APP_SUBMISSION_URL).toContain(
      "template=community-template.yml",
    );

    const form = fs.readFileSync(
      path.join(
        repoRoot,
        ".github",
        "ISSUE_TEMPLATE",
        "community-template.yml",
      ),
      "utf-8",
    );
    expect(form).toContain("id: app_url");
    expect(form).toContain("id: repository");
    expect(form).toContain("id: screenshots");
    expect(form).toContain("id: readiness");
  });
});
