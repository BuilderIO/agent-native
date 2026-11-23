import type { APIRequestContext, APIResponse } from "@playwright/test";

export type BuildObservation =
  | { kind: "read"; sha: string }
  | { kind: "absent" }
  | { kind: "unreadable"; reason: string };

export function flowBuildLine(
  name: string,
  before: BuildObservation,
  after: BuildObservation,
): string {
  return `FLOW_BUILD ${JSON.stringify({ name, before, after })}`;
}

export const FULL_BUILD_SHA = /^[a-f0-9]{40}$/;

type BuildRequest = {
  get(
    url: string,
    options: Parameters<APIRequestContext["get"]>[1],
  ): Promise<Pick<APIResponse, "ok" | "status" | "text" | "dispose">>;
};

// The app's own compiled source stamp in its document. The workspace-wide
// x-agent-native-build-sha header moves on every deploy of any app, so it
// would void a verdict whenever a sibling app deploys.
export function parseAppSourceSha(html: string): BuildObservation {
  const app: string[] = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = /\bname\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (name !== "agent-native-app-source-sha") continue;
    app.push(/\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? "");
  }
  const sha = app[0];
  if (sha === undefined) return { kind: "absent" };
  if (app.some((value) => !FULL_BUILD_SHA.test(value)))
    return { kind: "unreadable", reason: "Invalid build identity" };
  if (new Set(app).size > 1)
    return { kind: "unreadable", reason: "Ambiguous build identity" };
  return { kind: "read", sha };
}

export async function observeBuild(
  request: BuildRequest,
  base: string,
): Promise<BuildObservation> {
  try {
    const response = await request.get(`${base}/home`, {
      timeout: 10000,
      maxRedirects: 0,
      headers: { "cache-control": "no-cache" },
    });
    try {
      if (!response.ok())
        return { kind: "unreadable", reason: `HTTP${response.status()}` };
      return parseAppSourceSha(await response.text());
    } finally {
      await response.dispose();
    }
  } catch {
    return { kind: "unreadable", reason: "Build request failed" };
  }
}

export function stableBuild(
  before: BuildObservation,
  after: BuildObservation,
): boolean {
  return (
    before.kind === "read" && after.kind === "read" && before.sha === after.sha
  );
}

export function candidateBuildIssue(
  observation: BuildObservation,
  expected: string,
) {
  if (observation.kind === "absent") return "build SHA absent";
  if (observation.kind === "unreadable")
    return `build SHA unreadable (${observation.reason})`;
  if (observation.sha !== expected)
    return `build SHA mismatch (expected ${expected}, served ${observation.sha})`;
  return null;
}

export async function finishBuildVerdict<
  T extends "PASS" | "FAIL" | "COULD-NOT-RUN",
>(
  observedStatus: T,
  detail: string,
  before: BuildObservation,
  observe: () => Promise<BuildObservation>,
  expected?: string,
) {
  const after = await observe();
  if (expected !== undefined) {
    const mismatchBefore = candidateBuildIssue(before, expected);
    const mismatchAfter = candidateBuildIssue(after, expected);
    const issue = mismatchBefore
      ? `Before flow: ${mismatchBefore}`
      : mismatchAfter && `After flow: ${mismatchAfter}`;
    return {
      before,
      after,
      observedStatus,
      status: issue ? ("COULD-NOT-RUN" as const) : observedStatus,
      detail: issue ?? detail,
    };
  }
  const stable = stableBuild(before, after);
  return {
    before,
    after,
    observedStatus,
    status: stable ? observedStatus : ("COULD-NOT-RUN" as const),
    detail: stable
      ? detail
      : `Build identity changed or unavailable; observed ${observedStatus}: ${detail}`,
  };
}
