import { isDeepStrictEqual } from "node:util";

import type { StandardSchemaV1 } from "@standard-schema/spec";

import type { ActionLinkBuilder } from "./action.js";

/** Keep inline work below the hosted-client budget; durable work is polled. */
export const ACTION_CONFORMANCE_TIMEOUT_MS = 25_000;
export const ACTION_CONFORMANCE_SURFACES = [
  "ui",
  "mcp",
  "a2a",
  "chatgpt",
  "claude",
] as const;
export type ActionConformanceSurface =
  (typeof ACTION_CONFORMANCE_SURFACES)[number];

export interface ConformanceAction {
  schema?: unknown;
  outputSchema?: StandardSchemaV1;
  readOnly?: boolean;
  link?: ActionLinkBuilder;
}

export interface ConformanceTool {
  name: string;
  /** Semantic schemas, before transport-specific envelope fields. */
  inputSchema: unknown;
  outputSchema: unknown;
}

export interface ConformanceResponse {
  result: unknown;
  openUrl?: string;
  pending?: {
    handle: string;
    /** Poll through the same authenticated client, never re-run the action. */
    poll: (signal: AbortSignal) => Promise<ConformanceResponse>;
  };
}

export interface ConformanceAdapter {
  list: () => Promise<readonly ConformanceTool[]>;
  call: (
    name: string,
    args: unknown,
    signal: AbortSignal,
  ) => Promise<ConformanceResponse>;
}

export interface ConformanceFocus {
  route: string;
  pane: string;
  applicationState: unknown;
}

export interface ActionConformanceFixture {
  args: Record<string, unknown>;
  /** Create a new owned fixture before each transport calls a write. */
  setup?: (surface: ActionConformanceSurface) => Promise<void>;
  cleanup?: (surface: ActionConformanceSurface) => Promise<void>;
  /** Independent UI read, including the displayed content rather than only ids. */
  visibleContent?: () => Promise<unknown>;
  resultContent?: (result: unknown) => unknown;
  focus?: ConformanceFocus;
  /** Follow the actual link in the app and read the mounted pane and persisted state. */
  open?: (url: string) => Promise<ConformanceFocus>;
  /** An intentional access boundary must be named; absence means parity is required. */
  excluded?: Partial<Record<ActionConformanceSurface, string>>;
}

export interface ActionConformanceFinding {
  app: string;
  action: string;
  surface?: ActionConformanceSurface;
  check:
    | "input-schema"
    | "output-schema"
    | "fixture"
    | "catalog"
    | "exposure"
    | "schema-parity"
    | "result"
    | "content"
    | "latency"
    | "link";
  message: string;
}

export interface ActionConformanceReport {
  app: string;
  actions: number;
  calls: number;
  exemptions: number;
  failures: ActionConformanceFinding[];
}

export function actionContractFindings(
  app: string,
  actions: Readonly<Record<string, ConformanceAction>>,
): ActionConformanceFinding[] {
  return Object.entries(actions).flatMap(([action, entry]) => {
    const failures: ActionConformanceFinding[] = [];
    if (!isStandardSchema(entry.schema))
      failures.push({
        app,
        action,
        check: "input-schema",
        message: "Missing input schema",
      });
    if (!isStandardSchema(entry.outputSchema))
      failures.push({
        app,
        action,
        check: "output-schema",
        message: "Missing output schema",
      });
    return failures;
  });
}

function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  return (
    !!value &&
    typeof value === "object" &&
    "~standard" in value &&
    typeof (value as StandardSchemaV1)["~standard"]?.validate === "function"
  );
}

function hasContent(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasContent);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, item]) =>
      !/^(id|.*Id|.*Ids|url|href|type|kind)$/.test(key) && hasContent(item),
  );
}

