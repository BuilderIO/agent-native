import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { parse } from "yaml";

import { NPM_PUBLISH_PACKAGE_NAMES } from "./changeset-publish-sequential.ts";

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
    assert.match(String(nightly.if), /\[stable-release\]/);
    assert.match(source, /--snapshot nightly/);
    assert.equal(
      (publishStep.env as Workflow).AGENT_NATIVE_NPM_DIST_TAG,
      "nightly",
    );
    assert.doesNotMatch(source, /--snapshot beta/);
    assert.doesNotMatch(source, /AGENT_NATIVE_NPM_DIST_TAG: beta/);
  });

  it("keeps stable releases behind a manual dispatch or marked merge", () => {
    const release = jobs.release as Workflow;
    const condition = String(release.if);
    const notify = jobs["notify-downstream"] as Workflow;

    assert.match(condition, /^!inputs\.redispatchDownstream\s*&&/);
    assert.match(condition, /github\.event_name == 'workflow_dispatch'/);
    assert.match(
      condition,
      /github\.event_name == 'push' && contains\(github\.event\.head_commit\.message, '\[stable-release\]'\)/,
    );
    assert.doesNotMatch(condition, /\$\{\{ !inputs\.redispatchDownstream \}\}/);
    assert.deepEqual(notify.needs, ["release"]);
    assert.match(
      String(notify.if),
      /github\.event_name == 'workflow_dispatch'/,
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
});
