import { defineAppConfig } from "@agent-native/core/server";
import { afterEach, expect, it, vi } from "vitest";

import { CONTRACT_VERSION } from "../shared/kernel-contract.js";
import action from "./list-environment-packages.js";

vi.mock(import("../server/model/environment-packages.js"), async (load) => ({
  ...(await load()),
  listEnvironmentPackages: async () => ({
    runtime: "Pyodide",
    runtimeVersion: "3.14.2",
    packages: [{ name: "pandas", version: "3.0.2" }],
  }),
}));

const ctx = { userEmail: "reader@example.test" } as never;

afterEach(() => {
  defineAppConfig({});
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("reports the pinned hosted kernel's packages when hosted execution is configured", async () => {
  const url = "http://127.0.0.1:8765/hosts/fixture";
  defineAppConfig({
    analyticsKernel: {
      hosts: JSON.stringify([
        {
          commandUrl: url,
          eventUrl: url,
          sha: "development",
          digest: "development",
        },
      ]),
      keyId: "fixture",
    },
  });
  vi.stubEnv(
    "ANALYTICS_KERNEL_KEYS",
    JSON.stringify({ fixture: "fake-signing-key-for-environment-tests" }),
  );
  const report = {
    runtime: "CPython",
    runtimeVersion: "3.14.2",
    packages: [{ name: "duckdb", version: "2.0.0" }],
  };
  const fetch = vi.fn(async (address: string, init: RequestInit) => {
    if (address === `${url}/healthz`)
      return Response.json({
        hostId: "fixture-host",
        protocolVersion: CONTRACT_VERSION,
        sha: "development",
        digest: "development",
        cordoned: false,
        active: 0,
        queued: 0,
        resident: 0,
      });
    expect(address).toBe(`${url}/v1/environment`);
    expect(new Headers(init.headers).get("Authorization")).toMatch(/^Bearer /);
    return Response.json(report);
  });
  vi.stubGlobal("fetch", fetch);

  await expect(action.run({}, ctx)).resolves.toEqual(report);
  expect(fetch).toHaveBeenCalledTimes(2);
});
