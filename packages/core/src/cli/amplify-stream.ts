import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AGENT_CHAT_STREAM_PATH } from "../server/agent-chat-stream.js";

const LAMBDA_RUNTIME = "nodejs24.x";
const LAMBDA_TIMEOUT_SECONDS = 900;
const LAMBDA_MEMORY_MB = 1024;
const STREAM_URL_ENV_KEY = "VITE_AGENT_NATIVE_AGENT_CHAT_STREAM_URL";
const STREAM_RUNTIME_ENV_KEY = "AGENT_NATIVE_AGENT_CHAT_STREAM_RUNTIME";
const MAX_LAMBDA_ZIP_BYTES = 50 * 1024 * 1024;

export interface AmplifyStreamOptions {
  amplifyAppId: string;
  branch: string;
  region?: string;
  functionName?: string;
  roleName?: string;
  envFile?: string;
  projectCwd?: string;
  skipRelease?: boolean;
}

type ParsedAmplifyStreamArgs = AmplifyStreamOptions | { help: true };

class AwsCliError extends Error {
  constructor(
    readonly action: string,
    message: string,
  ) {
    super(message);
    this.name = "AwsCliError";
  }
}

function requiredValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1]?.trim();
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseAmplifyStreamArgs(
  argv: string[],
): ParsedAmplifyStreamArgs {
  const options: Partial<AmplifyStreamOptions> = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--skip-release") {
      options.skipRelease = true;
      continue;
    }
    const valueFlags: Record<string, keyof AmplifyStreamOptions> = {
      "--amplify-app-id": "amplifyAppId",
      "--branch": "branch",
      "--region": "region",
      "--function-name": "functionName",
      "--role-name": "roleName",
      "--env-file": "envFile",
      "--project-cwd": "projectCwd",
    };
    const key = valueFlags[arg];
    if (!key) throw new Error(`Unknown amplify-stream option: ${arg}`);
    options[key] = requiredValue(argv, index, arg);
    index++;
  }

  if (!options.amplifyAppId) {
    throw new Error("--amplify-app-id is required");
  }
  if (!options.branch) throw new Error("--branch is required");
  return {
    amplifyAppId: options.amplifyAppId,
    branch: options.branch,
    ...(options.region ? { region: options.region } : {}),
    ...(options.functionName ? { functionName: options.functionName } : {}),
    ...(options.roleName ? { roleName: options.roleName } : {}),
    ...(options.envFile ? { envFile: options.envFile } : {}),
    ...(options.projectCwd ? { projectCwd: options.projectCwd } : {}),
    ...(options.skipRelease ? { skipRelease: true } : {}),
  };
}

function parseDotEnv(source: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [lineNumber, rawLine] of source
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = rawLine.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/,
    );
    if (!match) {
      throw new Error(
        `Invalid environment assignment on line ${lineNumber + 1}`,
      );
    }
    let value = match[2].trim();
    if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    } else if (value.startsWith('"')) {
      try {
        const parsed = JSON.parse(value);
        if (typeof parsed !== "string") throw new Error("not a string");
        value = parsed;
      } catch {
        throw new Error(
          `Invalid quoted environment value on line ${lineNumber + 1}`,
        );
      }
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values[match[1]] = value;
  }
  return values;
}

function readProjectEnv(
  projectCwd: string,
  envFile: string | undefined,
): Record<string, string> {
  const resolved = envFile
    ? path.resolve(projectCwd, envFile)
    : path.join(projectCwd, ".env");
  if (!fs.existsSync(resolved)) {
    if (envFile) throw new Error(`Environment file not found: ${resolved}`);
    return {};
  }
  return parseDotEnv(fs.readFileSync(resolved, "utf8"));
}

