/**
 * Production configuration diagnostics.
 *
 * This module deliberately accepts an env-like record instead of reading
 * process.env so the same rules can run during a Vite build, on the server,
 * and in focused tests without ever exposing secret values to the browser.
 */

/**
 * Stable code for "this deployed server is missing a setting it refuses to
 * run without" — a hosted database or the auth signing secret. The refusal
 * errors carry it and auth responses repeat it, so the sign-in page can show
 * its setup guidance: the page hides any other error text that mentions the
 * database.
 */
export const DEPLOY_SETTINGS_REQUIRED_CODE = "DEPLOY_SETTINGS_REQUIRED";

/**
 * The running server's answer to "which required settings is this deployment
 * missing?", from `getMissingDeploySettings()`. Each field comes from the same
 * check the matching refusal uses.
 */
export interface MissingDeploySettings {
  /**
   * What the database refusal rejects: the env key that resolved to local
   * PGlite, or `"default"` when no database URL is set. Null when allowed.
   */
  databaseSource: string | null;
  /**
   * The key that would let Better Auth start: `BETTER_AUTH_SECRET`, or
   * `A2A_SECRET` in a workspace, which derives the auth secret from it. Null
   * when the auth secret resolves.
   */
  authSecretKey: "BETTER_AUTH_SECRET" | "A2A_SECRET" | null;
  /** True when a deployed workspace has no `A2A_SECRET`. */
  a2aSecretMissing: boolean;
}

export type RuntimeConfigEnvironment = "development" | "production";
export type RuntimeConfigPhase = "build" | "runtime";
export type RuntimeConfigIssueSeverity = "warning" | "error";

export type RuntimeConfigIssueCode =
  | "auth-disabled-in-production"
  | "missing-auth-secret"
  | "weak-auth-secret"
  | "missing-a2a-secret"
  | "weak-a2a-secret"
  | "invalid-auth-url"
  | "missing-database-url"
  | "local-database-in-production"
  | "missing-required-env";

export interface RuntimeConfigRequirements {
  /** Whether the app's default or custom auth layer is expected to run. */
  authEnabled?: boolean;
  /** Whether the app needs a persistent database outside local development. */
  databaseRequired?: boolean;
  /** Additional non-secret keys the app declares as required. */
  requiredEnv?: readonly string[];
}

export interface RuntimeConfigIssue {
  code: RuntimeConfigIssueCode;
  severity: RuntimeConfigIssueSeverity;
  title: string;
  message: string;
  envKeys: string[];
}

export interface RuntimeConfigReport {
  ok: boolean;
  status: "ok" | "warning" | "error";
  environment: RuntimeConfigEnvironment;
  phase: RuntimeConfigPhase;
  issues: RuntimeConfigIssue[];
  prompt: string;
}

export interface RuntimeConfigReportOptions {
  environment?: RuntimeConfigEnvironment;
  phase?: RuntimeConfigPhase;
  appName?: string;
  /**
   * The running server's own answer from `getMissingDeploySettings()`. When
   * given, it replaces the env-name checks for a missing database, auth
   * secret, and workspace `A2A_SECRET` in every environment. Those checks
   * guess from key names and `NODE_ENV`, while the server resolves unpooled
   * and config-level database URLs and the workspace-derived auth secret, and
   * knows whether it is deployed at all. A runtime probe must never fall back
   * to them, or the sign-in banner and the refusals can disagree.
   */
  missingDeploySettings?: MissingDeploySettings;
}

/** Parse the truthy spellings accepted by typed runtime configuration flags. */
export function isTruthyRuntimeValue(
  value: string | boolean | undefined,
): boolean {
  if (value === true) return true;
  return (
    typeof value === "string" &&
    ["1", "true", "yes", "on"].includes(value.trim().toLowerCase())
  );
}

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RUNTIME_CONFIG_ISSUE_CODES = new Set<RuntimeConfigIssueCode>([
  "auth-disabled-in-production",
  "missing-auth-secret",
  "weak-auth-secret",
  "missing-a2a-secret",
  "weak-a2a-secret",
  "invalid-auth-url",
  "missing-database-url",
  "local-database-in-production",
  "missing-required-env",
]);

