import { isDeepStrictEqual } from "node:util";

import type { StandardSchemaV1 } from "@standard-schema/spec";

import {
  inputSchemaToJsonSchema,
  outputSchemaToJsonSchema,
} from "./action-output-contract.js";
import type { ActionLinkBuilder } from "./action.js";

/** Keep inline work below the hosted-client budget; durable work is polled. */
export const ACTION_CONFORMANCE_TIMEOUT_MS = 25_000;
export const ACTION_CONFORMANCE_RUN_TIMEOUT_MS = 150_000;
const POLL_INTERVAL_MS = 250;
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
  agentInputSchema?: unknown;
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
    /** Cancel through the authenticated task runner and return a terminal receipt. */
    cancelAndWait?: (signal: AbortSignal) => Promise<ConformanceResponse>;
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
  setup?: (
    surface: ActionConformanceSurface,
    signal: AbortSignal,
  ) => Promise<void>;
  /** Idempotent: may also compensate setup that settles after its deadline. */
  cleanup?: (
    surface: ActionConformanceSurface,
    signal: AbortSignal,
  ) => Promise<void>;
  /** Independent UI read, including the displayed content rather than only ids. */
  visibleContent?: (signal: AbortSignal) => Promise<unknown>;
  resultContent?: (result: unknown) => unknown;
  focus?: ConformanceFocus;
  /** Follow the actual link in the app and read the mounted pane and persisted state. */
  open?: (url: string, signal: AbortSignal) => Promise<ConformanceFocus>;
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
class FixtureCleanupError extends Error {}
async function bounded<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  if (timeoutMs <= 0)
    throw new DeadlineError("Conformance run budget exceeded");
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