function awsOutput(args: string[], region?: string): string {
  const finalArgs = region ? ["--region", region, ...args] : args;
  const action = args.slice(0, 2).join(" ");
  try {
    return execFileSync("aws", finalArgs, {
      encoding: "utf8",
      env: { ...process.env, AWS_PAGER: "", AWS_CLI_AUTO_PROMPT: "off" },
      maxBuffer: 20 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr?: unknown }).stderr ?? "").trim()
        : "";
    const stdout =
      error && typeof error === "object" && "stdout" in error
        ? String((error as { stdout?: unknown }).stdout ?? "").trim()
        : "";
    throw new AwsCliError(action, stderr || stdout || "AWS CLI command failed");
  }
}

function awsText(args: string[], region?: string): string {
  return awsOutput([...args, "--output", "text"], region).trim();
}

function awsJson<T>(args: string[], region?: string): T {
  return JSON.parse(awsOutput([...args, "--output", "json"], region)) as T;
}

function isAwsNotFound(error: unknown): boolean {
  return (
    error instanceof AwsCliError &&
    /ResourceNotFoundException|NoSuchEntity|does not exist/i.test(error.message)
  );
}

function isAwsConflict(error: unknown): boolean {
  return (
    error instanceof AwsCliError &&
    /ResourceConflictException/i.test(error.message)
  );
}

export function isValidAwsRegion(region: string): boolean {
  return /^[a-z]{2,}(?:-[a-z0-9]+)+-\d+$/.test(region);
}

type LambdaPolicyStatement = {
  Sid?: unknown;
  Effect?: unknown;
  Principal?: unknown;
  Action?: unknown;
  Condition?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasPolicyValue(value: unknown, expected: string): boolean {
  return (
    value === expected || (Array.isArray(value) && value.includes(expected))
  );
}

export function isLambdaPermissionCompatible(
  statement: unknown,
  action: string,
  conditionOperator: string,
  conditionKey: string,
  conditionValue: string,
): statement is LambdaPolicyStatement {
  if (!isRecord(statement)) return false;
  const principal = statement.Principal;
  const principalIsPublic =
    principal === "*" || (isRecord(principal) && principal.AWS === "*");
  const condition = isRecord(statement.Condition)
    ? statement.Condition[conditionOperator]
    : undefined;
  return (
    statement.Effect === "Allow" &&
    principalIsPublic &&
    hasPolicyValue(statement.Action, action) &&
    isRecord(condition) &&
    condition[conditionKey] === conditionValue
  );
}

function sanitizeResourceName(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 64)
    .replace(/[-_]+$/g, "");
  if (!normalized) throw new Error("Could not derive an AWS resource name");
  return normalized;
}

function defaultResourceNames(projectCwd: string): {
  functionName: string;
  roleName: string;
} {
  let packageName = path.basename(projectCwd);
  const packagePath = path.join(projectCwd, "package.json");
  if (fs.existsSync(packagePath)) {
    const manifest = JSON.parse(fs.readFileSync(packagePath, "utf8")) as {
      name?: unknown;
    };
    if (typeof manifest.name === "string" && manifest.name.trim()) {
      packageName = manifest.name;
    }
  }
  const base = sanitizeResourceName(packageName.replace(/^@[^/]+\//, ""));
  const functionName = sanitizeResourceName(`${base}-agent-chat-stream`);
  return {
    functionName,
    roleName: sanitizeResourceName(`${functionName}-role`),
  };
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function ensureLambdaRole(
  roleName: string,
  region: string,
): Promise<string> {
  let roleArn: string | undefined;
  try {
    roleArn = awsText(
      ["iam", "get-role", "--role-name", roleName, "--query", "Role.Arn"],
      region,
    );
  } catch (error) {
    if (!isAwsNotFound(error)) throw error;
  }

  if (!roleArn || roleArn === "None") {
    const trustPolicy = JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { Service: "lambda.amazonaws.com" },
          Action: "sts:AssumeRole",
        },
      ],
    });
    try {
      roleArn = awsText(
        [
          "iam",
          "create-role",
          "--role-name",
          roleName,
          "--assume-role-policy-document",
          trustPolicy,
          "--query",
          "Role.Arn",
        ],
        region,
      );
    } catch (error) {
      if (!isAwsConflict(error)) throw error;
      roleArn = awsText(
        ["iam", "get-role", "--role-name", roleName, "--query", "Role.Arn"],
        region,
      );
    }
  }

  awsOutput(
    [
      "iam",
      "attach-role-policy",
      "--role-name",
      roleName,
      "--policy-arn",
      "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
    ],
    region,
  );

  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const currentArn = awsText(
        ["iam", "get-role", "--role-name", roleName, "--query", "Role.Arn"],
        region,
      );
      if (currentArn && currentArn !== "None") return currentArn;
    } catch (error) {
      if (!isAwsNotFound(error)) throw error;
    }
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for IAM role ${roleName}`);
}

async function waitForLambda(
  functionName: string,
  region: string,
): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const status = awsJson<{ state?: string; lastUpdateStatus?: string }>(
      [
        "lambda",
        "get-function-configuration",
        "--function-name",
        functionName,
        "--query",
        "{state:State,lastUpdateStatus:LastUpdateStatus}",
      ],
      region,
    );
    if (
      status.state === "Active" &&
      (!status.lastUpdateStatus || status.lastUpdateStatus === "Successful")
    ) {
      return;
    }
    if (status.state === "Failed" || status.lastUpdateStatus === "Failed") {
      throw new Error(
        `Lambda function ${functionName} failed to become active`,
      );
    }
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for Lambda function ${functionName}`);
}

