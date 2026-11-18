import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

// Every repo-backed hosted app opts in to automatic Builder setup by exact
// hostname. Template configs are copied into user projects, so an app-wide
// `builderSignupExperiment: true` there would switch it on for those too.

const sites = JSON.parse(
  readFileSync("scripts/netlify-production-sites.json", "utf8"),
) as Record<string, { host: string; sourceRepo?: string }>;
const knownHosts = JSON.parse(
  readFileSync("scripts/netlify-site-hosts.json", "utf8"),
) as { production: string[]; beta: string[] };

// Deprecated Chat (the user-app scaffold) and the docs site have no hosted
// product signup; `workspace` is built from another repository.
const NOT_HOSTED_SIGNUP = new Set(["starter", "fw"]);

// Labs builds these public-owned apps from this config on its shared origin.
const LABS_HOSTS = [
  "labs.agent-native.com",
  "agent-native-labs-workspace-beta.netlify.app",
];
const LABS_PUBLIC_OWNED = new Set(["design", "clips"]);

const hostedApps = Object.entries(sites)
  .filter(([name, site]) => !site.sourceRepo && !NOT_HOSTED_SIGNUP.has(name))
  .map(([name, site]) => ({ name, host: site.host }));

function onboardingConfig(app: string) {
  const path = `templates/${app}/server/plugins/config.ts`;
  assert.ok(existsSync(path), `${path} is missing`);
  // source-read-ok: the hosted opt-in is a deploy-manifest boundary; this
  // checks each app's declared config against scripts/netlify-*.json.
  const source = readFileSync(path, "utf8");
  const block = /onboarding:\s*\{([\s\S]*?)\n {2}\}/.exec(source)?.[1] ?? "";
  return {
    source,
    hosts: [
      ...(
        /builderSignupHostedHosts:\s*\[([^\]]*)\]/.exec(block)?.[1] ?? ""
      ).matchAll(/"([^"]+)"/g),
    ].map((match) => match[1]),
    percent: Number(
      /builderSignupAutomaticPercent:\s*(\d+)/.exec(block)?.[1] ?? NaN,
    ),
    experimentId: /builderSignupExperimentId:\s*"([^"]+)"/.exec(block)?.[1],
  };
}

describe("hosted automatic Builder setup config", () => {
  it("covers the hosted production inventory", () => {
    assert.deepEqual(hostedApps.map((app) => app.name).sort(), [
      "analytics",
      "assets",
      "brain",
      "calendar",
      "clips",
      "content",
      "crm",
      "design",
      "dispatch",
      "factory",
      "forms",
      "mail",
      "plan",
      "slides",
    ]);
  });

  for (const app of hostedApps) {
    it(`${app.name} opts in only on its hosted hosts, at 100%`, () => {
      const config = onboardingConfig(app.name);
      const beta = `beta.${app.host}`;
      assert.deepEqual(config.hosts, [
        app.host,
        beta,
        ...(LABS_PUBLIC_OWNED.has(app.name) ? LABS_HOSTS : []),
      ]);
      assert.ok(knownHosts.production.includes(app.host));
      assert.ok(knownHosts.beta.includes(beta));
      assert.equal(config.percent, 100);
      assert.doesNotMatch(config.source, /builderSignupExperiment:\s*true/);
    });
  }

  it("keeps a distinct experiment per app, preserving Design's original id", () => {
    const ids = hostedApps.map(
      (app) =>
        onboardingConfig(app.name).experimentId ?? "design_builder_signup_v1",
    );
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(
      onboardingConfig("design").experimentId,
      undefined,
      "Design keeps the default id its existing assignments were issued under",
    );
    assert.equal(
      onboardingConfig("clips").experimentId,
      "clips_builder_signup_v1",
    );
    assert.equal(
      onboardingConfig("slides").experimentId,
      "slides_builder_signup_v1",
    );
  });

  it("leaves the user-app scaffold without an opt-in", () => {
    assert.equal(existsSync("templates/chat/server/plugins/config.ts"), false);
  });
});
