import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  COMMUNITY_TEMPLATE_SUBMISSION_URL,
  communityTemplateCliCommand,
  communityTemplates,
} from "../app/components/CommunityTemplateCard";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

describe("community templates", () => {
  it("builds the canonical community install command", () => {
    expect(
      communityTemplateCliCommand({
        name: "Example",
        description: "An example template.",
        repository: "acme/example",
      }),
    ).toBe(
      "npx @agent-native/core@latest create my-app --template https://github.com/acme/example",
    );
    expect(
      communityTemplateCliCommand({
        name: "Inbox",
        description: "An app selected from a workspace repository.",
        repository: "acme/workspace",
        app: "inbox",
        ref: "v1.2.0",
      }),
    ).toBe(
      "npx @agent-native/core@latest create my-app --template 'https://github.com/acme/workspace?app=inbox#v1.2.0'",
    );
  });

  it("keeps catalog entries installable and uniquely keyed by repository app", () => {
    const entries = new Set<string>();

    for (const template of communityTemplates) {
      expect(template.repository).toMatch(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/);
      if (template.app) {
        expect(template.app).toMatch(/^[a-z][a-z0-9-]*$/);
        expect(template.app).not.toBe("dispatch");
      }
      if (template.ref) {
        expect(template.ref).not.toContain("..");
      }
      const key = `${template.repository}:${template.app ?? ""}`;
      expect(entries.has(key)).toBe(false);
      entries.add(key);
      expect(template.name.trim()).not.toBe("");
      expect(template.description.trim()).not.toBe("");
      if (template.demoUrl) {
        expect(new URL(template.demoUrl).protocol).toBe("https:");
      }
      if (template.screenshot) {
        expect(new URL(template.screenshot).protocol).toBe("https:");
      }
    }
  });

  it("links the catalog CTA to a checked-in GitHub submission form", () => {
    expect(COMMUNITY_TEMPLATE_SUBMISSION_URL).toContain(
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
    expect(form).toContain("id: repository");
    expect(form).toContain("id: workspace_app");
    expect(form).toContain("id: demo");
    expect(form).toContain("id: readiness");
  });
});