function zipServerBundle(serverDir: string): {
  archivePath: string;
  cleanup: () => void;
} {
  for (const required of ["index.mjs", "server.js", ".env"]) {
    if (!fs.existsSync(path.join(serverDir, required))) {
      throw new Error(`Nitro AWS Lambda output is missing ${required}`);
    }
  }
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "agent-native-amplify-stream-"),
  );
  const archivePath = path.join(tempDir, "function.zip");
  try {
    execFileSync("zip", ["-qr", archivePath, "."], {
      cwd: serverDir,
      stdio: "inherit",
    });
    const size = fs.statSync(archivePath).size;
    if (size > MAX_LAMBDA_ZIP_BYTES) {
      throw new Error(
        `Lambda zip is ${size} bytes; this CLI currently supports the 50 MB direct-upload limit`,
      );
    }
    return {
      archivePath,
      cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }),
    };
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

async function ensureLambdaFunction(
  functionName: string,
  roleArn: string,
  archivePath: string,
  region: string,
): Promise<void> {
  let exists = false;
  try {
    awsText(
      [
        "lambda",
        "get-function",
        "--function-name",
        functionName,
        "--query",
        "Configuration.FunctionArn",
      ],
      region,
    );
    exists = true;
  } catch (error) {
    if (!isAwsNotFound(error)) throw error;
  }

  if (exists) {
    awsOutput(
      [
        "lambda",
        "update-function-code",
        "--function-name",
        functionName,
        "--zip-file",
        `fileb://${archivePath}`,
        "--publish",
      ],
      region,
    );
    await waitForLambda(functionName, region);
    awsOutput(
      [
        "lambda",
        "update-function-configuration",
        "--function-name",
        functionName,
        "--runtime",
        LAMBDA_RUNTIME,
        "--role",
        roleArn,
        "--handler",
        "server.handler",
        "--timeout",
        String(LAMBDA_TIMEOUT_SECONDS),
        "--memory-size",
        String(LAMBDA_MEMORY_MB),
      ],
      region,
    );
    // Lambda applies configuration asynchronously. Function URL mutations
    // must wait for this update or AWS can return ResourceConflictException.
    await waitForLambda(functionName, region);
  } else {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        awsOutput(
          [
            "lambda",
            "create-function",
            "--function-name",
            functionName,
            "--runtime",
            LAMBDA_RUNTIME,
            "--role",
            roleArn,
            "--handler",
            "server.handler",
            "--timeout",
            String(LAMBDA_TIMEOUT_SECONDS),
            "--memory-size",
            String(LAMBDA_MEMORY_MB),
            "--zip-file",
            `fileb://${archivePath}`,
          ],
          region,
        );
        break;
      } catch (error) {
        if (
          !(
            error instanceof AwsCliError &&
            /role defined for the function cannot be assumed by Lambda/i.test(
              error.message,
            )
          ) ||
          attempt === 5
        ) {
          throw error;
        }
        await sleep(5000);
      }
    }
    await waitForLambda(functionName, region);
  }
}

