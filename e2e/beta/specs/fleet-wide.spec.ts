import { expect, test } from "@playwright/test";

import { originFor, selectedSites } from "../lib/fleet";
import { mustRespond, parseJson } from "../lib/http";


const sites = selectedSites();

test.describe("fleet-wide auth configuration", () => {
  test("every beta host uses a distinct Google callback", async () => {
    const seen = new Map<string, string>();
    const problems: string[] = [];

    for (const site of sites) {
      const origin = originFor(site);
      const outcome = await mustRespond(
        `${origin}/_agent-native/google/auth-url`,
      );
      if (outcome.status === 404) continue;
      if (outcome.status !== 200) {
        problems.push(
          `${site.id}: auth-url returned HTTP ${outcome.status}: ${outcome.body.slice(0, 160)}`,
        );
        continue;
      }
      const payload = parseJson<{ url?: string }>(outcome, "google auth-url");
      const redirectUri = payload.url
        ? new URL(payload.url).searchParams.get("redirect_uri")
        : null;
      if (!redirectUri) {
        problems.push(`${site.id}: auth-url carried no redirect_uri`);
        continue;
      }
      const owner = seen.get(redirectUri);
      if (owner) {
        problems.push(
          `${site.id} and ${owner} both claim redirect_uri ${redirectUri}`,
        );
      }
      seen.set(redirectUri, site.id);
    }

    expect(problems, problems.join("\n")).toEqual([]);
  });
});
