import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  expect,
  request,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { z } from "zod";

import { kernelGenerationSchema } from "../../shared/notebook-execution.js";
import {
  Evidence,
  EvidenceFailure,
  MissingCapability,
  UnavailableFixture,
} from "./verdict.js";

type Actor = "owner" | "colleague" | "denied";
export type ActorStates = Partial<Record<Actor, string>>;
export type FlowDefinition = {
  id: string;
  run(flow: FlowContext): Promise<void>;
};
type State = Awaited<ReturnType<BrowserContext["storageState"]>>;
type Settings = {
  browser: Browser;
  page: Page;
  baseUrl: string;
  bqKeyFile?: string;
  providerFixtureUrl?: string;
  workerFixtureUrl?: string;
  modelFixtureUrl?: string;
  expectedSha: string;
  expectedKernelDigest?: string;
  evidenceDir: string;
  flowId: string;
  states: ActorStates;
  ownerInitialState: State;
  evidence: Evidence;
};

const shellSchema = z.object({
  workspace: z.object({ id: z.string().min(1) }),
  user: z.object({
    id: z.string().min(1),
    email: z.string().min(1),
    name: z.string(),
  }),
});
const errorSchema = z.object({
  errorCode: z.string().optional(),
  error: z.string().optional(),
});
const draftKernelSession = z.object({
  status: z.literal("found"),
  generation: kernelGenerationSchema,
  state: z.enum([
    "absent",
    "queued",
    "starting",
    "idle",
    "busy",
    "stopped",
    "expired",
  ]),
});

function contextOptions(storageState?: State | string) {
  return {
    ...(storageState && { storageState }),
    locale: "en-US",
    serviceWorkers: "block" as const,
    viewport: { width: 1440, height: 1000 },
  };
}

export class ActionFailure extends EvidenceFailure {
  constructor(
    readonly action: string,
    readonly status: number,
  ) {
    super(`${action} returned HTTP ${status}`);
  }
}

export class FlowContext {
  readonly page: Page;
  readonly baseUrl: string;
  readonly bqKeyFile: string | undefined;
  readonly providerFixtureUrl: string | undefined;
  readonly expectedSha: string;
  readonly expectedKernelDigest: string | undefined;
  private readonly suffix = randomUUID().slice(0, 8);
  private readonly ownedDrafts = new Set<string>();
  private compatibility: string | undefined;

  constructor(private readonly settings: Settings) {
    this.page = settings.page;
    this.baseUrl = settings.baseUrl;
    this.bqKeyFile = settings.bqKeyFile;
    this.providerFixtureUrl = settings.providerFixtureUrl;
    this.expectedSha = settings.expectedSha;
    this.expectedKernelDigest = settings.expectedKernelDigest;
  }

  actorStateAvailable(actor: Exclude<Actor, "owner">) {
    return this.settings.states[actor] !== undefined;
  }

  name(prefix: string) {
    return `${prefix} ${this.suffix}`;
  }

  async createNotebookWithKernelCleanup(title: string) {
    const { id: projectId } = z
      .object({ id: z.string().min(1) })
      .parse(await this.action("create-project", { title: this.name(title) }));
    this.ownedDrafts.add(projectId);
    this.id("projectId", projectId);
    return projectId;
  }

  async releaseOwnedDraftKernels() {
    const projects = [...this.ownedDrafts];
    this.ownedDrafts.clear();
    const outcomes = await Promise.allSettled(
      projects.map((projectId) =>
        this.step("Release QA draft kernel", async () => {
          const scope = { kind: "draft", projectId };
          const session = draftKernelSession.parse(
            await this.action("get-notebook-kernel-session", { scope }),
          );
          if (session.state === "absent" || session.state === "stopped") return;
          const requestId = randomUUID();
          z.object({
            requestId: z.literal(requestId),
            generation: z.literal(String(BigInt(session.generation) + 1n)),
            state: z.literal("stopped"),
          }).parse(
            await this.action("control-notebook-kernel", {
              scope,
              operation: "stop",
              requestId,
              expectedGeneration: session.generation,
            }),
          );
        }),
      ),
    );
    return outcomes.every(({ status }) => status === "fulfilled");
  }

  url(path: string) {
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\"))
      throw new Error("Expected a mounted app path");
    const app = new URL(this.baseUrl);
    const href = new URL(`${this.baseUrl}${path}`);
    if (
      href.origin !== app.origin ||
      !href.pathname.startsWith(`${app.pathname.replace(/\/$/, "")}/`)
    )
      throw new Error("Path escapes the app mount");
    return href.href;
  }

  id(key: string, value: string) {
    if (
      !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(key) ||
      !/^[a-zA-Z0-9_:.\/-]{1,256}$/.test(value)
    )
      throw new Error("Evidence identities must be bounded opaque values");
    this.settings.evidence.ids[key] = value;
  }

  step<T>(label: string, run: () => Promise<T>) {
    return this.settings.evidence.step(label, run);
  }

  transition<T>(label: string, run: () => Promise<T>) {
    return this.settings.evidence.step(label, run, "transition");
  }