const FUNCTION_URL_CORS = JSON.stringify({
  AllowCredentials: false,
  AllowHeaders: [
    "accept",
    "authorization",
    "cache-control",
    "content-type",
    "x-agent-native-client-platform",
    "x-agent-native-hosted-harness",
    "x-agent-native-session-id",
    "x-agent-native-surface",
    "x-user-timezone",
  ],
  AllowMethods: ["POST"],
  AllowOrigins: ["*"],
  ExposeHeaders: ["x-dispatch-mode", "x-run-id"],
  MaxAge: 600,
});

const FUNCTION_URL_PERMISSIONS = [
  {
    statementId: "FunctionURLAllowPublicAccess",
    action: "lambda:InvokeFunctionUrl",
    conditionOperator: "StringEquals",
    conditionKey: "lambda:FunctionUrlAuthType",
    conditionValue: "NONE",
    cliCondition: ["--function-url-auth-type", "NONE"],
  },
  {
    statementId: "FunctionURLInvokeFunction",
    action: "lambda:InvokeFunction",
    conditionOperator: "Bool",
    conditionKey: "lambda:InvokedViaFunctionUrl",
    conditionValue: "true",
    cliCondition: ["--invoked-via-function-url"],
  },
] as const;

async function getLambdaPolicyStatements(
  functionName: string,
  region: string,
): Promise<LambdaPolicyStatement[]> {
  let response: { Policy?: unknown };
  try {
    response = awsJson<{ Policy?: unknown }>(
      ["lambda", "get-policy", "--function-name", functionName],
      region,
    );
  } catch (error) {
    if (isAwsNotFound(error)) return [];
    throw error;
  }
  if (typeof response.Policy !== "string") {
    throw new Error(
      `Lambda policy for ${functionName} is missing its JSON policy`,
    );
  }
  const policy = JSON.parse(response.Policy) as unknown;
  if (!isRecord(policy)) {
    throw new Error(`Lambda policy for ${functionName} is not an object`);
  }
  const rawStatements = Array.isArray(policy.Statement)
    ? policy.Statement
    : [policy.Statement];
  if (!rawStatements.every(isRecord)) {
    throw new Error(`Lambda policy for ${functionName} has invalid statements`);
  }
  return rawStatements;
}

async function ensureLambdaPermission(
  functionName: string,
  region: string,
  permission: (typeof FUNCTION_URL_PERMISSIONS)[number],
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const statements = await getLambdaPolicyStatements(functionName, region);
    const existing = statements.find(
      (statement) => statement.Sid === permission.statementId,
    );
    if (
      existing &&
      isLambdaPermissionCompatible(
        existing,
        permission.action,
        permission.conditionOperator,
        permission.conditionKey,
        permission.conditionValue,
      )
    ) {
      return;
    }

    if (existing) {
      awsOutput(
        [
          "lambda",
          "remove-permission",
          "--function-name",
          functionName,
          "--statement-id",
          permission.statementId,
        ],
        region,
      );
    }

    try {
      awsOutput(
        [
          "lambda",
          "add-permission",
          "--function-name",
          functionName,
          "--statement-id",
          permission.statementId,
          "--action",
          permission.action,
          "--principal",
          "*",
          ...permission.cliCondition,
        ],
        region,
      );
    } catch (error) {
      if (!isAwsConflict(error) || attempt === 1) throw error;
    }
  }

  const statements = await getLambdaPolicyStatements(functionName, region);
  const statement = statements.find(
    (candidate) => candidate.Sid === permission.statementId,
  );
  if (
    !isLambdaPermissionCompatible(
      statement,
      permission.action,
      permission.conditionOperator,
      permission.conditionKey,
      permission.conditionValue,
    )
  ) {
    throw new Error(
      `Lambda permission ${permission.statementId} is not configured for a public Function URL`,
    );
  }
}

