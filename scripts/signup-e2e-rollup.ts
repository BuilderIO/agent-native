import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_SLACK_FINDING_DETAILS = 20_000;
const MAX_SLACK_COLLECTION_DETAILS = 4_000;

export interface SignupE2EJobLog {
  id: number | null;
  name: string;
  url: string;
  conclusion: string;
  log: string;
}

export interface SignupE2EFinding {
  title: string;
  signature: string;
  summary: string;
  jobName: string;
  jobUrl: string;
}

export interface SignupE2ERollup {
  findingCount: number;
  visibleFindingCount: number;
  omittedFindingCount: number;
  unclassifiedWorkflowFailure: boolean;
  findings: SignupE2EFinding[];
  slackText: string;
  reportMarkdown: string;
}

const titlePattern = /\d+\)\s+\[[^\]]+\]\s+›\s+(.+)$/;
const annotationPattern = /::error title=Test failed:\s*(.+?)::(.*)$/;

export function parseSignupE2EFindings(
  jobs: SignupE2EJobLog[],
): SignupE2EFinding[] {
  const findings: SignupE2EFinding[] = [];
  for (const job of jobs) {
    const lines = job.log
      .replace(/\u001b\[[0-9;]*m/g, "")
      .split(/\r?\n/)
      .map(stripLogPrefix);
    const headers: Array<{
      index: number;
      title: string;
      annotation?: string;
    }> = [];
    for (const [index, line] of lines.entries()) {
      const annotation = line.match(annotationPattern);
      if (annotation) {
        headers.push({
          index,
          title: annotation[1]!.trim(),
          annotation: annotation[2]!.trim(),
        });
        continue;
      }
      const match = line.match(titlePattern);
      if (match) headers.push({ index, title: match[1]!.trim() });
    }

    if (headers.length === 0) {
      findings.push(
        makeFinding(
          job,
          job.name,
          findErrorSummary(lines) ||
            `The job concluded ${job.conclusion}; no test-level failure details were recorded.`,
        ),
      );
      continue;
    }

    for (const [headerIndex, header] of headers.entries()) {
      const nextHeader = headers[headerIndex + 1]?.index ?? lines.length;
      const summary =
        header.annotation ||
        findErrorSummary(lines.slice(header.index + 1, nextHeader)) ||
        `The test failed in ${job.name}.`;
      findings.push(makeFinding(job, header.title, summary));
    }
  }
  return findings;
}

export function buildSignupE2ERollup(input: {
  jobs: SignupE2EJobLog[];
  workflowResult: string;
  apps: string;
  environments: string;
  runUrl: string;
  evidenceUrl?: string;
  reportArtifactUrl?: string;
  collectionErrors?: string[];
}): SignupE2ERollup {
  const findings = parseSignupE2EFindings(input.jobs);
  const unclassifiedWorkflowFailure =
    (input.workflowResult === "failure" ||
      input.workflowResult === "cancelled") &&
    input.jobs.length === 0;
  const details = findings.map(
    (finding) =>
      `• ${slackText(finding.title)} — signature \`signup-e2e-${finding.signature}\` — ${slackText(finding.summary)} (${slackLink(finding.jobUrl, finding.jobName)})`,
  );
  let used = 0;
  const visible: string[] = [];
  for (const detail of details) {
    const size = Array.from(`${detail}\n`).length;
    if (used + size > MAX_SLACK_FINDING_DETAILS) break;
    visible.push(detail);
    used += size;
  }
  const omittedFindingCount = findings.length - visible.length;
  const collectionErrors = input.collectionErrors ?? [];
  let collectionCharacters = 0;
  const visibleCollectionErrors: string[] = [];
  for (const error of collectionErrors) {
    const safeError = slackText(error);
    const size = Array.from(safeError).length + 1;
    if (collectionCharacters + size > MAX_SLACK_COLLECTION_DETAILS) break;
    visibleCollectionErrors.push(safeError);
    collectionCharacters += size;
  }
  const omittedCollectionErrorCount =
    collectionErrors.length - visibleCollectionErrors.length;
  const failedJobCount = input.jobs.length;
  const reportMarkdown = [
    `# Signup E2E report (${findings.length} findings)`,
    "",
    `Workflow result: ${input.workflowResult}`,
    `Failed job records: ${failedJobCount}`,
    `Apps: ${input.apps}`,
    `Environments: ${input.environments}`,
    "",
    ...(collectionErrors.length
      ? [
          "## Collection errors",
          "",
          ...collectionErrors.map((error) => `- ${error}`),
          "",
        ]
      : []),
    ...(unclassifiedWorkflowFailure
      ? [
          "## Unclassified workflow failure",
          "",
          "The workflow failed, but GitHub returned no failed-job records. No test-specific failures could be confirmed.",
          "",
        ]
      : []),
    ...(findings.length > 0
      ? findings.flatMap((finding) => [
          `## ${finding.title}`,
          "",
          `- Signature: signup-e2e-${finding.signature}`,
          `- Summary: ${finding.summary}`,
          `- Job: ${finding.jobName} (${finding.jobUrl})`,
          "",
        ])
      : [
          unclassifiedWorkflowFailure
            ? "No test-specific findings were confirmed from the available job details."
            : "No test-level finding details were collected.",
          "",
        ]),
  ].join("\n");
  const lines = [
    `Signup E2E ${slackText(input.workflowResult)} for ${slackText(input.apps)} on ${slackText(input.environments)}.`,
    unclassifiedWorkflowFailure
      ? "Failure summary: no failed-job records were returned; 0 test-specific findings confirmed."
      : `Failure summary: ${failedJobCount} failed job record${failedJobCount === 1 ? "" : "s"}; ${findings.length} finding${findings.length === 1 ? "" : "s"} total; showing ${visible.length}; ${omittedFindingCount} omitted from this Slack message.`,
    ...(unclassifiedWorkflowFailure
      ? [
          "Workflow failure is unclassified; no test-specific failure can be confirmed from the available evidence.",
        ]
      : []),
    ...(collectionErrors.length
      ? [
          `Collection warnings: ${collectionErrors.length} total; showing ${visibleCollectionErrors.length}; ${omittedCollectionErrorCount} omitted from this Slack message.`,
          ...visibleCollectionErrors.map((error) => `• ${error}`),
          ...(omittedCollectionErrorCount > 0
            ? [
                `${omittedCollectionErrorCount} additional collection errors are in the full report artifact.`,
              ]
            : []),
        ]
      : ["Collection status: complete."]),
    "",
    ...(findings.length > 0
      ? visible
      : [
          unclassifiedWorkflowFailure
            ? "No test-specific findings were confirmed."
            : "No test-level failure detail was returned; see the job logs.",
        ]),
    ...(omittedFindingCount > 0
      ? [
          "",
          input.reportArtifactUrl
            ? `${omittedFindingCount} additional findings are in the complete report artifact (retained 90 days).`
            : `${omittedFindingCount} additional findings were omitted from Slack; the report artifact is unavailable.`,
        ]
      : []),
    "",
    input.reportArtifactUrl
      ? `Complete findings and failed-job logs: ${slackLink(input.reportArtifactUrl, "90-day report artifact")}.`
      : `Full report artifact unavailable; see ${slackLink(input.runUrl, "workflow run")}.`,
    input.evidenceUrl
      ? `Signup test evidence: ${slackLink(input.evidenceUrl, "test-result artifact")}.`
      : "No signup test-result artifact was uploaded.",
    `Run: ${slackLink(input.runUrl, "workflow run")}`,
  ];

  return {
    findingCount: findings.length,
    visibleFindingCount: visible.length,
    omittedFindingCount,
    unclassifiedWorkflowFailure,
    findings,
    slackText: lines.join("\n"),
    reportMarkdown,
  };
}

function makeFinding(
  job: SignupE2EJobLog,
  title: string,
  summary: string,
): SignupE2EFinding {
  const normalizedTitle = title.toLowerCase().replace(/\s+/g, " ").trim();
  return {
    title,
    signature: createHash("sha256")
      .update(`${job.name}\n${normalizedTitle}`)
      .digest("hex")
      .slice(0, 12),
    summary: conciseSummary(summary),
    jobName: job.name,
    jobUrl: job.url,
  };
}

function findErrorSummary(lines: string[]): string {
  const cleaned = lines
    .map((line) => stripLogPrefix(line).trim())
    .filter(Boolean);
  const errorLine = cleaned.find((line) =>
    /(?:^|\b)(?:Error:|AssertionError:|TimeoutError:|Test timeout|Timed out|expect\(|Expected:|Received:|failed with exit code|Cannot find module|Type error:)/i.test(
      line,
    ),
  );
  return errorLine ?? "";
}

function stripLogPrefix(line: string): string {
  return line.replace(
    /^(?:[^\t]*\t)?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\t/,
    "",
  );
}

function slackText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/@/g, "@\u200b")
    .replace(/\bhttps?:\/\//gi, (scheme) => `${scheme}\u200b`)
    .replace(/\bwww\./gi, "www\u200b.")
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi, (domain) =>
      domain.replace(/\./g, ".\u200b"),
    )
    .replace(/`/g, "'")
    .trim();
}

function slackLink(url: string, label: string): string {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "github.com" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.search ||
      parsed.hash ||
      !/^\/BuilderIO\/agent-native\/actions\/runs\/\d+(?:\/(?:job|artifacts)\/\d+)?$/.test(
        parsed.pathname,
      )
    ) {
      return slackText(label);
    }
    return `<${parsed.href}|${slackText(label)}>`;
  } catch {
    return slackText(label);
  }
}

function conciseSummary(value: string): string {
  return (
    value.replace(/\s+/g, " ").trim().slice(0, 300) ||
    "No concise failure summary was recorded."
  );
}

function parseArgs(args: string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(
        `expected flag/value pair near ${key ?? "end of arguments"}`,
      );
    }
    parsed.set(key.slice(2), value);
  }
  return parsed;
}

function requireArg(args: Map<string, string>, name: string): string {
  const value = args.get(name);
  if (!value) throw new Error(`missing --${name}`);
  return value;
}

function readJobs(
  metadataPath: string,
  logsDir: string,
): {
  jobs: SignupE2EJobLog[];
  workflowResult: string;
  apps: string;
  environments: string;
  runUrl: string;
  evidenceUrl?: string;
  collectionErrors: string[];
} {
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as {
    jobs: Array<Omit<SignupE2EJobLog, "log"> & { logFile?: string }>;
    workflowResult: string;
    apps: string;
    environments: string;
    runUrl: string;
    evidenceUrl?: string;
    collectionErrors: string[];
  };
  const jobs = metadata.jobs.map((job, index) => {
    const logFile = job.logFile ?? `${index + 1}.log`;
    const path = resolve(logsDir, logFile);
    const log = readdirSync(logsDir).includes(logFile)
      ? readFileSync(path, "utf8")
      : "";
    return { ...job, log };
  });
  return { ...metadata, jobs };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const metadata = readJobs(
    requireArg(args, "metadata"),
    requireArg(args, "logs-dir"),
  );
  const rollup = buildSignupE2ERollup({
    ...metadata,
    reportArtifactUrl: args.get("report-artifact-url"),
  });
  const outDir = requireArg(args, "out-dir");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    resolve(outDir, "signup-e2e-findings.md"),
    rollup.reportMarkdown,
  );
  writeFileSync(resolve(outDir, "signup-e2e-slack.txt"), rollup.slackText);
  writeFileSync(
    resolve(outDir, "signup-e2e-rollup.json"),
    `${JSON.stringify(
      {
        findingCount: rollup.findingCount,
        visibleFindingCount: rollup.visibleFindingCount,
        omittedFindingCount: rollup.omittedFindingCount,
        unclassifiedWorkflowFailure: rollup.unclassifiedWorkflowFailure,
        findings: rollup.findings,
      },
      null,
      2,
    )}\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`::error::Could not build signup E2E rollup: ${message}`);
    process.exitCode = 1;
  }
}
