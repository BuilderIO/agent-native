// The GitHub tracker for fragility-common's findings scripts: gh auth, write
// access to the repo, and the label.
import { commonConfig } from "../../fragility-common/lib/cli.ts";
import type { Check } from "../../fragility-common/lib/doctor.ts";
import type { Tracker } from "../../fragility-common/lib/findings.ts";
import { gh, GitHubIssues, loadGitHubConfig, parseIssueKey } from "./github.ts";

export function createTracker(): Tracker {
  return new GitHubIssues();
}

export function ticketUrl(key: string): string {
  return `https://github.com/${commonConfig().repo}/issues/${key.replace(/^#/, "")}`;
}

export const parseKey = parseIssueKey;

export function doctorChecks(): Check[] {
  const { repo } = commonConfig();
  const { label } = loadGitHubConfig();
  return [
    {
      name: "github-auth",
      run: () => `authenticated as ${gh(["user", "--jq", ".login"]).trim()}`,
    },
    {
      name: "github-issues-access",
      run: () => {
        const out = gh([
          `repos/${repo}`,
          "--jq",
          "[.has_issues, (.permissions.triage // false), (.permissions.push // false)] | @csv",
        ]).trim();
        const [hasIssues, triage, push] = out.split(",");
        if (hasIssues !== "true")
          throw new Error(`${repo} has issues turned off`);
        if (triage !== "true" && push !== "true")
          throw new Error(
            `this token can't label or close issues in ${repo} (needs triage or write)`,
          );
        return `can file and label issues in ${repo}`;
      },
    },
    {
      name: "github-label",
      run: () => {
        try {
          gh([`repos/${repo}/labels/${encodeURIComponent(label)}`, "--silent"]);
        } catch (error) {
          if (/HTTP 404/.test((error as Error).message))
            throw new Error(
              `label ${label} doesn't exist; create it with: gh label create ${label} -R ${repo} --description "Fragile-systems refactor plans"`,
            );
          throw error;
        }
        return `label ${label} exists in ${repo}`;
      },
    },
  ];
}