class DeadlineError extends Error {}
async function bounded<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => work(controller.signal)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new DeadlineError("Client response budget exceeded"));
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Runs owned fixtures through real client adapters; never executes an un-fixtured action. */
export async function checkActionConformance(options: {
  app: string;
  actions: Readonly<Record<string, ConformanceAction>>;
  adapters: Record<ActionConformanceSurface, ConformanceAdapter>;
  fixtures: Readonly<Record<string, ActionConformanceFixture | undefined>>;
  /** May tighten the shared budget, never relax it. */
  timeoutMs?: number;
  maxPolls?: number;
}): Promise<ActionConformanceReport> {
  const timeoutMs = options.timeoutMs ?? ACTION_CONFORMANCE_TIMEOUT_MS;
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > ACTION_CONFORMANCE_TIMEOUT_MS
  ) {
    throw new RangeError("Conformance timeout must be between 0 and 25000 ms");
  }
  const maxPolls = options.maxPolls ?? 10;
  if (!Number.isInteger(maxPolls) || maxPolls < 1)
    throw new RangeError("maxPolls must be positive");
  const report: ActionConformanceReport = {
    app: options.app,
    actions: Object.keys(options.actions).length,
    calls: 0,
    exemptions: 0,
    failures: actionContractFindings(options.app, options.actions),
  };
  if (!report.actions)
    report.failures.push({
      app: options.app,
      action: "*",
      check: "fixture",
      message: "No actions registered",
    });
  const catalogs = new Map<
    ActionConformanceSurface,
    readonly ConformanceTool[]
  >();
  for (const surface of ACTION_CONFORMANCE_SURFACES) {
    try {
      catalogs.set(
        surface,
        await bounded(() => options.adapters[surface].list(), timeoutMs),
      );
    } catch {
      report.failures.push({
        app: options.app,
        action: "*",
        surface,
        check: "catalog",
        message: "Catalog could not be measured",
      });
    }
  }
  for (const [action, entry] of Object.entries(options.actions)) {
    const fixture = options.fixtures[action];
    const fail = (
      check: ActionConformanceFinding["check"],
      message: string,
      surface?: ActionConformanceSurface,
    ) => {
      report.failures.push({
        app: options.app,
        action,
        ...(surface ? { surface } : {}),
        check,
        message,
      });
    };
    if (!fixture) {
      fail("fixture", "Missing owned fixture; behavior is unmeasured");
      continue;
    }
    const canonical = catalogs.get("ui")?.find((tool) => tool.name === action);
    for (const surface of ACTION_CONFORMANCE_SURFACES) {
      const catalog = catalogs.get(surface);
      if (!catalog) continue;
      const tools = catalog.filter((tool) => tool.name === action);
      const exclusion = fixture.excluded?.[surface];
      if (exclusion !== undefined) {
        if (!exclusion.trim())
          fail(
            "exposure",
            "Exclusion needs an access-boundary reason",
            surface,
          );
        else report.exemptions++;
        if (tools.length)
          fail("exposure", "Excluded action is exposed", surface);
        continue;
      }
      if (tools.length !== 1) {
        fail("exposure", "Action must be exposed exactly once", surface);
        continue;
      }
      const tool = tools.at(0);
      if (!tool) continue;
      if (
        !tool.inputSchema ||
        !tool.outputSchema ||
        !canonical ||
        !isDeepStrictEqual(tool.inputSchema, canonical.inputSchema) ||
        !isDeepStrictEqual(tool.outputSchema, canonical.outputSchema)
      ) {
        fail(
          "schema-parity",
          "Semantic schemas differ from the UI contract",
          surface,
        );
      }
      let setup = false;
      try {
        await fixture.setup?.(surface);
        setup = true;
        report.calls++;
        let response = await bounded(
          (signal) =>
            options.adapters[surface].call(action, fixture.args, signal),
          timeoutMs,
        );
        for (let poll = 0; response.pending && poll < maxPolls; poll++) {
          const pending = response.pending;
          if (!pending.handle.trim()) throw new Error("Missing pending handle");
          response = await bounded(pending.poll, timeoutMs);
        }
        if (response.pending) {
          fail(
            "latency",
            "Durable task did not reach a terminal result",
            surface,
          );
          continue;
        }
        if (entry.outputSchema) {
          const validated = await entry.outputSchema["~standard"].validate(
            response.result,
          );
          if (validated.issues)
            fail("result", "Result violates output schema", surface);
        }
        if (entry.readOnly) {
          if (!fixture.visibleContent || !fixture.resultContent)
            fail(
              "fixture",
              "Read needs an independent visible-content oracle",
              surface,
            );
          else {
            const visible = await fixture.visibleContent();
            if (!hasContent(visible))
              fail(
                "content",
                "Visible-content fixture is empty or id-only",
                surface,
              );
            else if (
              !isDeepStrictEqual(
                fixture.resultContent(response.result),
                visible,
              )
            )
              fail(
                "content",
                "Read result omits or changes UI content",
                surface,
              );
          }
        }
        const link = entry.link?.({
          args: fixture.args,
          result: response.result,
        });
        const url = response.openUrl ?? link?.url;
        if (entry.link || url || fixture.focus) {
          if (!url || !fixture.open || !fixture.focus)
            fail(
              "link",
              "Link needs a route, pane and application-state oracle",
              surface,
            );
          else if (
            !isDeepStrictEqual(
              await bounded(
                () =>
                  fixture.open
                    ? fixture.open(url)
                    : Promise.reject(new Error("Missing route adapter")),
                timeoutMs,
              ),
              fixture.focus,
            )
          ) {
            fail(
              "link",
              "Link opens the wrong route, pane or application state",
              surface,
            );
          }
        }
      } catch (error) {
        fail(
          error instanceof DeadlineError ? "latency" : "result",
          error instanceof DeadlineError
            ? "Client response budget exceeded"
            : "Fixture call failed; inspect the adapter's diagnostics",
          surface,
        );
      } finally {
        if (setup && fixture.cleanup) {
          try {
            await fixture.cleanup(surface);
          } catch {
            fail("fixture", "Owned fixture cleanup failed", surface);
          }
        }
      }
    }
  }
  return report;
}

export function assertActionConformance(report: ActionConformanceReport): void {
  if (report.failures.length)
    throw new Error(
      report.failures
        .map(
          (failure) =>
            `${failure.app}/${failure.action}${failure.surface ? ` [${failure.surface}]` : ""} ${failure.check}: ${failure.message}`,
        )
        .join("\n"),
    );
}
