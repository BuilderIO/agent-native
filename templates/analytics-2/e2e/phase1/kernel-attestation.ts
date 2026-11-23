import { expect } from "@playwright/test";
import { z } from "zod";

import { CONTRACT_VERSION } from "../../shared/kernel-contract.js";
import type { FlowContext } from "./runtime.js";

const loopback = ["localhost", "127.0.0.1", "[::1]"];

export function validateExpectedKernelDigest(digest: string, base: URL) {
  if (/^sha256:[a-f0-9]{64}$/.test(digest)) return;
  if (digest === "development" && loopback.includes(base.hostname)) return;
  throw new Error(
    "Expected a kernel SHA-256 digest or development on loopback",
  );
}

export async function attestKernel(
  flow: Pick<
    FlowContext,
    | "action"
    | "baseUrl"
    | "expectedKernelDigest"
    | "expectedSha"
    | "id"
    | "unavailable"
  >,
) {
  const digest = flow.expectedKernelDigest;
  if (!digest)
    return flow.unavailable(
      "Kernel attestation requires --expected-kernel-digest",
    );
  validateExpectedKernelDigest(digest, new URL(flow.baseUrl));
  const deployment = z
    .object({
      appBuildSha: z.literal(flow.expectedSha),
      protocolVersion: z.literal(CONTRACT_VERSION),
      builds: z
        .array(z.object({ sha: z.string().min(1), digest: z.string().min(1) }))
        .min(1),
      developmentAttested: z.literal(true).optional(),
    })
    .parse(await flow.action("get-notebook-kernel-build"));
  expect([...new Set(deployment.builds.map((build) => build.digest))]).toEqual([
    digest,
  ]);
  if (digest === "development") {
    expect(deployment.developmentAttested).toBe(true);
    expect([...new Set(deployment.builds.map(({ sha }) => sha))]).toEqual([
      "development",
    ]);
    flow.id("kernelAttestation", "dev-attested");
  } else {
    flow.id("kernelAttestation", "pinned");
    flow.id("kernelImageDigest", digest);
  }
}