async function ensureFunctionUrl(
  functionName: string,
  region: string,
): Promise<string> {
  let configured = false;
  try {
    awsText(
      [
        "lambda",
        "get-function-url-config",
        "--function-name",
        functionName,
        "--query",
        "FunctionUrl",
      ],
      region,
    );
    configured = true;
  } catch (error) {
    if (!isAwsNotFound(error)) throw error;
  }

  const command = configured
    ? "update-function-url-config"
    : "create-function-url-config";
  awsOutput(
    [
      "lambda",
      command,
      "--function-name",
      functionName,
      "--auth-type",
      "NONE",
      "--invoke-mode",
      "RESPONSE_STREAM",
      "--cors",
      FUNCTION_URL_CORS,
    ],
    region,
  );

  for (const permission of FUNCTION_URL_PERMISSIONS) {
    await ensureLambdaPermission(functionName, region, permission);
  }

  return awsText(
    [
      "lambda",
      "get-function-url-config",
      "--function-name",
      functionName,
      "--query",
      "FunctionUrl",
    ],
    region,
  );
}

function updateAmplifyBranchEnvironment(
  appId: string,
  branch: string,
  streamUrl: string,
  region: string,
): { webUrl?: string } {
  const response = awsJson<{
    branch?: {
      environmentVariables?: Record<string, string>;
      webUrl?: string;
    };
  }>(
    ["amplify", "get-branch", "--app-id", appId, "--branch-name", branch],
    region,
  );
  const environmentVariables = {
    ...(response.branch?.environmentVariables ?? {}),
    [STREAM_URL_ENV_KEY]: streamUrl,
  };
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "agent-native-amplify-env-"),
  );
  const envPath = path.join(tempDir, "environment-variables.json");
  try {
    fs.writeFileSync(envPath, JSON.stringify(environmentVariables), {
      encoding: "utf8",
      mode: 0o600,
    });
    awsOutput(
      [
        "amplify",
        "update-branch",
        "--app-id",
        appId,
        "--branch-name",
        branch,
        "--environment-variables",
        `file://${envPath}`,
      ],
      region,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  return {
    ...(response.branch?.webUrl ? { webUrl: response.branch.webUrl } : {}),
  };
}

async function waitForAmplifyRelease(
  appId: string,
  branch: string,
  jobId: string,
  region: string,
): Promise<void> {
  const terminalFailures = new Set([
    "FAILED",
    "CANCELLED",
    "CANCELLING",
    "REJECTED",
  ]);
  for (let attempt = 0; attempt < 90; attempt++) {
    const status = awsText(
      [
        "amplify",
        "get-job",
        "--app-id",
        appId,
        "--branch-name",
        branch,
        "--job-id",
        jobId,
        "--query",
        "job.summary.status",
      ],
      region,
    );
    if (status === "SUCCEED") return;
    if (terminalFailures.has(status)) {
      throw new Error(`Amplify release ${jobId} ended with status ${status}`);
    }
    await sleep(10_000);
  }
  throw new Error(`Timed out waiting for Amplify release ${jobId}`);
}

function buildLambda(
  projectCwd: string,
  projectEnv: Record<string, string>,
): void {
  const buildEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...projectEnv,
    NODE_ENV: "production",
    NITRO_PRESET: "aws-lambda",
    [STREAM_RUNTIME_ENV_KEY]: "1",
  };
  execFileSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["build"], {
    cwd: projectCwd,
    env: buildEnv,
    stdio: "inherit",
  });
}