  oracle<T>(label: string, run: () => Promise<T>) {
    return this.settings.evidence.step(label, run, "oracle");
  }

  readback<T>(label: string, run: () => Promise<T>) {
    return this.settings.evidence.step(
      label,
      async () => {
        const first = this.settings.evidence.actions.length;
        const result = await run();
        if (
          !this.settings.evidence.actions
            .slice(first)
            .some((action) => action.status === 200)
        )
          throw new EvidenceFailure(
            "Independent readback recorded no successful action response",
          );
        return result;
      },
      "readback",
    );
  }

  rejecting<T>(label: string, run: () => Promise<T>) {
    return this.settings.evidence.step(label, run, "rejecting");
  }

  async open(path: string) {
    const response = await this.page.goto(this.url(path), {
      waitUntil: "domcontentloaded",
    });
    if (!response?.ok()) throw new Error("Mounted navigation failed");
    if (new URL(this.page.url()).origin !== new URL(this.baseUrl).origin)
      this.unavailable("signed-in UI session required");
  }

  async require(locator: Locator, label: string) {
    try {
      await locator.waitFor({ state: "visible", timeout: 8_000 });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError")
        this.missing(label);
      throw error;
    }
  }

  missing(label: string): never {
    throw new MissingCapability(label);
  }

  unavailable(reason: string): never {
    throw new UnavailableFixture(reason);
  }

  async workerFixture(operation: string, input: object): Promise<unknown> {
    return this.controlFixture(
      this.settings.workerFixtureUrl,
      "worker",
      operation,
      input,
    );
  }

  async modelFixture(operation: string, input: object): Promise<unknown> {
    if (!this.settings.modelFixtureUrl)
      return this.workerFixture(operation, input);
    return this.controlFixture(
      this.settings.modelFixtureUrl,
      "model",
      operation,
      input,
    );
  }

