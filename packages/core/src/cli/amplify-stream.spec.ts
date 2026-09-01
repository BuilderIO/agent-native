import { describe, expect, it } from "vitest";

import {
  isLambdaPermissionCompatible,
  isValidAwsRegion,
  parseAmplifyStreamArgs,
} from "./amplify-stream.js";

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

  it("accepts standard, GovCloud, and ISO AWS regions", () => {
    expect(isValidAwsRegion("us-east-1")).toBe(true);
    expect(isValidAwsRegion("us-gov-west-1")).toBe(true);
    expect(isValidAwsRegion("us-iso-east-1")).toBe(true);
    expect(isValidAwsRegion("eu-isoe-west-1")).toBe(true);
    expect(isValidAwsRegion("us-east")).toBe(false);
  });

  it("only treats the expected public Function URL policy as compatible", () => {
    const statement = {
      Effect: "Allow",
      Principal: "*",
      Action: "lambda:InvokeFunctionUrl",
      Condition: {
        StringEquals: { "lambda:FunctionUrlAuthType": "NONE" },
      },
    };

    expect(
      isLambdaPermissionCompatible(
        statement,
        "lambda:InvokeFunctionUrl",
        "StringEquals",
        "lambda:FunctionUrlAuthType",
        "NONE",
      ),
    ).toBe(true);
    expect(
      isLambdaPermissionCompatible(
        { ...statement, Condition: {} },
        "lambda:InvokeFunctionUrl",
        "StringEquals",
        "lambda:FunctionUrlAuthType",
        "NONE",
      ),
    ).toBe(false);
  });
});