function waitForPoll(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new DeadlineError("Client response budget exceeded"));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Runs owned fixtures through real client adapters; never executes an un-fixtured action. */
export async function checkActionConformance(options: {
  app: string;
  actions: Readonly<Record<string, ConformanceAction>>;
  adapters: Record<ActionConformanceSurface, ConformanceAdapter>;
  fixtures: Readonly<Record<string, ActionConformanceFixture | undefined>>;
  timeoutMs?: number;
  runTimeoutMs?: number;
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
  const maxPolls = options.maxPolls;
  if (maxPolls !== undefined && (!Number.isInteger(maxPolls) || maxPolls < 1))
    throw new RangeError("maxPolls must be positive");
  const runTimeoutMs =
    options.runTimeoutMs ?? ACTION_CONFORMANCE_RUN_TIMEOUT_MS;
  if (
    !Number.isFinite(runTimeoutMs) ||
    runTimeoutMs <= 0 ||
    runTimeoutMs > ACTION_CONFORMANCE_RUN_TIMEOUT_MS
  ) {
    throw new RangeError(
      "Conformance run budget must be between 0 and 150000 ms",
    );
  }
  const runDeadline = performance.now() + runTimeoutMs;
  const workDeadline = runDeadline - Math.min(timeoutMs, runTimeoutMs / 4);
  const runBounded = <T>(
    work: (signal: AbortSignal) => Promise<T>,
    perOperationMs: number,
  ): Promise<T> =>
    bounded(
      work,
      Math.min(perOperationMs, Math.max(0, workDeadline - performance.now())),
    );
  const waitForCleanup = <T>(
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> =>
    bounded(
      work,
      Math.min(timeoutMs, Math.max(0, runDeadline - performance.now())),
    );
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
        await runBounded(() => options.adapters[surface].list(), timeoutMs),
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
    if (performance.now() >= workDeadline) break;
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
    if (isStandardSchema(entry.schema)) {
      try {
        const fullInput = entry.schema;
        const validation = await runBounded(
          async () => fullInput["~standard"].validate(fixture.args),
          timeoutMs,
        );
        if (validation.issues) {
          fail(
            "input-schema",
            "Fixture arguments violate the full action schema",
          );
          continue;
        }
      } catch {
        fail(
          "input-schema",
          "Full action input validation failed or exceeded its budget",
        );
        continue;
      }
    }
    let declaredInput: unknown;
    let declaredAgentInput: unknown;
    let declaredOutput: unknown;
    try {
      if (isStandardSchema(entry.schema))
        declaredInput = inputSchemaToJsonSchema(entry.schema);
      const agentInput = entry.agentInputSchema ?? entry.schema;
      if (isStandardSchema(agentInput))
        declaredAgentInput = inputSchemaToJsonSchema(agentInput);
      if (entry.outputSchema)
        declaredOutput = outputSchemaToJsonSchema(entry.outputSchema);
    } catch {
      fail("schema-parity", "Declared action schema could not be emitted");
    }
    const semantic = (schema: unknown): unknown => {
      if (!schema || typeof schema !== "object" || Array.isArray(schema))
        return schema;
      const { $schema: _dialect, ...contract } = schema as Record<
        string,
        unknown
      >;
      return contract;
    };
    for (const surface of ACTION_CONFORMANCE_SURFACES) {
      if (performance.now() >= workDeadline) break;
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
      const expectedInput =
        surface === "ui" ? declaredInput : declaredAgentInput;
      if (
        !tool.inputSchema ||
        !tool.outputSchema ||
        !expectedInput ||
        !declaredOutput ||
        !isDeepStrictEqual(
          semantic(tool.inputSchema),
          semantic(expectedInput),
        ) ||
        !isDeepStrictEqual(
          semantic(tool.outputSchema),
          semantic(declaredOutput),
        )
      ) {
        fail(
          "schema-parity",
          "Semantic schemas differ from the declared action contract",
          surface,
        );
      }
      const agentInput = entry.agentInputSchema ?? entry.schema;
      if (surface !== "ui" && isStandardSchema(agentInput)) {
        try {
          const validated = await runBounded(
            async () => agentInput["~standard"].validate(fixture.args),
            timeoutMs,
          );
          if (validated.issues) {
            fail(
              "input-schema",
              "Fixture arguments violate the agent input schema",
              surface,
            );
            continue;
          }
        } catch {
          fail(
            "input-schema",
            "Agent input validation failed or exceeded its budget",
            surface,
          );
          continue;
        }
      }
      let phase: ActionConformanceFinding["check"] = "fixture";
      const pendingOwnedWork = new Set<Promise<unknown>>();
      const pendingTasks = new Map<
        string,
        NonNullable<ConformanceResponse["pending"]>
      >();
      const observeResponse = (
        response: ConformanceResponse,
        previousHandle?: string,
      ): ConformanceResponse => {
        if (previousHandle) pendingTasks.delete(previousHandle);
        if (response.pending)
          pendingTasks.set(response.pending.handle, response.pending);
        return response;
      };
      const trackOwnedWork = <T>(work: Promise<T>): Promise<T> => {
        pendingOwnedWork.add(work);
        const settled = () => {
          pendingOwnedWork.delete(work);
        };
        void work.then(settled, settled);
        return work;
      };
      const finalizeFixture = async (): Promise<void> => {
        const attempted = new Set<
          NonNullable<ConformanceResponse["pending"]>
        >();
        const cancelKnownTasks = async (): Promise<void> => {
          await Promise.allSettled(
            [...pendingTasks].map(async ([handle, task]) => {
              if (attempted.has(task)) return;
              attempted.add(task);
              const cancel = task.cancelAndWait;
              if (!cancel)
                throw new FixtureCleanupError("Missing durable cancellation");
              const terminal = await bounded(
                (signal) => cancel.call(task, signal),
                timeoutMs,
              );
              if (terminal.pending)
                throw new FixtureCleanupError("Cancellation is not terminal");
              if (pendingTasks.get(handle) === task)
                pendingTasks.delete(handle);
            }),
          );
        };
        await cancelKnownTasks();
        await Promise.allSettled([...pendingOwnedWork]);
        await cancelKnownTasks();
        if (pendingTasks.size)
          throw new FixtureCleanupError(
            "Durable task remains live; fixture cleanup is unconfirmed",
          );
        await bounded(
          async (signal) => fixture.cleanup?.(surface, signal),
          timeoutMs,
        );
      };
      try {
        await runBounded(
          (signal) =>
            trackOwnedWork(
              Promise.resolve().then(() => fixture.setup?.(surface, signal)),
            ),
          timeoutMs,
        );
        phase = "result";
        report.calls++;
        let response = await runBounded(
          (signal) =>
            trackOwnedWork(
              options.adapters[surface]
                .call(action, fixture.args, signal)
                .then((response) => observeResponse(response)),
            ),
          timeoutMs,
        );
        let nextPollAt = performance.now();
        for (
          let poll = 0;
          response.pending && (maxPolls === undefined || poll < maxPolls);
          poll++
        ) {
          const pending = response.pending;
          if (!pending.handle.trim()) throw new Error("Missing pending handle");
          const delayMs = nextPollAt - performance.now();
          if (delayMs > 0)
            await runBounded(
              (signal) => waitForPoll(Math.ceil(delayMs), signal),
              workDeadline - performance.now(),
            );
          response = await runBounded((signal) => {
            nextPollAt = performance.now() + POLL_INTERVAL_MS;
            return trackOwnedWork(
              pending
                .poll(signal)
                .then((response) => observeResponse(response, pending.handle)),
            );
          }, timeoutMs);
        }
        if (response.pending) {
          fail(
            "latency",
            "Durable task did not reach a terminal result",
            surface,
          );
          continue;
        }
        const outputSchema = entry.outputSchema;
        if (outputSchema) {
          const validated = await runBounded(
            async () => outputSchema["~standard"].validate(response.result),
            timeoutMs,
          );
          if (validated.issues)
            fail("result", "Result violates output schema", surface);
        }
        if (entry.readOnly) {
          const visibleContent = fixture.visibleContent;
          if (!visibleContent || !fixture.resultContent)
            fail(
              "fixture",
              "Read needs an independent visible-content oracle",
              surface,
            );
          else {
            phase = "content";
            const visible = await runBounded(
              (signal) => visibleContent(signal),
              timeoutMs,
            );
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
        phase = "link";
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
              await runBounded(
                (signal) =>
                  fixture.open
                    ? fixture.open(url, signal)
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
          error instanceof DeadlineError && phase === "result"
            ? "latency"
            : phase,
          error instanceof DeadlineError
            ? "Client response budget exceeded"
            : "Fixture call failed; inspect the adapter's diagnostics",
          surface,
        );
      } finally {
        const finalization = finalizeFixture();
        try {
          await waitForCleanup(() => finalization);
        } catch (error) {
          fail(
            "fixture",
            error instanceof DeadlineError
              ? "Owned work did not settle; cleanup remains unconfirmed"
              : error instanceof FixtureCleanupError
                ? error.message
                : "Owned fixture cleanup failed",
            surface,
          );
          if (error instanceof DeadlineError)
            void finalization.catch(() => {
              console.error("Late owned-fixture cleanup failed", {
                app: options.app,
                action,
                surface,
              });
            });
        }
      }
    }
  }
  if (performance.now() >= workDeadline)
    report.failures.push({
      app: options.app,
      action: "*",
      check: "latency",
      message:
        "Conformance run budget exceeded; remaining behavior is unmeasured",
    });
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