  private async controlFixture(
    address: string | undefined,
    fixture: "model" | "worker",
    operation: string,
    input: object,
  ): Promise<unknown> {
    if (!address)
      this.unavailable(
        `controlled ${fixture} fixture required for ${operation}`,
      );
    const response = await fetch(
      new URL(`/phase1/${fixture}-control`, address),
      {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation, ...input }),
        signal: AbortSignal.timeout(15_000),
      },
    ).catch(() =>
      this.unavailable(`controlled ${fixture} fixture is unreachable`),
    );
    if (!response.ok)
      throw new EvidenceFailure(
        `controlled ${fixture} fixture ${operation} returned HTTP ${response.status}`,
      );
    try {
      return await response.json();
    } catch {
      throw new EvidenceFailure(
        `controlled ${fixture} fixture ${operation} response is unreadable`,
      );
    }
  }

  async identity(actor: Actor = "owner") {
    try {
      const identity = shellSchema.parse(
        await this.action("get-workspace-shell", {}, actor),
      );
      this.settings.evidence.actorIds[actor] = createHash("sha256")
        .update(identity.user.id)
        .digest("hex");
      this.id(`${actor}WorkspaceId`, identity.workspace.id);
      return identity;
    } catch (error) {
      if (
        error instanceof ActionFailure &&
        [302, 303, 307, 308, 401, 403].includes(error.status)
      )
        this.unavailable(`signed-in ${actor} workspace session required`);
      throw error;
    }
  }

  private storage(actor: Actor) {
    if (actor === "owner") return this.settings.ownerInitialState;
    const path = this.settings.states[actor];
    if (!path) this.unavailable(`signed-in ${actor} storage state required`);
    return path;
  }

  private async coldStorage(actor: Actor): Promise<State> {
    const storage = this.storage(actor);
    if (typeof storage !== "string")
      return { cookies: storage.cookies, origins: [] };
    try {
      const state = JSON.parse(await readFile(storage, "utf8")) as State;
      if (!Array.isArray(state.cookies)) throw new Error("Cookies missing");
      return { cookies: state.cookies, origins: [] };
    } catch {
      return this.unavailable(`${actor} cold session state is unreadable`);
    }
  }

  private async requestAction(
    name: string,
    params: object,
    actor: Actor,
    uiOnly = false,
  ) {
    if (!/^[a-z][a-z0-9-]+$/.test(name)) throw new Error("Invalid action name");
    const storageState =
      actor === "owner"
        ? await this.page.context().storageState()
        : this.storage(actor);
    const api = await request
      .newContext({ storageState })
      .catch(() => this.unavailable(`${actor} action session is unreadable`));
    try {
      const endpoint = this.url(`/_agent-native/actions/${name}`);
      const originHeaders = {
        origin: new URL(endpoint).origin,
        "sec-fetch-site": "same-origin",
      };
      const headers = {
        "x-agent-native-frontend": "1",
        "x-agent-native-csrf": "1",
        "cache-control": "no-cache",
        ...(uiOnly && originHeaders),
      };
      if (uiOnly) {
        const capabilityUrl = this.url("/_agent-native/ui-capability");
        const capability = await api.get(capabilityUrl, {
          headers: originHeaders,
          maxRedirects: 0,
        });
        try {
          if (!capability.ok())
            throw new Error(
              `Could not establish the browser UI capability (HTTP ${capability.status()})`,
            );
        } finally {
          await capability.dispose();
        }
      }
      const send = async (
        method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
      ) => {
        const started = performance.now();
        const response = await api.fetch(endpoint, {
          method,
          headers: {
            ...headers,
            ...(this.compatibility && {
              "x-agent-native-client-compatibility": this.compatibility,
            }),
          },
          timeout: 60_000,
          maxRedirects: 0,
          ...(method === "GET"
            ? {
                params: new URLSearchParams(
                  Object.entries(params).map(([key, value]) => [
                    key,
                    typeof value === "object"
                      ? JSON.stringify(value)
                      : String(value),
                  ]),
                ),
              }
            : { data: params }),
        });
        try {
          const status = response.status();
          const responseHeaders = response.headers();
          const trace =
            responseHeaders["x-request-id"] ?? responseHeaders["x-trace-id"];
          const traceId =
            trace && /^[a-z0-9_-]{8,100}$/i.test(trace) ? trace : undefined;
          this.settings.evidence.actions.push({
            name,
            actor,
            method,
            status,
            elapsedMs: performance.now() - started,
            ...(traceId && { traceId }),
          });
          let body: unknown;
          if (responseHeaders["content-type"]?.includes("json"))
            body = await response.json();
          const compatibility =
            status === 409 &&
            responseHeaders["x-agent-native-client-mismatch"] === "1"
              ? responseHeaders["x-agent-native-client-compatibility"]
              : undefined;
          return {
            status,
            body,
            error: errorSchema.safeParse(body).data,
            compatibility,
          };
        } finally {
          await response.dispose();
        }
      };
      const call = async (method: Parameters<typeof send>[0]) => {
        const result = await send(method);
        if (
          result.compatibility &&
          /^[a-z0-9._-]{1,100}$/i.test(result.compatibility) &&
          result.compatibility !== this.compatibility
        ) {
          this.compatibility = result.compatibility;
          return send(method);
        }
        return result;
      };
      let result = await call("POST");
      if (result.status === 405) {
        const method = result.error?.error?.match(
          /^Method not allowed\. Use (GET|PATCH|PUT|DELETE)\.$/,
        )?.[1];
        if (
          method === "GET" ||
          method === "PATCH" ||
          method === "PUT" ||
          method === "DELETE"
        )
          result = await call(method);
      }
      if (
        result.status === 404 &&
        !result.error?.errorCode &&
        (!result.error?.error ||
          /^(?:Not Found|Route not found)$/i.test(result.error.error))
      )
        this.missing(`registered action ${name}`);
      return result;
    } finally {
      await api.dispose();
    }
  }

  async action<T>(
    name: string,
    params: object = {},
    actor: Actor = "owner",
  ): Promise<T> {
    const result = await this.requestAction(name, params, actor);
    if (result.status !== 200 || result.body === undefined)
      throw new ActionFailure(name, result.status);
    return result.body as T;
  }

  async rejectAction(
    name: string,
    params: object,
    expected: RegExp | number,
    actor: Actor = "owner",
    { uiOnly = false } = {},
  ) {
    await this.rejecting(`${name} rejects as ${actor}`, async () => {
      const { status, error } = await this.requestAction(
        name,
        params,
        actor,
        uiOnly,
      );
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(500);
      if (typeof expected === "number") expect(status).toBe(expected);
      else
        expect(
          [error?.errorCode, error?.error].filter(Boolean).join(" "),
        ).toMatch(expected);
    });
  }

  async withActor<T>(
    actor: Exclude<Actor, "owner">,
    run: (page: Page) => Promise<T>,
  ) {
    const context = await this.settings.browser.newContext(
      contextOptions(this.storage(actor)),
    );
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      return await run(page);
    } finally {
      await context.close();
    }
  }

  async cold(
    label: string,
    read: (page: Page) => Promise<void>,
    actor: Actor = "owner",
  ) {
    await this.settings.evidence.step(
      label,
      async () => {
        const context = await this.settings.browser.newContext(
          contextOptions(await this.coldStorage(actor)),
        );
        try {
          const page = await context.newPage();
          page.setDefaultTimeout(15_000);
          await read(page);
          await this.screenshot(label, page);
        } finally {
          await context.close();
        }
      },
      "cold",
    );
  }

  async screenshot(label: string, page = this.page) {
    const filename = `${this.settings.flowId}-${this.settings.evidence.screenshots.length + 1}-${label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 60)}.png`;
    await page.screenshot({
      path: resolve(this.settings.evidenceDir, filename),
      timeout: 5_000,
      animations: "disabled",
      mask: [
        page.locator('input[type="password"], input[type="file"]'),
        ...(this.settings.flowId === "01-connect-warehouse"
          ? [page.locator("textarea")]
          : []),
      ],
    });
    this.settings.evidence.screenshots.push(filename);
  }
}

export const newFlowContext = (browser: Browser, storageState?: string) =>
  browser.newContext(contextOptions(storageState));
