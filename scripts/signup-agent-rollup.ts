import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_SLACK_FINDING_DETAILS = 20_000;

export interface SignupAgentFinding {
  severity: "high" | "medium" | "low";
  target: string;
  step: string;
  title: string;
  evidence: string;
  signature: string;
}

export interface SignupAgentRollup {
  findingCount: number;
  visibleFindingCount: number;
  omittedFindingCount: number;
  findings: SignupAgentFinding[];
  slackText: string;
  reportMarkdown: string;
}

export function parseSignupAgentFindings(
  markdown: string,
): SignupAgentFinding[] {
  let target = "Unknown target";
  const findings: SignupAgentFinding[] = [];

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^###\s+(.+)$/);
    if (heading) {
      target = heading[1]!.trim();
      continue;
    }

    const row = line
      .replace(/\\\|/g, "\u0000")
      .match(
        /^\|\s*(high|medium|low)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*$/i,
      );
    if (!row) continue;

    const severity = row[1]!.toLowerCase() as SignupAgentFinding["severity"];
    const step = unescapeCell(row[2]!);
    const title = unescapeCell(row[3]!);
    const evidence = unescapeCell(row[4]!);
    const identity = `${target}\n${severity}\n${step}\n${title}`
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    findings.push({
      severity,
      target,
      step,
      title,
      evidence,
      signature: createHash("sha256")
        .update(identity)
        .digest("hex")
        .slice(0, 12),
    });
  }

  return findings;
}

export function buildSignupAgentRollup(input: {
  markdown: string;
  status: string;
  targets: string;
  environments: string;
  runUrl: string;
  artifactUrl?: string;
  reportIncomplete?: boolean;
}): SignupAgentRollup {
  const findings = parseSignupAgentFindings(input.markdown);
  if (input.reportIncomplete && findings.length === 0) {
    const title = "The signup agent review did not produce a findings report.";
    findings.push({
      severity: "high",
      target: "Unknown target",
      step: "Report collection",
      title,
      evidence: "The report file was absent or incomplete.",
      signature: createHash("sha256").update(title).digest("hex").slice(0, 12),
    });
  }
  const details = findings.map((finding) =>
    [
      `• [${finding.severity}] ${finding.target}: ${finding.title}`,
      `  Step: ${finding.step}`,
      `  Signature: \`signup-agent-${finding.signature}\``,
      `  Evidence: ${finding.evidence || "No evidence summary was recorded."}`,
    ].join("\n"),
  );

  let used = 0;
  const visible: string[] = [];
  for (const detail of details) {
    const size = Array.from(`${detail}\n\n`).length;
    if (used + size > MAX_SLACK_FINDING_DETAILS) break;
    visible.push(detail);
    used += size;
  }
  const omittedFindingCount = findings.length - visible.length;
  const reportMarkdown = [
    `# Signup agent findings (${findings.length})`,
    "",
    ...findings.flatMap((finding) => [
      `## [${finding.severity}] ${finding.target}: ${finding.title}`,
      "",
      `- Step: ${finding.step}`,
      `- Signature: signup-agent-${finding.signature}`,
      `- Evidence: ${finding.evidence || "No evidence summary was recorded."}`,
      "",
    ]),
    input.reportIncomplete ? "The review report was incomplete." : "",
  ].join("\n");

  const lines = [
    `Signup agent review ${input.status} for ${input.targets} on ${input.environments}.`,
    `Findings: ${findings.length} total; showing ${visible.length}; ${omittedFindingCount} omitted from this Slack message.`,
    ...(input.reportIncomplete
      ? ["The review did not produce complete evidence."]
      : []),
    ...(findings.length > 0
      ? ["", ...visible]
      : ["", "No findings were reported."]),
    ...(omittedFindingCount > 0
      ? [
          "",
          input.artifactUrl
            ? `${omittedFindingCount} additional findings are in the complete report artifact (retained 90 days).`
            : `${omittedFindingCount} additional findings were omitted from Slack; the report artifact is unavailable.`,
        ]
      : []),
    "",
    input.artifactUrl
      ? `Full findings and screenshot evidence: <${input.artifactUrl}|90-day report artifact>.`
      : `Full report artifact is unavailable; see <${input.runUrl}|the workflow run>.`,
    `Run: <${input.runUrl}|workflow run>`,
  ];

  return {
    findingCount: findings.length,
    visibleFindingCount: visible.length,
    omittedFindingCount,
    findings,
    slackText: lines.join("\n"),
    reportMarkdown,
  };
}

function unescapeCell(value: string): string {
  return value
    .replace(/\u0000/g, "|")
    .replace(/\\\|/g, "|")
    .trim();
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

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const findingsPath = requireArg(args, "findings");
  const markdown = existsSync(findingsPath)
    ? readFileSync(findingsPath, "utf8")
    : "";
  const rollup = buildSignupAgentRollup({
    markdown,
    status: requireArg(args, "status"),
    targets: requireArg(args, "targets"),
    environments: requireArg(args, "environments"),
    runUrl: requireArg(args, "run-url"),
    artifactUrl: args.get("artifact-url"),
    reportIncomplete: args.get("incomplete") === "true",
  });
  const outDir = requireArg(args, "out-dir");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    resolve(outDir, "signup-agent-report.md"),
    rollup.reportMarkdown,
  );
  writeFileSync(resolve(outDir, "signup-agent-slack.txt"), rollup.slackText);
  writeFileSync(
    resolve(outDir, "signup-agent-rollup.json"),
    `${JSON.stringify(
      {
        findingCount: rollup.findingCount,
        visibleFindingCount: rollup.visibleFindingCount,
        omittedFindingCount: rollup.omittedFindingCount,
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
    console.error(`::error::Could not build signup agent rollup: ${message}`);
    process.exitCode = 1;
  }
}