export async function runAmplifyStream(argv: string[]): Promise<void> {
  const parsed = parseAmplifyStreamArgs(argv);
  if ("help" in parsed) {
    console.log(`Usage: agent-native amplify-stream --amplify-app-id <id> --branch <name> [options]

Build a Nitro AWS Lambda response-streaming Function URL and connect it to an
AWS Amplify branch. Run this command from the app directory.

Options:
  --region <region>           AWS region (or AWS_REGION/AWS_DEFAULT_REGION)
  --function-name <name>      Lambda name (default: <app>-agent-chat-stream)
  --role-name <name>          IAM role name (default: <function>-role)
  --env-file <path>           Build env file (default: .env)
  --project-cwd <path>        App directory (default: current directory)
  --skip-release              Update the branch env without starting a release
`);
    return;
  }

  const projectCwd = path.resolve(parsed.projectCwd ?? process.cwd());
  const projectEnv = readProjectEnv(projectCwd, parsed.envFile);
  const region =
    parsed.region ??
    projectEnv.AWS_REGION ??
    projectEnv.AWS_DEFAULT_REGION ??
    process.env.AWS_REGION ??
    process.env.AWS_DEFAULT_REGION;
  if (!region) {
    throw new Error(
      "AWS region is required; pass --region or set AWS_REGION/AWS_DEFAULT_REGION",
    );
  }
  if (!isValidAwsRegion(region)) {
    throw new Error(`Invalid AWS region: ${region}`);
  }

  const accountId = awsText(
    ["sts", "get-caller-identity", "--query", "Account"],
    region,
  );
  if (!/^\d{12}$/.test(accountId)) {
    throw new Error("AWS CLI did not return a valid account identity");
  }

  const defaults = defaultResourceNames(projectCwd);
  const functionName = sanitizeResourceName(
    parsed.functionName ?? defaults.functionName,
  );
  const roleName = sanitizeResourceName(parsed.roleName ?? defaults.roleName);
  const serverDir = path.join(projectCwd, ".output", "server");

  console.log(
    `[amplify-stream] Building Nitro ${LAMBDA_RUNTIME} Lambda bundle...`,
  );
  buildLambda(projectCwd, projectEnv);
  const archive = zipServerBundle(serverDir);
  try {
    console.log(`[amplify-stream] Ensuring IAM role ${roleName}...`);
    const roleArn = await ensureLambdaRole(roleName, region);
    console.log(`[amplify-stream] Updating Lambda ${functionName}...`);
    await ensureLambdaFunction(
      functionName,
      roleArn,
      archive.archivePath,
      region,
    );
    const functionUrl = await ensureFunctionUrl(functionName, region);
    const streamUrl = `${functionUrl.replace(/\/+$/, "")}${AGENT_CHAT_STREAM_PATH}`;
    const branch = updateAmplifyBranchEnvironment(
      parsed.amplifyAppId,
      parsed.branch,
      streamUrl,
      region,
    );
    console.log(`[amplify-stream] Function URL: ${functionUrl}`);
    console.log(`[amplify-stream] Stream endpoint: ${streamUrl}`);

    if (parsed.skipRelease) {
      console.log(
        "[amplify-stream] Branch env updated; release skipped (--skip-release).",
      );
      return;
    }

    const job = awsJson<{ jobSummary?: { jobId?: string } }>(
      [
        "amplify",
        "start-job",
        "--app-id",
        parsed.amplifyAppId,
        "--branch-name",
        parsed.branch,
        "--job-type",
        "RELEASE",
      ],
      region,
    );
    const jobId = job.jobSummary?.jobId;
    if (!jobId) throw new Error("Amplify did not return a release job id");
    console.log(`[amplify-stream] Waiting for Amplify release ${jobId}...`);
    await waitForAmplifyRelease(
      parsed.amplifyAppId,
      parsed.branch,
      jobId,
      region,
    );
    console.log("[amplify-stream] Amplify release succeeded.");
    if (branch.webUrl)
      console.log(`[amplify-stream] App URL: ${branch.webUrl}`);
  } finally {
    archive.cleanup();
  }
}
