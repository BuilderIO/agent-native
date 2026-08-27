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
    assert.equal(
      options.version,
      "pnpm changeset version && pnpm changelog:compact",
    );
    assert.equal(options["version-script"], undefined);

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
    const changesetsIndex = releaseSteps.indexOf(changesets);
    const consumeIndex = releaseSteps.indexOf(consume);
    const restoreIndex = releaseSteps.indexOf(restore);
    assert(holdIndex < validateIndex);
    assert(holdIndex < changesetsIndex);
    assert(changesetsIndex < consumeIndex);
    assert(consumeIndex < restoreIndex);
    assert(changesetsIndex < restoreIndex);
  });
});