export function runtimeConfigRequirementsFromSearchParams(
  searchParams: URLSearchParams,
): RuntimeConfigRequirements {
  const requiredEnv = (searchParams.get("requiredEnv") ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter((key) => ENV_KEY_PATTERN.test(key))
    .slice(0, 50);
  return {
    ...(searchParams.get("auth") === "0" ? { authEnabled: false } : {}),
    ...(searchParams.get("database") === "0"
      ? { databaseRequired: false }
      : {}),
    requiredEnv,
  };
}

function valueOf(
  env: Record<string, string | undefined>,
  key: string,
): string | undefined {
  const value = env[key]?.trim();
  return value || undefined;
}

function truthy(value: string | undefined): boolean {
  return isTruthyRuntimeValue(value);
}

function isProductionEnvironment(
  env: Record<string, string | undefined>,
): boolean {
  return (
    valueOf(env, "NODE_ENV") === "production" ||
    valueOf(env, "CONTEXT") === "production" ||
    valueOf(env, "VERCEL_ENV") === "production"
  );
}

function isWorkspaceRuntime(env: Record<string, string | undefined>): boolean {
  return (
    isTruthyRuntimeValue(valueOf(env, "AGENT_NATIVE_WORKSPACE")) ||
    isTruthyRuntimeValue(valueOf(env, "VITE_AGENT_NATIVE_WORKSPACE")) ||
    Boolean(valueOf(env, "AGENT_NATIVE_WORKSPACE_APPS_JSON")) ||
    Boolean(valueOf(env, "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON"))
  );
}

function appEnvPrefix(
  env: Record<string, string | undefined>,
  appName?: string,
): string | undefined {
  const raw = appName ?? valueOf(env, "APP_NAME");
  const prefix = raw?.toUpperCase().replace(/-/g, "_");
  return prefix && ENV_KEY_PATTERN.test(prefix) ? prefix : undefined;
}

function databaseEnvKeys(
  env: Record<string, string | undefined>,
  appName?: string,
): string[] {
  const keys: string[] = [];
  const prefix = appEnvPrefix(env, appName);
  if (prefix) keys.push(`${prefix}_DATABASE_URL`);
  keys.push("DATABASE_URL", "NETLIFY_DATABASE_URL");
  return keys;
}

function configuredKey(
  env: Record<string, string | undefined>,
  keys: readonly string[],
): string | undefined {
  return keys.find((key) => valueOf(env, key));
}

function isLocalDatabaseUrl(url: string): boolean {
  return (
    url === "" ||
    url.startsWith("file:") ||
    url.startsWith("pglite:") ||
    !url.includes("://")
  );
}

function isLoopbackUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return (
      hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
    );
  } catch {
    // coercion-ok: malformed URLs are not loopback; validation reports the config issue.
    return false;
  }
}

function missingDatabaseUrlIssue(
  dbKeys: string[],
): Omit<RuntimeConfigIssue, "severity"> {
  return {
    code: "missing-database-url",
    title: "Production has no persistent database URL",
    message: `Set ${dbKeys.join(", ")} to a persistent Postgres database. Local PGlite is development-only and is not safe for a serverless production deploy.`,
    envKeys: dbKeys,
  };
}

function localDatabaseIssue(
  dbKey: string,
): Omit<RuntimeConfigIssue, "severity"> {
  return {
    code: "local-database-in-production",
    title: "Production is using a local database",
    message: `${dbKey} resolves to a local database. Use a persistent remote SQL URL for deploys so auth and app state survive new instances.`,
    envKeys: [dbKey],
  };
}

function missingAuthSecretIssue(): Omit<RuntimeConfigIssue, "severity"> {
  return {
    code: "missing-auth-secret",
    title: "BETTER_AUTH_SECRET is not set for production",
    message:
      "Set BETTER_AUTH_SECRET in the deployment environment, using a fresh value from `openssl rand -hex 32`. The public auth URL is inferred from APP_URL, known template or request context, and platform metadata such as Netlify or Vercel; AUTH_DISABLED defaults to false, so neither URL nor bypass flag needs to be prefilled.",
    envKeys: ["BETTER_AUTH_SECRET"],
  };
}

function missingA2ASecretIssue(): Omit<RuntimeConfigIssue, "severity"> {
  return {
    code: "missing-a2a-secret",
    title: "The workspace runtime needs A2A_SECRET",
    message:
      "Set A2A_SECRET for trusted internal calls and the workspace's derived auth and OAuth secrets.",
    envKeys: ["A2A_SECRET"],
  };
}

function addIssue(
  issues: RuntimeConfigIssue[],
  issue: Omit<RuntimeConfigIssue, "severity"> & {
    severity?: RuntimeConfigIssueSeverity;
  },
  environment: RuntimeConfigEnvironment,
): void {
  issues.push({
    ...issue,
    severity:
      issue.severity ?? (environment === "production" ? "error" : "warning"),
  });
}

