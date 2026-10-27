import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jobs = vi.hoisted(() => ({
  sync: vi.fn(),
  distill: vi.fn(),
}));

vi.mock("../jobs/sync-sources.js", () => ({ default: jobs.sync }));
vi.mock("../jobs/distillation-queue.js", () => ({ default: jobs.distill }));

import registerBrainJobs from "./brain-jobs.js";

describe("Brain interval registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NETLIFY", undefined);
    vi.stubEnv("NETLIFY_LOCAL", undefined);
    vi.stubEnv("SITE_ID", undefined);
    vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", undefined);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RUN_BACKGROUND_JOBS", "1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["NETLIFY", "true"],
    ["SITE_ID", "brain-site-id"],
    ["AWS_LAMBDA_FUNCTION_NAME", "brain-queue-sweep-background"],
    ["AWS_LAMBDA_FUNCTION_NAME", "server-agent-background"],
  ])(
    "does not start intervals when %s identifies a hosted function",
    (key, value) => {
      vi.stubEnv(key, value);

      registerBrainJobs();

      expect(jobs.sync).not.toHaveBeenCalled();
      expect(jobs.distill).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["NETLIFY_LOCAL", "true"],
    ["NETLIFY", "false"],
  ])("honors the explicit local override %s=%s", (key, value) => {
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("SITE_ID", "brain-site-id");
    vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", "local-brain-function");
    vi.stubEnv(key, value);

    registerBrainJobs();

    expect(jobs.sync).toHaveBeenCalledOnce();
    expect(jobs.distill).toHaveBeenCalledOnce();
  });

  it("registers both jobs in a long-lived Node process", () => {
    registerBrainJobs();

    expect(jobs.sync).toHaveBeenCalledOnce();
    expect(jobs.distill).toHaveBeenCalledOnce();
  });
});
