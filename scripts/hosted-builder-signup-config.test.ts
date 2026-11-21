import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

const sites = JSON.parse(
  readFileSync("scripts/netlify-production-sites.json", "utf8"),
) as Record<string, { host: string; sourceRepo?: string }>;
const knownHosts = JSON.parse(
  readFileSync("scripts/netlify-site-hosts.json", "utf8"),
) as { production: string[]; beta: string[] };

const NOT_HOSTED_SIGNUP = new Set(["starter", "fw"]);

const LABS_HOSTS = [
  "labs.agent-native.com",
  "agent-native-labs-workspace-beta.netlify.app",
];

const hostedApps = Object.entries(sites)
  .filter(([name, site]) => !site.sourceRepo && !NOT_HOSTED_SIGNUP.has(name))
  .map(([name, site]) => ({ name, host: site.host }));

const signupModules = new Map(
  await Promise.all(
    hostedApps.map(
      async (app) =>
        [
          app.name,
          (await import(
            pathToFileURL(`templates/${app.name}/shared/builder-signup.ts`).href
          )) as {
            BUILDER_SIGNUP_EXPERIMENT_ID: string;
            BUILDER_SIGNUP_HOSTED_HOSTS: string[];
          },
        ] as const,
    ),
  ),
);

// source-read-ok: checks each app's declared hosts and wiring against scripts/netlify-*.json
function read(path: string) {
  assert.ok(existsSync(path), `${path} is missing`);
  return readFileSync(path, "utf8");
}

function onboardingConfig(app: string) {
  const shared = signupModules.get(app);
  assert.ok(shared, `templates/${app}/shared/builder-signup.ts is missing`);
  const config = read(`templates/${app}/server/plugins/config.ts`);
  const root = read(`templates/${app}/app/root.tsx`);
  const block = /onboarding:\s*\{([\s\S]*?)\n {2}\}/.exec(config)?.[1] ?? "";
  return {
    config,
    hosts: shared.BUILDER_SIGNUP_HOSTED_HOSTS,
    percent: Number(
      /builderSignupAutomaticPercent:\s*(\d+)/.exec(block)?.[1] ?? NaN,
    ),
    experimentId: shared.BUILDER_SIGNUP_EXPERIMENT_ID,
    wired:
      /builderSignupHostedHosts: BUILDER_SIGNUP_HOSTED_HOSTS/.test(block) &&
      /builderSignupExperimentId: BUILDER_SIGNUP_EXPERIMENT_ID/.test(block) &&
      /builderSignupExperiment=\{BUILDER_SIGNUP_EXPERIMENT_ID\}/.test(root) &&
      /builderSignupHostedHosts=\{BUILDER_SIGNUP_HOSTED_HOSTS\}/.test(root),
  };
}

void describe("hosted automatic Builder setup config", () => {
  void it("covers the hosted production inventory", () => {
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
    void it(`${app.name} opts in only on its hosted hosts, at 100%`, () => {
      const config = onboardingConfig(app.name);
      const beta = `beta.${app.host}`;
      assert.deepEqual(config.hosts, [app.host, beta]);
      assert.ok(knownHosts.production.includes(app.host));
      assert.ok(knownHosts.beta.includes(beta));
      assert.equal(config.percent, 100);
      assert.ok(config.wired, "server config and root share the hosts and id");
      assert.doesNotMatch(config.config, /builderSignupExperiment:\s*true/);
    });
  }

  void it("never enrolls the Labs origins through a public app", () => {
    for (const app of hostedApps) {
      const { hosts } = onboardingConfig(app.name);
      for (const host of LABS_HOSTS)
        assert.ok(!hosts.includes(host), `${app.name} enrolls ${host}`);
    }
  });

  void it("keeps one experiment per app under its existing id", () => {
    assert.deepEqual(
      hostedApps.map((app) => onboardingConfig(app.name).experimentId),
      hostedApps.map((app) => `${app.name}_builder_signup_v1`),
    );
  });

  void it("leaves the user-app scaffold without an opt-in", () => {
    assert.equal(existsSync("templates/chat/server/plugins/config.ts"), false);
  });
});
