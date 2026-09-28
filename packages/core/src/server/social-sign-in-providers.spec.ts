import { afterEach, describe, expect, it, vi } from "vitest";

import {
  recordActiveSocialSignInProviders,
  resetActiveSocialSignInProviders,
  resolveDeploymentSignInMethods,
} from "./social-sign-in-providers.js";

const SIGN_IN_ENV = [
  "GOOGLE_SIGN_IN_CLIENT_ID",
  "GOOGLE_SIGN_IN_CLIENT_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
];

describe("resolveDeploymentSignInMethods", () => {
  afterEach(() => {
    resetActiveSocialSignInProviders();
    vi.unstubAllEnvs();
  });

  function clearSignInEnv() {
    for (const key of SIGN_IN_ENV) vi.stubEnv(key, "");
  }

  it("reports the providers Better Auth was handed", () => {
    clearSignInEnv();
    recordActiveSocialSignInProviders(["google"]);

    expect(resolveDeploymentSignInMethods()).toEqual({
      emailPassword: true,
      google: true,
      github: false,
    });
  });

  it("prefers what Better Auth wired over the environment", () => {
    vi.stubEnv("GITHUB_CLIENT_ID", "example-github-id");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "example-github-secret");
    recordActiveSocialSignInProviders([]);

    expect(resolveDeploymentSignInMethods().github).toBe(false);
  });

  it("falls back to the credential checks before Better Auth initialises", () => {
    clearSignInEnv();
    vi.stubEnv("GOOGLE_CLIENT_ID", "example-google-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "example-google-secret");

    expect(resolveDeploymentSignInMethods()).toEqual({
      emailPassword: true,
      google: true,
      github: false,
    });
  });

  it("needs both halves of a GitHub pair", () => {
    clearSignInEnv();
    vi.stubEnv("GITHUB_CLIENT_ID", "example-github-id");

    expect(resolveDeploymentSignInMethods().github).toBe(false);
  });
});
