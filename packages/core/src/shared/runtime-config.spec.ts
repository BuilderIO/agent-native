import { describe, expect, it } from "vitest";

import {
  buildRuntimeConfigPrompt,
  formatRuntimeConfigReport,
  getRuntimeConfigReport,
  parseRuntimeConfigReport,
  runtimeConfigRequirementsFromSearchParams,
} from "./runtime-config.js";

describe("runtime configuration diagnostics", () => {
  it("accepts the framework defaults when production deploy values exist", () => {
    const report = getRuntimeConfigReport(
      {
        NODE_ENV: "production",
        DATABASE_URL: "postgres://db.example/app",
        BETTER_AUTH_SECRET: "a".repeat(64),
      },
      {},
      { phase: "runtime" },
    );

    expect(report).toMatchObject({
      ok: true,
      status: "ok",
      environment: "production",
      issues: [],
    });
  });

  it("reports the auth and database fixes without exposing values", () => {
    const report = getRuntimeConfigReport(
      {
        NODE_ENV: "production",
        AUTH_DISABLED: "true",
        DATABASE_URL: "file:./data/app.db",
      },
      {},
      { phase: "runtime", appName: "chat" },
    );

    expect(report.status).toBe("error");
    expect(report.issues.map((issue) => issue.code)).toEqual([
      "auth-disabled-in-production",
      "missing-auth-secret",
      "local-database-in-production",
    ]);
    expect(report.prompt).toContain("BETTER_AUTH_SECRET");
    expect(report.prompt).not.toContain("file:./data/app.db");
    expect(formatRuntimeConfigReport(report)).toContain(
      "Copy the prompt below to an AI coding agent",
    );
  });

  it("flags production secrets that cannot meet the documented strength", () => {
    const report = getRuntimeConfigReport(
      {
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: "short",
        AGENT_NATIVE_WORKSPACE: "1",
        A2A_SECRET: "also-short",
        DATABASE_URL: "postgres://db.example/app",
      },
      {},
      { phase: "runtime" },
    );

    expect(report.issues.map((issue) => issue.code)).toEqual([
      "weak-auth-secret",
      "weak-a2a-secret",
    ]);
    expect(report.prompt).toContain("openssl rand -hex 32");
  });

  it("uses the workspace A2A secret as the auth fallback", () => {
    const report = getRuntimeConfigReport(
      {
        NODE_ENV: "production",
        AGENT_NATIVE_WORKSPACE: "1",
        A2A_SECRET: "a".repeat(32),
        DATABASE_URL: "postgres://db.example/app",
      },
      {},
      { phase: "build" },
    );

    expect(report).toMatchObject({ ok: true, status: "ok" });
  });

  it("requires the workspace A2A secret even when app auth is disabled", () => {
    const report = getRuntimeConfigReport(
      {
        NODE_ENV: "production",
        AGENT_NATIVE_WORKSPACE: "1",
        DATABASE_URL: "postgres://db.example/app",
      },
      { authEnabled: false },
      { phase: "runtime" },
    );

    expect(report.issues.map((issue) => issue.code)).toEqual([
      "missing-a2a-secret",
    ]);
  });

  it("checks the database independently when an app opts out of auth", () => {
    const report = getRuntimeConfigReport(
      { NODE_ENV: "production" },
      { authEnabled: false, databaseRequired: true },
      { phase: "runtime" },
    );

    expect(report.issues.map((issue) => issue.code)).toEqual([
      "missing-database-url",
    ]);
  });

  it("keeps custom requirements configurable and validates server responses", () => {
    const report = getRuntimeConfigReport(
      { NODE_ENV: "development" },
      {
        authEnabled: false,
        databaseRequired: false,
        requiredEnv: ["NOTION_API_KEY"],
      },
      { phase: "runtime" },
    );

    expect(report.issues).toMatchObject([
      {
        code: "missing-required-env",
        severity: "warning",
        envKeys: ["NOTION_API_KEY"],
      },
    ]);
    expect(parseRuntimeConfigReport(report)).toEqual(report);
    expect(
      parseRuntimeConfigReport({ ...report, issues: "invalid" }),
    ).toBeNull();
    expect(
      parseRuntimeConfigReport({ ...report, ok: true, status: "ok" }),
    ).toBeNull();
    expect(buildRuntimeConfigPrompt(report)).toContain(
      "Do not print secret values",
    );
  });

  it("normalizes redacted probe query requirements", () => {
    expect(
      runtimeConfigRequirementsFromSearchParams(
        new URLSearchParams(
          "auth=0&database=0&requiredEnv=NOTION_API_KEY,bad key,GOOGLE_CLIENT_ID",
        ),
      ),
    ).toEqual({
      authEnabled: false,
      databaseRequired: false,
      requiredEnv: ["NOTION_API_KEY", "GOOGLE_CLIENT_ID"],
    });
  });
});
