import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { parse } from "yaml";

import {
  DEFAULT_NPM_AVAILABILITY_TIMEOUT_MS,
  NPM_PUBLISH_PACKAGE_NAMES,
} from "./changeset-publish-sequential.ts";

type Workflow = Record<string, unknown>;

const workflow = parse(
  readFileSync(".github/workflows/auto-publish.yml", "utf8"),
) as Workflow;
const trigger = workflow.on as Workflow;
const dispatch = trigger.workflow_dispatch as Workflow;
const inputs = dispatch.inputs as Workflow;
const jobs = workflow.jobs as Workflow;

describe("npm package release workflow", () => {
  it("offers an explicit stable bump with patch as the default", () => {
    assert.deepEqual(inputs.releaseType, {
      description: "Stable release bump for all public npm packages",
      required: true,
      type: "choice",
      options: ["patch", "minor", "major"],
      default: "patch",
    });
  });

  it("publishes nightly snapshots, never beta snapshots or tags", () => {
    const nightly = jobs["publish-nightly"] as Workflow;
    const source = JSON.stringify(nightly);
    const publishStep = (nightly.steps as Workflow[]).find(
      (step) => step.name === "Publish nightly packages sequentially",
    );
    assert(publishStep);

    assert.match(String(nightly.if), /github\.event_name == 'push'/);
    assert.match(
      String(nightly.if),
      /needs\.verify-stable-merge\.outputs\.verified != 'true'/,
    );
    assert.doesNotMatch(
      String(nightly.if),
      /contains\(github\.event\.head_commit\.message/,
    );
    assert.match(source, /--snapshot nightly/);
    assert.equal(
      (publishStep.env as Workflow).AGENT_NATIVE_NPM_DIST_TAG,
      "nightly",
    );
    assert.doesNotMatch(source, /--snapshot beta/);
    assert.doesNotMatch(source, /AGENT_NATIVE_NPM_DIST_TAG: beta/);
  });

  it("rejects a marked ordinary push from the stable lane", () => {
    const verifier = jobs["verify-stable-merge"] as Workflow;
    const release = jobs.release as Workflow;

    assert.doesNotMatch(String(release.if), /head_commit\.message/);
    assert.match(
      String(release.if),
      /needs\.verify-stable-merge\.outputs\.verified == 'true'/,
    );
    assert.match(JSON.stringify(verifier), /stable_marker/);
    assert.match(JSON.stringify(verifier), /ACTOR/);
    assert.match(JSON.stringify(verifier), /commits\/\$SHA\/pulls/);
  });

  it("keeps stable releases behind a manual dispatch or marked merge", () => {
    const verifier = jobs["verify-stable-merge"] as Workflow;
    const verifierSource = JSON.stringify(verifier);
    const release = jobs.release as Workflow;
    const condition = String(release.if);
    const notify = jobs["notify-downstream"] as Workflow;

    assert.match(
      condition,
      /needs\.verify-stable-merge\.outputs\.verified == 'true'/,
    );
    assert.match(verifierSource, /commits\/\$SHA\/pulls/);
    assert.match(verifierSource, /changeset-release\/main/);
    assert.match(verifierSource, /builder-io-integration\[bot\]/);
    assert.match(verifierSource, /merge_commit_sha == \$sha/);
    assert.deepEqual(notify.needs, ["release", "verify-stable-merge"]);
    assert.match(
      String(notify.if),
      /github\.event_name == 'workflow_dispatch'/,
    );
    assert.match(
      String(notify.if),
      /needs\.verify-stable-merge\.outputs\.verified == 'true'/,
    );
  });

  it("uses calculated semver bases for nightly snapshots", () => {
    const config = JSON.parse(
      readFileSync(".changeset/config.json", "utf8"),
    ) as { snapshot?: { useCalculatedVersion?: boolean } };

    assert.equal(config.snapshot?.useCalculatedVersion, true);
  });

  it("keeps the release changeset package list aligned with the publisher", () => {
    const source = readFileSync("scripts/create-release-changeset.ts", "utf8");
    assert.match(source, /NPM_PUBLISH_PACKAGE_NAMES/);
    assert.equal(NPM_PUBLISH_PACKAGE_NAMES.length, 8);
  });

  it("allows npm propagation to settle before failing a publish", () => {
    assert.equal(DEFAULT_NPM_AVAILABILITY_TIMEOUT_MS, 15 * 60_000);
  });

  it("consumes concurrent public changesets after stable publication", () => {
    const release = jobs.release as Workflow;
    const releaseSteps = release.steps as Workflow[];
    const hold = releaseSteps.find(
      (step) => step.name === "Hold pending changesets for stable publication",
    );
    assert(hold);
    const policy = releaseSteps.find(
      (step) => step.name === "Enforce package bump policy",
    );
    assert(policy);
    assert.equal(policy.run, "node scripts/guard-no-major-changeset.mjs");
    assert.match(String(hold.if), /github\.event_name == 'push'/);
    assert.match(JSON.stringify(hold), /RUNNER_TEMP/);
    assert.match(String(hold.run), /changeset status --output/);
    assert.match(JSON.stringify(hold), /README\.md/);
    for (const packageName of NPM_PUBLISH_PACKAGE_NAMES) {
      assert.match(
        String(hold.run),
        new RegExp(packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    }

    const changesets = releaseSteps.find(
      (step) => step.name === "Create stable Release PR or publish to npm",
    );
    assert(changesets);
    const options = changesets.with as Workflow;
    assert.equal(options.version, "pnpm changeset:release-version");
    assert.equal(options["version-script"], undefined);
    const packageScripts = JSON.parse(readFileSync("package.json", "utf8"))
      .scripts as Record<string, string>;
    assert.equal(
      packageScripts["changeset:release-version"],
      "pnpm changeset:version && pnpm changelog:compact",
    );

    const consume = releaseSteps.find(
      (step) => step.name === "Consume concurrent public-package changesets",
    );
    assert(consume);
    assert.match(String(consume.if), /github\.event_name == 'push'/);
    assert.match(String(consume.if), /steps\.changesets\.outcome == 'success'/);
    assert.match(String(consume.run), /git push origin HEAD:main/);
    assert.match(String(consume.run), /main:refs\/remotes\/origin\/main/);
    assert.match(String(consume.run), /git cat-file -e/);
    assert.match(String(consume.run), /\[skip ci\]/);

    const restore = releaseSteps.find(
      (step) => step.name === "Restore pending changesets",
    );
    assert(restore);
    assert.match(String(restore.if), /always\(\)/);
    assert.match(String(restore.run), /consume-stable-changesets\.outcome/);

    const validateIndex = releaseSteps.findIndex(
      (step) => step.name === "Validate changesets",
    );
    const holdIndex = releaseSteps.indexOf(hold);
    const policyIndex = releaseSteps.indexOf(policy);
    const changesetsIndex = releaseSteps.indexOf(changesets);
    const consumeIndex = releaseSteps.indexOf(consume);
    const restoreIndex = releaseSteps.indexOf(restore);
    assert(holdIndex < validateIndex);
    assert(policyIndex < holdIndex);
    assert(holdIndex < changesetsIndex);
    assert(changesetsIndex < consumeIndex);
    assert(consumeIndex < restoreIndex);
    assert(changesetsIndex < restoreIndex);
  });

  describe("dev snapshot publishing", () => {
    const devSnapshot = jobs["publish-dev-snapshot"] as Workflow;

    it("exposes an optional devTag dispatch input, empty by default", () => {
      assert.deepEqual(inputs.devTag, {
        description:
          "Dev snapshot: publish a testable version from this branch under npm dist-tag dev-<value> (leave empty for a normal stable dispatch)",
        required: false,
        type: "string",
        default: "",
      });
    });

    it("only runs on a manual dispatch with a non-empty devTag", () => {
      assert(devSnapshot);
      assert.match(String(devSnapshot.if), /github\.event_name == 'workflow_dispatch'/);
      assert.match(String(devSnapshot.if), /inputs\.devTag != ''/);
      assert.doesNotMatch(String(devSnapshot.if), /needs\.verify-stable-merge/);
      assert.equal(devSnapshot.needs, undefined);
    });

    it("is not gated to main and does not depend on verify-stable-merge", () => {
      assert.equal(workflow.on, trigger);
      // The job itself carries no branch restriction — it runs from
      // whatever branch dispatched the workflow.
      assert.doesNotMatch(JSON.stringify(devSnapshot), /branches/);
    });

    it("validates the tag and synthesizes a changeset before versioning", () => {
      const steps = devSnapshot.steps as Workflow[];
      const prepare = steps.find(
        (step) => step.name === "Validate dev tag and prepare a changeset",
      );
      assert(prepare);
      assert.match(String(prepare.run), /prepare-dev-snapshot\.ts/);

      const version = steps.find(
        (step) => step.name === "Create dev snapshot versions",
      );
      assert(version);
      assert.match(String(version.run), /changeset version --snapshot "\$DEV_TAG"/);

      const prepareIndex = steps.indexOf(prepare);
      const versionIndex = steps.indexOf(version);
      assert(prepareIndex < versionIndex);
    });

    it("publishes under a dev-prefixed dist-tag via the sequential publisher", () => {
      const steps = devSnapshot.steps as Workflow[];
      const publish = steps.find(
        (step) => step.name === "Publish dev snapshot packages sequentially",
      );
      assert(publish);
      assert.equal(publish.id, "publish");
      assert.equal(
        (publish.env as Workflow).AGENT_NATIVE_NPM_DIST_TAG,
        "dev-${{ inputs.devTag }}",
      );
      assert.equal(publish.run, "node scripts/changeset-publish-sequential.ts");
      assert.doesNotMatch(String((publish.env as Workflow).AGENT_NATIVE_NPM_DIST_TAG), /^(latest|nightly)$/);
    });

    it("reuses the npm-publish environment for OIDC trusted publishing", () => {
      assert.equal(devSnapshot.environment, "npm-publish");
      assert.deepEqual(devSnapshot.permissions, {
        contents: "read",
        "id-token": "write",
      });
    });

    it("summarizes using the publish step's actual output, not a directory scan", () => {
      const steps = devSnapshot.steps as Workflow[];
      const summary = steps.find(
        (step) => step.name === "Summarize dev snapshot publish",
      );
      assert(summary);
      assert.equal(
        (summary.env as Workflow).PUBLISHED_PACKAGES,
        "${{ steps.publish.outputs.published-packages }}",
      );
      assert.doesNotMatch(String(summary.run), /readdir|ls packages|find packages/);
    });

    it("has its own concurrency lane keyed by branch and tag", () => {
      const group = String((workflow.concurrency as Workflow).group);
      assert.match(group, /inputs\.devTag/);
      assert.match(group, /format\('dev-\{0\}', inputs\.devTag\)/);
      assert.match(group, /stable-preparation/);
      assert.match(group, /stable-publication/);
    });

    it("gates the stable release job off when devTag is set", () => {
      const release = jobs.release as Workflow;
      assert.match(String(release.if), /!inputs\.devTag/);
    });

    it("excludes dev snapshot dispatches from downstream notification", () => {
      const notify = jobs["notify-downstream"] as Workflow;
      assert.match(String(notify.if), /!inputs\.devTag/);
    });
  });
});
