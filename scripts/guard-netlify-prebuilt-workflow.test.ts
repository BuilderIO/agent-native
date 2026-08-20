import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { parse } from "yaml";

import {
  PRODUCTION_SITE_GROUP,
  validateProductionSiteConcurrency,
} from "./guard-netlify-prebuilt-workflow.ts";

type Workflow = Record<string, unknown>;

const readWorkflow = (path: string): Workflow =>
  parse(readFileSync(path, "utf8")) as Workflow;

const workflows = () => ({
  production: readWorkflow(
    ".github/workflows/deploy-production-sites-prebuilt.yml",
  ),
  manage: readWorkflow(".github/workflows/manage-production-sites.yml"),
  promote: readWorkflow(".github/workflows/promote-netlify-deploy.yml"),
});

describe("production Netlify site concurrency guard", () => {
  it("requires the exact shared queue on deploy, manage, and promote jobs", () => {
    assert.deepEqual(validateProductionSiteConcurrency(workflows()), []);
  });

  it("rejects a renamed promote queue even when it still mentions matrix.site", () => {
    const mutated = workflows();
    const promoteJobs = mutated.promote.jobs as Record<string, Workflow>;
    const promote = promoteJobs.promote;
    const concurrency = promote.concurrency as Record<string, unknown>;
    concurrency.group =
      "agent-native-production-promote-job-${{ matrix.site }}";

    const issues = validateProductionSiteConcurrency(mutated);
    assert(
      issues.some((issue) =>
        issue.includes(
          `promote-netlify-deploy.yml promote job concurrency.group must equal ${PRODUCTION_SITE_GROUP}`,
        ),
      ),
    );
  });

  it("rejects a manager job with no per-site concurrency block", () => {
    const mutated = workflows();
    const manageJobs = mutated.manage.jobs as Record<string, Workflow>;
    const manage = manageJobs.manage;
    delete manage.concurrency;

    const issues = validateProductionSiteConcurrency(mutated);
    assert(
      issues.some((issue) =>
        issue.includes(
          `manage-production-sites.yml manage job concurrency.group must equal ${PRODUCTION_SITE_GROUP}`,
        ),
      ),
    );
  });

  it("rejects a production site queue that allows cancellation", () => {
    const mutated = workflows();
    const promoteJobs = mutated.promote.jobs as Record<string, Workflow>;
    const promote = promoteJobs.promote;
    const concurrency = promote.concurrency as Record<string, unknown>;
    concurrency["cancel-in-progress"] = true;

    const issues = validateProductionSiteConcurrency(mutated);
    assert(
      issues.some((issue) =>
        issue.includes(
          "promote-netlify-deploy.yml promote job concurrency.cancel-in-progress must be false",
        ),
      ),
    );
  });
});