export function buildRuntimeConfigPrompt(
  report: Pick<RuntimeConfigReport, "environment" | "phase" | "issues">,
  appName?: string,
): string {
  const appLine = appName ? `\nApp: ${appName}` : "";
  const issueLines = report.issues
    .map(
      (issue) =>
        `- ${issue.severity.toUpperCase()}: ${issue.title}. ${issue.message}`,
    )
    .join("\n");
  return [
    "Fix this Agent-Native deployment configuration issue.",
    `Environment: ${report.environment}`,
    `Phase: ${report.phase}${appLine}`,
    "",
    "Detected issues:",
    issueLines || "- No issues were reported.",
    "",
    "Inspect the app's agent-native.json or agent-native.config.ts (including compatibility aliases), its deployment configuration, and the framework defaults. Make the smallest safe fix. Keep secrets out of source control. Do not print secret values in your response. Tell me exactly which deploy settings still need to be set, then verify the production build and runtime health check.",
  ].join("\n");
}

export function getRuntimeConfigReport(
  env: Record<string, string | undefined>,
  requirements: RuntimeConfigRequirements = {},
  options: RuntimeConfigReportOptions = {},
): RuntimeConfigReport {
  const environment =
    options.environment ??
    (isProductionEnvironment(env) ? "production" : "development");
  const phase = options.phase ?? "runtime";
  const authEnabled = requirements.authEnabled ?? true;
  const databaseRequired = requirements.databaseRequired ?? true;
  const serverAnswer = options.missingDeploySettings;
  const issues: RuntimeConfigIssue[] = [];

  if (environment === "production") {
    if (authEnabled) {
      if (truthy(valueOf(env, "AUTH_DISABLED"))) {
        addIssue(
          issues,
          {
            code: "auth-disabled-in-production",
            title: "Authentication is disabled in production",
            message:
              "AUTH_DISABLED is enabled. Unset it for a public deployment. Auth is enabled by default, so AUTH_DISABLED=false does not need to be added.",
            envKeys: ["AUTH_DISABLED"],
          },
          environment,
        );
      }

      const authSecret = valueOf(env, "BETTER_AUTH_SECRET");
      const workspaceSecret = valueOf(env, "A2A_SECRET");
      const hasAuthSecret = Boolean(authSecret);
      const hasWorkspaceSecret = Boolean(workspaceSecret);
      if (
        !serverAnswer &&
        !hasAuthSecret &&
        !(isWorkspaceRuntime(env) && hasWorkspaceSecret)
      ) {
        addIssue(issues, missingAuthSecretIssue(), environment);
      }

      if (authSecret && authSecret.length < 32) {
        addIssue(
          issues,
          {
            code: "weak-auth-secret",
            title: "BETTER_AUTH_SECRET is too short",
            message:
              "Use a fresh random BETTER_AUTH_SECRET with at least 32 characters, such as the output of `openssl rand -hex 32`.",
            envKeys: ["BETTER_AUTH_SECRET"],
          },
          environment,
        );
      }

      const explicitAuthUrl =
        valueOf(env, "APP_URL") ?? valueOf(env, "BETTER_AUTH_URL");
      if (explicitAuthUrl) {
        let invalid = false;
        try {
          const parsed = new URL(explicitAuthUrl);
          invalid = !["http:", "https:"].includes(parsed.protocol);
        } catch {
          invalid = true;
        }
        if (isLoopbackUrl(explicitAuthUrl)) invalid = true;
        if (invalid) {
          addIssue(
            issues,
            {
              code: "invalid-auth-url",
              title: "The public auth URL is not deployable",
              message:
                "APP_URL or BETTER_AUTH_URL must be an absolute public http(s) URL. Leave them unset when the platform URL should be inferred.",
              envKeys: ["APP_URL", "BETTER_AUTH_URL"],
            },
            environment,
          );
        }
      }
    }

    const workspaceSecret = valueOf(env, "A2A_SECRET");
    if (!serverAnswer && isWorkspaceRuntime(env) && !workspaceSecret) {
      addIssue(issues, missingA2ASecretIssue(), environment);
    }
    if (
      isWorkspaceRuntime(env) &&
      workspaceSecret &&
      workspaceSecret.length < 32
    ) {
      addIssue(
        issues,
        {
          code: "weak-a2a-secret",
          title: "A2A_SECRET is too short",
          message:
            "Use a fresh random A2A_SECRET with at least 32 characters, such as the output of `openssl rand -hex 32`.",
          envKeys: ["A2A_SECRET"],
        },
        environment,
      );
    }

    if (databaseRequired && !serverAnswer) {
      const dbKeys = databaseEnvKeys(env, options.appName);
      const dbKey = configuredKey(env, dbKeys);
      const dbUrl = dbKey ? valueOf(env, dbKey) : undefined;
      if (!dbUrl) {
        addIssue(issues, missingDatabaseUrlIssue(dbKeys), environment);
      } else if (dbKey && isLocalDatabaseUrl(dbUrl)) {
        addIssue(issues, localDatabaseIssue(dbKey), environment);
      }
    }
  }

  if (serverAnswer) {
    // The server refuses or needs these outright, so each is an error in
    // every environment, including a deploy that never set NODE_ENV.
    const serverIssues: Array<Omit<RuntimeConfigIssue, "severity">> = [];
    const { databaseSource, authSecretKey, a2aSecretMissing } = serverAnswer;
    if (databaseRequired && databaseSource !== null) {
      serverIssues.push(
        databaseSource === "default"
          ? missingDatabaseUrlIssue(databaseEnvKeys(env, options.appName))
          : localDatabaseIssue(databaseSource),
      );
    }
    if (authEnabled && authSecretKey === "BETTER_AUTH_SECRET") {
      serverIssues.push(missingAuthSecretIssue());
    }
    if (a2aSecretMissing || (authEnabled && authSecretKey === "A2A_SECRET")) {
      serverIssues.push(missingA2ASecretIssue());
    }
    for (const issue of serverIssues) {
      addIssue(issues, { ...issue, severity: "error" }, environment);
    }
  }

  for (const key of requirements.requiredEnv ?? []) {
    if (!ENV_KEY_PATTERN.test(key) || valueOf(env, key)) continue;
    addIssue(
      issues,
      {
        code: "missing-required-env",
        title: `${key} is not configured`,
        message: `The app declares ${key} as required. Set it in the local or deployment environment, or remove it from the app configuration if the feature is not used.`,
        envKeys: [key],
      },
      environment,
    );
  }

  const status = issues.some((issue) => issue.severity === "error")
    ? "error"
    : issues.length > 0
      ? "warning"
      : "ok";
  const report = {
    ok: issues.length === 0,
    status,
    environment,
    phase,
    issues,
    prompt: "",
  } satisfies RuntimeConfigReport;
  report.prompt = buildRuntimeConfigPrompt(report, options.appName);
  return report;
}

