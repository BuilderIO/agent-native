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

  it("offers a no-bump recovery for partial publications", () => {
    assert.deepEqual(inputs.recoverPublication, {
      description:
        "Recovery: publish and tag the versions already in package.json (no version bump)",
      required: false,
      type: "boolean",
      default: false,
    });
    const release = jobs.release as Workflow;
    const createChangeset = (release.steps as Workflow[]).find(
      (step) => step.name === "Create all-package release changeset",
    );
    assert(createChangeset);
    assert.match(String(createChangeset.if), /recoverPublication != true/);
  });

  it("allows npm propagation to settle before failing a publish", () => {
    assert.equal(DEFAULT_NPM_AVAILABILITY_TIMEOUT_MS, 15 * 60_000);
  });
});
