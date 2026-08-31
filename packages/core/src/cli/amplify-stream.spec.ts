import { describe, expect, it } from "vitest";

import { parseAmplifyStreamArgs } from "./amplify-stream.js";

describe("parseAmplifyStreamArgs", () => {
  it("parses the app, branch, env file, and release options", () => {
    expect(
      parseAmplifyStreamArgs([
        "--amplify-app-id",
        "app-123",
        "--branch",
        "main",
        "--region",
        "us-east-1",
        "--env-file",
        ".env.test",
        "--skip-release",
      ]),
    ).toEqual({
      amplifyAppId: "app-123",
      branch: "main",
      region: "us-east-1",
      envFile: ".env.test",
      skipRelease: true,
    });
  });

  it("requires the Amplify app and branch", () => {
    expect(() => parseAmplifyStreamArgs(["--branch", "main"])).toThrow(
      "--amplify-app-id is required",
    );
    expect(() =>
      parseAmplifyStreamArgs(["--amplify-app-id", "app-123"]),
    ).toThrow("--branch is required");
  });
});