export function formatRuntimeConfigReport(report: RuntimeConfigReport): string {
  if (report.issues.length === 0) {
    return `[agent-native] ${report.environment} runtime configuration is ready.`;
  }

  const heading =
    report.status === "error"
      ? "configuration errors"
      : "configuration warnings";
  const issueLines = report.issues
    .map(
      (issue) =>
        `  - ${issue.severity.toUpperCase()}: ${issue.title}. ${issue.message}`,
    )
    .join("\n");
  return [
    `[agent-native] ${report.environment} ${heading}:`,
    issueLines,
    "",
    "Copy the prompt below to an AI coding agent for guided remediation:",
    report.prompt,
  ].join("\n");
}

export function parseRuntimeConfigReport(
  value: unknown,
): RuntimeConfigReport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const report = value as Partial<RuntimeConfigReport>;
  if (
    (report.status !== "ok" &&
      report.status !== "warning" &&
      report.status !== "error") ||
    (report.environment !== "development" &&
      report.environment !== "production") ||
    (report.phase !== "build" && report.phase !== "runtime") ||
    !Array.isArray(report.issues) ||
    typeof report.prompt !== "string"
  ) {
    return null;
  }
  const issues = report.issues;
  if (
    typeof report.ok !== "boolean" ||
    !issues.every(
      (issue) =>
        !!issue &&
        typeof issue === "object" &&
        RUNTIME_CONFIG_ISSUE_CODES.has((issue as RuntimeConfigIssue).code) &&
        ((issue as RuntimeConfigIssue).severity === "warning" ||
          (issue as RuntimeConfigIssue).severity === "error") &&
        typeof (issue as RuntimeConfigIssue).title === "string" &&
        typeof (issue as RuntimeConfigIssue).message === "string" &&
        Array.isArray((issue as RuntimeConfigIssue).envKeys) &&
        (issue as RuntimeConfigIssue).envKeys.every(
          (key) => typeof key === "string",
        ),
    )
  ) {
    return null;
  }
  const expectedStatus = issues.some(
    (issue) => (issue as RuntimeConfigIssue).severity === "error",
  )
    ? "error"
    : issues.length > 0
      ? "warning"
      : "ok";
  if (report.ok !== (issues.length === 0) || report.status !== expectedStatus) {
    return null;
  }
  return report as RuntimeConfigReport;
}
