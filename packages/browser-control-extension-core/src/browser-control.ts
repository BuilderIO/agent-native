// This service is shared by browser-extension hosts; transports stay outside it.
import {
  attachDebugger,
  createBackgroundTab,
  detachDebugger,
  getTab,
  isDebuggerNotAttachedError,
  removeTab,
  sendDebuggerCommand,
  type DebuggerSource,
} from "./chrome-debugger";
import { assertUrlAllowed, ProtocolValidationError } from "./policy";
import type {
  BrowserCommand,
  BrowserKey,
  BrowserModifier,
  NativeRequest,
} from "./protocol";

const SESSION_STORAGE_KEY = "agentNativeBrowserTaskSessions";
const TEARDOWN_STORAGE_KEY = "agentNativeBrowserPendingTeardowns";

type TaskSession = {
  taskId: string;
  tabId: number;
  allowedOrigins: Set<string>;
  observation?: BrowserObservation;
};

type StoredTaskSession = Omit<TaskSession, "allowedOrigins"> & {
  allowedOrigins: string[];
};
type StoredTeardown = { taskId: string; tabId: number };
type PendingAttach = {
  taskId: string;
  tabId: number;
  debuggerAttachStarted: boolean;
  debuggerAttached: boolean;
  externalDetachObserved: boolean;
  rawAttachSettled: boolean;
  teardownRequested: boolean;
};

type AxValue = { value?: unknown };
type AxNode = {
  nodeId?: string;
  ignored?: boolean;
  role?: AxValue;
  name?: AxValue;
  value?: AxValue;
  description?: AxValue;
  backendDOMNodeId?: number;
  childIds?: string[];
  properties?: Array<{ name?: string; value?: AxValue }>;
};

type AxTreeResult = { nodes?: AxNode[] };
type ScreenshotResult = { data?: string };
type LayoutMetricsResult = {
  cssVisualViewport?: { clientWidth?: number; clientHeight?: number };
};
type BoxModelResult = { model?: { border?: number[]; content?: number[] } };
type BrowserObservation = {
  id: string;
  targets: Map<number, { role?: unknown; name?: unknown }>;
};
type PressedKey = {
  key: string;
  code: string;
  windowsVirtualKeyCode: number;
  nativeVirtualKeyCode: number;
  modifiers: number;
};

const MAX_SCREENSHOT_BASE64_CHARS = 4 * 1024 * 1024;
const MAX_SCREENSHOT_DIMENSION = 4_096;

export class BrowserControlError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function source(tabId: number): DebuggerSource {
  return { tabId };
}

function modifierMask(modifiers: BrowserModifier[] = []): number {
  return modifiers.reduce((mask, modifier) => {
    if (modifier === "alt") return mask | 1;
    if (modifier === "control") return mask | 2;
    if (modifier === "meta") return mask | 4;
    return mask | 8;
  }, 0);
}

const KEY_DATA: Record<
  BrowserKey,
  { key: string; code: string; keyCode: number }
> = {
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  Delete: { key: "Delete", code: "Delete", keyCode: 46 },
  End: { key: "End", code: "End", keyCode: 35 },
  Enter: { key: "Enter", code: "Enter", keyCode: 13 },
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Home: { key: "Home", code: "Home", keyCode: 36 },
  PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 },
  Space: { key: " ", code: "Space", keyCode: 32 },
  Tab: { key: "Tab", code: "Tab", keyCode: 9 },
};

function cleanAxValue(value: AxValue | undefined): unknown {
  const inner = value?.value;
  return typeof inner === "string" ||
    typeof inner === "number" ||
    typeof inner === "boolean"
    ? inner
    : undefined;
}

function cleanAxNode(node: AxNode): Record<string, unknown> {
  const properties = (node.properties ?? [])
    .slice(0, 40)
    .flatMap((property) => {
      const value = cleanAxValue(property.value);
      return property.name && value !== undefined
        ? [{ name: property.name, value }]
        : [];
    });
  return {
    nodeId: node.nodeId,
    ignored: node.ignored === true,
    role: cleanAxValue(node.role),
    name: cleanAxValue(node.name),
    value: cleanAxValue(node.value),
    description: cleanAxValue(node.description),
    backendNodeId: node.backendDOMNodeId,
    childIds: node.childIds?.slice(0, 200),
    properties,
  };
}

function centerOfBox(result: BoxModelResult): { x: number; y: number } {
  const quad = result.model?.border ?? result.model?.content;
  if (!quad || quad.length < 8)
    throw new BrowserControlError(
      "TARGET_NOT_VISIBLE",
      "Target has no visible box.",
    );
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  return {
    x: xs.reduce((sum, value) => sum + value, 0) / xs.length,
    y: ys.reduce((sum, value) => sum + value, 0) / ys.length,
  };
}

async function releaseInjectedInput(
  tabId: number,
  pressedKeys: Iterable<PressedKey>,
): Promise<void> {
  const debuggee = source(tabId);
  const results = await Promise.allSettled([
    ...(["left", "middle", "right"] as const).map((button) =>
      sendDebuggerCommand(debuggee, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: 0,
        y: 0,
        button,
        clickCount: 0,
      }),
    ),
    ...[
      { key: "Alt", code: "AltLeft", keyCode: 18 },
      { key: "Control", code: "ControlLeft", keyCode: 17 },
      { key: "Meta", code: "MetaLeft", keyCode: 91 },
      { key: "Shift", code: "ShiftLeft", keyCode: 16 },
    ].map(({ key, code, keyCode }) =>
      sendDebuggerCommand(debuggee, "Input.dispatchKeyEvent", {
        type: "keyUp",
        key,
        code,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
        modifiers: 0,
      }),
    ),
    ...[...pressedKeys].map((pressedKey) =>
      sendDebuggerCommand(debuggee, "Input.dispatchKeyEvent", {
        type: "keyUp",
        ...pressedKey,
      }),
    ),
  ]);
  const errors = results.flatMap((result) =>
    result.status === "rejected"
      ? (() => {
          const error =
            result.reason instanceof Error
              ? result.reason
              : new Error(String(result.reason));
          return isDebuggerNotAttachedError(error.message) ? [] : [error];
        })()
      : [],
  );
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, "Could not release injected input.");
  }
}

export class BrowserControlService {
  private readonly sessions = new Map<string, TaskSession>();
  private readonly tabOwners = new Map<number, string>();
  private readonly tabReservations = new Map<number, string>();
  private readonly teardownTabs = new Set<number>();
  private readonly teardownOwners = new Map<number, string>();
  private readonly teardownOperations = new Map<
    number,
    Promise<Error | undefined>
  >();
  private readonly pendingAttaches = new Map<number, PendingAttach>();
  private readonly pendingAttachOperations = new Map<
    string,
    Set<Promise<unknown>>
  >();
  private readonly pendingDebuggerAttachOperations = new Map<
    string,
    Set<Promise<void>>
  >();
  private readonly pendingAttachTeardownOperations = new Map<
    string,
    Set<Promise<Error | undefined>>
  >();
  private readonly pendingTabCreations = new Map<
    string,
    Set<Promise<chrome.tabs.Tab>>
  >();
  private readonly pendingTabCleanups = new Map<string, Set<Promise<void>>>();
  private readonly pendingInputOperations = new Map<
    number,
    Set<Promise<unknown>>
  >();
  private readonly pressedKeys = new Map<number, Map<string, PressedKey>>();
  private readonly taskCancellationWaiters = new Map<
    string,
    Map<number, Set<() => void>>
  >();
  private readonly taskGenerations = new Map<string, number>();
  private readonly taskOperationCounts = new Map<string, number>();
  private readonly taskTeardowns = new Set<string>();
  private readonly taskQueues = new Map<string, Promise<unknown>>();
  private stateQueue: Promise<void> = Promise.resolve();
  private persistQueue: Promise<void> = Promise.resolve();
  private emergencyStopPromise: Promise<void> | undefined;

  get activeTaskCount(): number {
    return this.sessions.size;
  }

  async restore(): Promise<void> {
    const stored = await chrome.storage.session.get([
      SESSION_STORAGE_KEY,
      TEARDOWN_STORAGE_KEY,
    ]);
    const pendingTeardowns = stored[TEARDOWN_STORAGE_KEY];
    const pendingTaskIds = new Set<string>();
    if (Array.isArray(pendingTeardowns)) {
      for (const candidate of pendingTeardowns as StoredTeardown[]) {
        if (
          candidate &&
          typeof candidate.taskId === "string" &&
          Number.isInteger(candidate.tabId)
        ) {
          this.beginTeardown(candidate.tabId, candidate.taskId);
          pendingTaskIds.add(candidate.taskId);
        }
      }
    }
    const candidates = stored[SESSION_STORAGE_KEY];
    if (Array.isArray(candidates)) {
      for (const candidate of candidates as StoredTaskSession[]) {
        if (
          !candidate ||
          typeof candidate.taskId !== "string" ||
          !Number.isInteger(candidate.tabId) ||
          !Array.isArray(candidate.allowedOrigins)
        ) {
          continue;
        }
        if (this.teardownOwners.has(candidate.tabId)) continue;
        const session: TaskSession = {
          taskId: candidate.taskId,
          tabId: candidate.tabId,
          allowedOrigins: new Set(candidate.allowedOrigins),
        };
        try {
          await sendDebuggerCommand(source(session.tabId), "Page.getFrameTree");
          await this.assertSessionAllowed(session);
          this.sessions.set(session.taskId, session);
          this.tabOwners.set(session.tabId, session.taskId);
        } catch {
          this.beginTeardown(session.tabId, session.taskId);
          pendingTaskIds.add(session.taskId);
          try {
            const teardownError = await this.teardownDebugger(
              session.tabId,
              session.taskId,
            );
            if (teardownError) {
              console.warn(
                "[browser-control] stale restored session cleanup is still pending",
                {
                  tabId: session.tabId,
                  taskId: session.taskId,
                  error: teardownError,
                },
              );
            }
          } catch (cleanupError) {
            console.warn(
              "[browser-control] stale restored session cleanup failed",
              {
                tabId: session.tabId,
                taskId: session.taskId,
                error: cleanupError,
              },
            );
          }
        }
      }
    }
    for (const taskId of pendingTaskIds) {
      try {
        await this.retryPendingTeardown(taskId);
      } catch (error) {
        console.warn(
          "[browser-control] restored pending teardown remains unresolved",
          { taskId, error },
        );
      }
    }
    await this.persist();
  }

  execute(request: NativeRequest): Promise<unknown> {
    if (this.emergencyStopPromise) {
      return Promise.reject(
        new BrowserControlError(
          "BROWSER_STOPPING",
          "Chrome control is stopping; retry after it completes.",
        ),
      );
    }
    if (request.command.type === "stop" || request.command.type === "detach") {
      this.retainTask(request.taskId);
      const result = this.executeCommand(request.taskId, request.command);
      void result.then(
        () => this.releaseTask(request.taskId),
        () => this.releaseTask(request.taskId),
      );
      return result;
    }
    const expectedGeneration = this.taskGeneration(request.taskId);
    this.retainTask(request.taskId);
    const previous = this.taskQueues.get(request.taskId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() =>
        this.executeCommand(
          request.taskId,
          request.command,
          expectedGeneration,
        ),
      );
    this.taskQueues.set(request.taskId, next);
    const clearTaskQueue = () => {
      if (this.taskQueues.get(request.taskId) === next)
        this.taskQueues.delete(request.taskId);
      this.releaseTask(request.taskId);
    };
    void next.then(clearTaskQueue, clearTaskQueue);
    return next;
  }

  async emergencyStopAll(): Promise<void> {
    const existing = this.emergencyStopPromise;
    if (existing) return existing;
    const operation = this.performEmergencyStop();
    this.emergencyStopPromise = operation;
    try {
      await operation;
    } finally {
      if (this.emergencyStopPromise === operation) {
        this.emergencyStopPromise = undefined;
      }
    }
  }

  private async performEmergencyStop(): Promise<void> {
    const sessions = [...this.sessions.values()];
    const pendingOperations = [...this.taskQueues.entries()];
    const pendingTabCreations = [...this.pendingTabCreations.values()].flatMap(
      (operations) => [...operations],
    );
    const pendingTeardownTaskIds = new Set(this.teardownOwners.values());
    const existingTeardowns = new Map(this.teardownOperations);
    const pendingAttaches = [...this.pendingAttaches.values()];
    const taskIds = new Set([
      ...this.taskGenerations.keys(),
      ...this.tabReservations.values(),
      ...sessions.map((session) => session.taskId),
      ...this.teardownOwners.values(),
      ...pendingAttaches.map((pending) => pending.taskId),
      ...[...this.pendingTabCreations.keys()],
    ]);
    for (const taskId of taskIds) this.invalidateTask(taskId);
    for (const session of sessions) {
      this.beginTeardown(session.tabId, session.taskId);
    }
    for (const pending of pendingAttaches) {
      if (pending.debuggerAttachStarted && !pending.externalDetachObserved) {
        void this.scheduleLateAttachTeardown(pending);
      }
    }
    this.sessions.clear();
    this.tabOwners.clear();
    this.taskQueues.clear();

    await this.drainPendingAttachOperationsForTasks(taskIds);

    const tabsToTeardown = new Set([
      ...this.teardownOwners.keys(),
      ...sessions.map((session) => session.tabId),
    ]);

    const teardownOperations = [...tabsToTeardown].flatMap((tabId) => {
      const taskId = this.teardownOwners.get(tabId);
      if (!taskId || existingTeardowns.has(tabId)) return [];
      return [this.teardownDebugger(tabId, taskId)];
    });
    for (const [tabId, operation] of existingTeardowns) {
      void operation.then(
        () => this.persist().catch(() => undefined),
        () => this.persist().catch(() => undefined),
      );
      if (!this.teardownOwners.has(tabId)) {
        this.finishTeardown(tabId);
      }
    }
    await Promise.allSettled(teardownOperations);
    await this.persist();

    const operationsToAwait = pendingOperations
      .filter(([taskId]) => !pendingTeardownTaskIds.has(taskId))
      .map(([, operation]) => operation);
    await Promise.allSettled(pendingTabCreations);
    await Promise.allSettled(operationsToAwait);
    await this.drainPendingAttachOperationsForTasks(taskIds);
    await this.persist();
    for (const taskId of taskIds) this.maybeReclaimTaskGeneration(taskId);
  }

  async handleDebuggerDetach(tabId: number): Promise<void> {
    const ownerTaskId = this.tabOwners.get(tabId);
    const reservationTaskId = this.tabReservations.get(tabId);
    const teardownTaskId = this.teardownOwners.get(tabId);
    const pendingAttach = this.pendingAttaches.get(tabId);
    const taskIds = new Set(
      [
        ownerTaskId,
        reservationTaskId,
        teardownTaskId,
        pendingAttach?.taskId,
      ].filter((taskId): taskId is string => Boolean(taskId)),
    );
    if (pendingAttach) {
      pendingAttach.externalDetachObserved = true;
      pendingAttach.debuggerAttached = false;
    }
    for (const taskId of new Set([
      ownerTaskId,
      reservationTaskId,
      pendingAttach?.taskId,
    ])) {
      if (taskId) this.invalidateTask(taskId);
    }
    if (ownerTaskId) {
      this.tabOwners.delete(tabId);
      const session = this.sessions.get(ownerTaskId);
      if (session?.tabId === tabId) this.sessions.delete(ownerTaskId);
    }
    if (reservationTaskId) this.tabReservations.delete(tabId);
    if (teardownTaskId) this.finishTeardown(tabId);
    if (taskIds.size === 0) return;
    await this.enqueueState(() => this.persist());
    for (const taskId of taskIds) this.maybeReclaimTaskGeneration(taskId);
  }

  async enforceTabOrigin(
    tabId: number,
    url: string | undefined,
  ): Promise<void> {
    const taskId = this.tabOwners.get(tabId);
    const session = taskId ? this.sessions.get(taskId) : undefined;
    if (!taskId || !session || !url) return;
    try {
      assertUrlAllowed(url, session.allowedOrigins);
    } catch {
      await this.detach(taskId);
    }
  }

  private async executeCommand(
    taskId: string,
    command: BrowserCommand,
    expectedGeneration?: number,
  ): Promise<unknown> {
    switch (command.type) {
      case "attach":
        return this.attach(
          taskId,
          command.tabId,
          command.allowedOrigins,
          undefined,
          expectedGeneration,
        );
      case "detach":
      case "stop":
        await this.detach(taskId);
        return { detached: true };
      case "observe":
        return this.observe(
          taskId,
          command.includeScreenshot ?? true,
          command.maxNodes ?? 400,
          expectedGeneration,
        );
      case "click":
        return this.click(
          taskId,
          command.target,
          command.button ?? "left",
          expectedGeneration,
        );
      case "type":
        return this.type(
          taskId,
          command.target,
          command.text,
          command.replace ?? false,
          expectedGeneration,
        );
      case "key":
        return this.key(
          taskId,
          command.key,
          command.modifiers,
          expectedGeneration,
        );
      case "navigate":
        return this.navigate(taskId, command.url, expectedGeneration);
      case "open-tab":
        return this.openTab(taskId, command.url, expectedGeneration);
      case "scroll":
        return this.scroll(
          taskId,
          command.deltaX,
          command.deltaY,
          command.x ?? 0,
          command.y ?? 0,
          expectedGeneration,
        );
    }
  }

  private async attach(
    taskId: string,
    tabId: number,
    origins: string[],
    expectedSession?: TaskSession,
    expectedGenerationOverride?: number,
  ): Promise<{ tabId: number; origin: string }> {
    const expectedGeneration =
      expectedGenerationOverride ?? this.taskGeneration(taskId);
    this.assertAttachActive(taskId, expectedSession, expectedGeneration);
    this.assertTabAvailable(taskId, tabId);
    const pendingAttach: PendingAttach = {
      taskId,
      tabId,
      debuggerAttachStarted: false,
      debuggerAttached: false,
      externalDetachObserved: false,
      rawAttachSettled: false,
      teardownRequested: false,
    };
    this.pendingAttaches.set(tabId, pendingAttach);
    const operation = this.enqueueState(async () => {
      this.assertAttachActive(taskId, expectedSession, expectedGeneration);
      this.assertTabAvailable(taskId, tabId);
      let previous = this.sessions.get(taskId);
      if (previous?.tabId === tabId) {
        this.sessions.delete(taskId);
        this.tabOwners.delete(tabId);
        this.beginTeardown(tabId, taskId);
        const teardownError = await this.teardownDebugger(tabId, taskId);
        if (teardownError) throw teardownError;
        await this.persist();
        this.assertAttachActive(taskId, expectedSession, expectedGeneration);
        previous = undefined;
      }
      const session: TaskSession = {
        taskId,
        tabId,
        allowedOrigins: new Set(origins),
      };
      const hadReservation = this.tabReservations.get(tabId) === taskId;
      if (!hadReservation) this.tabReservations.set(tabId, taskId);
      const previousSessions = new Map(this.sessions);
      let debuggerAttached = false;
      let stagedPersisted = false;
      let previousTeardownStarted = false;
      try {
        await this.assertSessionAllowed(session, taskId, expectedGeneration);
        this.assertAttachActive(taskId, expectedSession, expectedGeneration);
        pendingAttach.debuggerAttachStarted = true;
        const attachOperation = attachDebugger(source(tabId));
        this.trackPendingOperation(
          this.pendingDebuggerAttachOperations,
          taskId,
          attachOperation,
        );
        void attachOperation.then(
          () => {
            pendingAttach.rawAttachSettled = true;
            if (!pendingAttach.externalDetachObserved) {
              pendingAttach.debuggerAttached = true;
            }
            if (
              !pendingAttach.externalDetachObserved &&
              (this.taskGeneration(taskId) !== expectedGeneration ||
                pendingAttach.teardownRequested)
            ) {
              void this.scheduleLateAttachTeardown(pendingAttach);
            }
          },
          () => {
            pendingAttach.rawAttachSettled = true;
            if (pendingAttach.teardownRequested) {
              this.finishTeardown(tabId);
              void this.persist().catch(() => undefined);
            }
          },
        );
        await this.withTaskCancellation(
          taskId,
          expectedGeneration,
          () => attachOperation,
        );
        pendingAttach.debuggerAttached = true;
        debuggerAttached = true;
        this.assertAttachActive(taskId, expectedSession, expectedGeneration);
        await this.sendCommand(
          taskId,
          expectedGeneration,
          tabId,
          "Page.enable",
        );
        this.assertAttachActive(taskId, expectedSession, expectedGeneration);
        await this.sendCommand(
          taskId,
          expectedGeneration,
          tabId,
          "Accessibility.enable",
        );
        const currentTab = await this.assertSessionAllowed(
          session,
          taskId,
          expectedGeneration,
        );
        this.assertAttachActive(taskId, expectedSession, expectedGeneration);
        this.assertTabAvailable(taskId, tabId);
        const stagedSessions = new Map(previousSessions);
        stagedSessions.set(taskId, session);
        if (previous && previous.tabId !== tabId) {
          previousTeardownStarted = true;
          this.beginTeardown(previous.tabId, taskId);
        }
        await this.persist(stagedSessions.values());
        stagedPersisted = true;
        const committedTab = await this.assertSessionAllowed(
          session,
          taskId,
          expectedGeneration,
        );
        this.assertAttachActive(taskId, expectedSession, expectedGeneration);
        this.assertTabAvailable(taskId, tabId);
        if (previous && previous.tabId !== tabId) {
          this.tabOwners.delete(previous.tabId);
        }
        this.sessions.set(taskId, session);
        this.tabOwners.set(tabId, taskId);
        if (previous && previous.tabId !== tabId) {
          const teardownError = await this.teardownDebugger(
            previous.tabId,
            taskId,
          );
          if (teardownError) {
            console.warn(
              "[browser-control] retaining a superseded tab until debugger teardown succeeds",
              { tabId: previous.tabId, taskId, error: teardownError },
            );
          }
          await this.persist();
        }
        this.assertTaskGeneration(taskId, expectedGeneration);
        this.assertSessionCurrent(taskId, session);
        return {
          tabId,
          origin: new URL(committedTab.url ?? currentTab.url!).origin,
        };
      } catch (error) {
        if (this.sessions.get(taskId) === session) {
          this.sessions.delete(taskId);
          this.tabOwners.delete(tabId);
          if (
            previous &&
            previousSessions.get(taskId) === previous &&
            !previousTeardownStarted
          ) {
            this.sessions.set(taskId, previous);
            this.tabOwners.set(previous.tabId, taskId);
          }
        }
        const shouldTeardown =
          !pendingAttach.externalDetachObserved &&
          (debuggerAttached ||
            (pendingAttach.debuggerAttachStarted &&
              this.isTaskCancellation(error)));
        const teardownOperation = shouldTeardown
          ? this.scheduleLateAttachTeardown(pendingAttach)
          : undefined;
        const rollbackErrors: unknown[] = [];
        if (stagedPersisted || shouldTeardown) {
          try {
            await this.persist(this.sessions.values());
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError);
          }
        }
        if (teardownOperation) {
          const teardownError = await teardownOperation;
          if (teardownError) rollbackErrors.push(teardownError);
          try {
            await this.persist(this.sessions.values());
          } catch (persistError) {
            rollbackErrors.push(persistError);
          }
        }
        if (rollbackErrors.length > 0) {
          throw new AggregateError(
            [error, ...rollbackErrors],
            "Chrome attach rollback failed.",
          );
        }
        throw error;
      } finally {
        if (!hadReservation && this.tabReservations.get(tabId) === taskId) {
          this.tabReservations.delete(tabId);
        }
      }
    });
    this.trackPendingOperation(this.pendingAttachOperations, taskId, operation);
    void operation.then(
      () => {
        if (this.pendingAttaches.get(tabId) === pendingAttach) {
          this.pendingAttaches.delete(tabId);
        }
      },
      () => {
        if (this.pendingAttaches.get(tabId) === pendingAttach) {
          this.pendingAttaches.delete(tabId);
        }
      },
    );
    return operation;
  }

  private async detach(taskId: string): Promise<void> {
    const pendingAttachOperations = [
      ...(this.pendingAttachOperations.get(taskId) ?? []),
    ];
    this.invalidateTask(taskId);
    for (const pendingAttach of this.pendingAttaches.values()) {
      if (pendingAttach.taskId === taskId) {
        void this.scheduleLateAttachTeardown(pendingAttach);
      }
    }
    this.taskQueues.delete(taskId);
    const session = this.sessions.get(taskId);
    if (!session) {
      await Promise.allSettled(pendingAttachOperations);
      await this.drainPendingAttachOperations(taskId);
      const errors = await this.drainPendingTabOperations(taskId);
      if ([...this.teardownOwners.values()].some((owner) => owner === taskId)) {
        errors.push(...(await this.retryPendingTeardownInState(taskId)));
      }
      await this.persist();
      this.maybeReclaimTaskGeneration(taskId);
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(errors, "Chrome teardown failed.");
      }
      return;
    }
    this.sessions.delete(taskId);
    this.tabOwners.delete(session.tabId);
    this.beginTeardown(session.tabId, taskId);
    await Promise.allSettled(pendingAttachOperations);
    await this.drainPendingAttachOperations(taskId);
    const errors = await this.drainPendingTabOperations(taskId);
    if (this.teardownOwners.get(session.tabId) === taskId) {
      const teardownError = await this.teardownDebugger(session.tabId, taskId);
      if (teardownError) errors.push(teardownError);
    }
    errors.push(
      ...(await this.retryPendingTeardownInState(taskId, session.tabId)),
    );
    await this.persist();
    this.maybeReclaimTaskGeneration(taskId);
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, "Chrome teardown failed.");
    }
  }

  private async retryPendingTeardown(taskId: string): Promise<void> {
    await this.enqueueState(async () => {
      const errors = await this.retryPendingTeardownInState(taskId);
      await this.persist();
      this.maybeReclaimTaskGeneration(taskId);
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(errors, "Chrome teardown failed.");
      }
    });
  }

  private async retryPendingTeardownInState(
    taskId: string,
    excludedTabId?: number,
  ): Promise<Error[]> {
    const pendingTabs = [...this.teardownOwners.entries()]
      .filter(([tabId, owner]) => owner === taskId && tabId !== excludedTabId)
      .map(([tabId]) => tabId);
    return (
      await Promise.all(
        pendingTabs.map((tabId) => this.teardownDebugger(tabId, taskId)),
      )
    ).flatMap((error) => (error ? [error] : []));
  }

  private async drainPendingAttachOperations(taskId: string): Promise<void> {
    for (;;) {
      const operations: Promise<unknown>[] = [
        ...(this.pendingDebuggerAttachOperations.get(taskId) ?? []),
        ...(this.pendingAttachTeardownOperations.get(taskId) ?? []),
      ];
      if (operations.length === 0) return;
      await Promise.allSettled(operations);
    }
  }

  private async drainPendingAttachOperationsForTasks(
    taskIds: Iterable<string>,
  ): Promise<void> {
    await Promise.all(
      [...new Set(taskIds)].map((taskId) =>
        this.drainPendingAttachOperations(taskId),
      ),
    );
  }

  private async settleStopOperations(
    operations: Iterable<Promise<unknown>>,
  ): Promise<Error[]> {
    const results = await Promise.allSettled(operations);
    return results.flatMap((result) => {
      if (
        result.status !== "rejected" ||
        this.isTaskCancellation(result.reason)
      )
        return [];
      return [
        result.reason instanceof Error
          ? result.reason
          : new Error(String(result.reason)),
      ];
    });
  }

  private async drainPendingTabOperations(taskId: string): Promise<Error[]> {
    const errors: Error[] = [];
    for (;;) {
      const operations: Promise<unknown>[] = [
        ...(this.pendingTabCreations.get(taskId) ?? []),
        ...(this.pendingTabCleanups.get(taskId) ?? []),
      ];
      if (operations.length === 0) return errors;
      errors.push(...(await this.settleStopOperations(operations)));
    }
  }

  private trackPendingInputOperation(
    tabId: number,
    operation: Promise<unknown>,
  ): void {
    const operations =
      this.pendingInputOperations.get(tabId) ?? new Set<Promise<unknown>>();
    operations.add(operation);
    this.pendingInputOperations.set(tabId, operations);
    const cleanup = () => {
      operations.delete(operation);
      if (
        operations.size === 0 &&
        this.pendingInputOperations.get(tabId) === operations
      ) {
        this.pendingInputOperations.delete(tabId);
      }
    };
    void operation.then(cleanup, cleanup);
  }

  private trackInputOperation<T>(
    tabId: number,
    method: string,
    params: Record<string, unknown>,
    operation: Promise<T>,
  ): Promise<T> {
    if (method !== "Input.dispatchKeyEvent") {
      this.trackPendingInputOperation(tabId, operation);
      return operation;
    }
    const key =
      typeof params.key === "string" &&
      typeof params.code === "string" &&
      typeof params.windowsVirtualKeyCode === "number" &&
      typeof params.nativeVirtualKeyCode === "number" &&
      typeof params.modifiers === "number"
        ? {
            key: params.key,
            code: params.code,
            windowsVirtualKeyCode: params.windowsVirtualKeyCode,
            nativeVirtualKeyCode: params.nativeVirtualKeyCode,
            modifiers: params.modifiers,
          }
        : undefined;
    const settledOperation = operation.then((result) => {
      if (key) {
        const keys =
          this.pressedKeys.get(tabId) ?? new Map<string, PressedKey>();
        if (params.type === "keyDown") {
          keys.set(key.code, key);
          this.pressedKeys.set(tabId, keys);
        } else if (params.type === "keyUp") {
          keys.delete(key.code);
          if (keys.size === 0) this.pressedKeys.delete(tabId);
        }
      }
      return result;
    });
    this.trackPendingInputOperation(tabId, settledOperation);
    return settledOperation;
  }

  private async drainPendingInputOperations(tabId: number): Promise<void> {
    for (;;) {
      const operations = [...(this.pendingInputOperations.get(tabId) ?? [])];
      if (operations.length === 0) return;
      await Promise.allSettled(operations);
    }
  }

  private getSession(taskId: string): TaskSession {
    const session = this.sessions.get(taskId);
    if (!session)
      throw new BrowserControlError(
        "TASK_NOT_ATTACHED",
        "This task has not attached a Chrome tab.",
      );
    return session;
  }

  private assertExpectedSession(
    taskId: string,
    expectedSession: TaskSession | undefined,
  ): void {
    if (expectedSession && this.sessions.get(taskId) !== expectedSession) {
      throw new BrowserControlError(
        "TASK_HANDOFF_CANCELLED",
        "The Chrome tab handoff was cancelled before it completed.",
      );
    }
  }

  private assertSessionCurrent(taskId: string, session: TaskSession): void {
    if (this.sessions.get(taskId) !== session) {
      throw new BrowserControlError(
        "TASK_HANDOFF_CANCELLED",
        "The Chrome tab handoff was cancelled before it completed.",
      );
    }
  }

  private async assertSessionAllowed(
    session: TaskSession,
    taskId?: string,
    expectedGeneration?: number,
  ): Promise<chrome.tabs.Tab> {
    const tab = await this.withTaskCancellation(
      taskId ?? session.taskId,
      expectedGeneration,
      () => getTab(session.tabId),
    );
    if (!tab.url)
      throw new BrowserControlError(
        "TAB_URL_UNAVAILABLE",
        "Chrome did not expose the tab URL.",
      );
    try {
      assertUrlAllowed(tab.url, session.allowedOrigins);
    } catch (error) {
      if (error instanceof ProtocolValidationError) {
        throw new BrowserControlError("ORIGIN_NOT_ALLOWED", error.message);
      }
      throw error;
    }
    return tab;
  }

  private assertAttachActive(
    taskId: string,
    expectedSession: TaskSession | undefined,
    expectedGeneration: number,
  ): void {
    this.assertExpectedSession(taskId, expectedSession);
    this.assertTaskGeneration(taskId, expectedGeneration);
  }

  private assertTaskGeneration(
    taskId: string,
    expectedGeneration: number,
  ): void {
    if (this.taskGeneration(taskId) !== expectedGeneration) {
      throw new BrowserControlError(
        "TASK_HANDOFF_CANCELLED",
        "The Chrome tab handoff was cancelled before it completed.",
      );
    }
  }

  private taskGeneration(taskId: string): number {
    return this.taskGenerations.get(taskId) ?? 0;
  }

  private retainTask(taskId: string): void {
    this.taskOperationCounts.set(
      taskId,
      (this.taskOperationCounts.get(taskId) ?? 0) + 1,
    );
    if (!this.taskGenerations.has(taskId))
      this.taskGenerations.set(taskId, this.taskGeneration(taskId));
  }

  private releaseTask(taskId: string): void {
    const count = this.taskOperationCounts.get(taskId) ?? 0;
    if (count <= 1) this.taskOperationCounts.delete(taskId);
    else this.taskOperationCounts.set(taskId, count - 1);
    this.maybeReclaimTaskGeneration(taskId);
  }

  private maybeReclaimTaskGeneration(taskId: string): void {
    if ((this.taskOperationCounts.get(taskId) ?? 0) > 0) return;
    if (this.sessions.has(taskId) || this.taskTeardowns.has(taskId)) return;
    for (const owner of this.tabReservations.values()) {
      if (owner === taskId) return;
    }
    this.taskGenerations.delete(taskId);
  }

  private beginTeardown(tabId: number, taskId: string): void {
    this.teardownTabs.add(tabId);
    this.teardownOwners.set(tabId, taskId);
    this.taskTeardowns.add(taskId);
  }

  private finishTeardown(tabId: number): void {
    this.teardownTabs.delete(tabId);
    const taskId = this.teardownOwners.get(tabId);
    this.teardownOwners.delete(tabId);
    if (
      taskId &&
      ![...this.teardownOwners.values()].some((owner) => owner === taskId)
    ) {
      this.taskTeardowns.delete(taskId);
    }
  }

  private trackPendingOperation<T>(
    operationsByTask: Map<string, Set<Promise<T>>>,
    taskId: string,
    operation: Promise<T>,
  ): void {
    const operations = operationsByTask.get(taskId) ?? new Set<Promise<T>>();
    operations.add(operation);
    operationsByTask.set(taskId, operations);
    const cleanup = () => {
      operations.delete(operation);
      if (
        operations.size === 0 &&
        operationsByTask.get(taskId) === operations
      ) {
        operationsByTask.delete(taskId);
      }
    };
    void operation.then(cleanup, cleanup);
  }

  private isTaskCancellation(error: unknown): boolean {
    return (
      error instanceof BrowserControlError &&
      error.code === "TASK_HANDOFF_CANCELLED"
    );
  }

  private withTaskCancellation<T>(
    taskId: string,
    expectedGeneration: number | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (expectedGeneration === undefined) return operation();
    this.assertTaskGeneration(taskId, expectedGeneration);
    let cancel: (() => void) | undefined;
    const cancellation = new Promise<never>((_, reject) => {
      cancel = () =>
        reject(
          new BrowserControlError(
            "TASK_HANDOFF_CANCELLED",
            "The Chrome operation was cancelled before it completed.",
          ),
        );
    });
    const waitersByGeneration =
      this.taskCancellationWaiters.get(taskId) ??
      new Map<number, Set<() => void>>();
    const waiters =
      waitersByGeneration.get(expectedGeneration) ?? new Set<() => void>();
    if (!cancel) throw new Error("Could not register Chrome cancellation.");
    waiters.add(cancel);
    waitersByGeneration.set(expectedGeneration, waiters);
    this.taskCancellationWaiters.set(taskId, waitersByGeneration);
    const cleanup = () => {
      waiters.delete(cancel!);
      if (waiters.size === 0) {
        waitersByGeneration.delete(expectedGeneration);
      }
      if (waitersByGeneration.size === 0) {
        this.taskCancellationWaiters.delete(taskId);
      }
    };
    let pending: Promise<T>;
    try {
      pending = operation();
    } catch (error) {
      cleanup();
      return Promise.reject(error);
    }
    return Promise.race([pending, cancellation]).finally(cleanup);
  }

  private sendCommand<T>(
    taskId: string,
    expectedGeneration: number | undefined,
    tabId: number,
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    return this.withTaskCancellation(taskId, expectedGeneration, () => {
      const operation = sendDebuggerCommand<T>(source(tabId), method, params);
      if (
        method === "Input.dispatchKeyEvent" ||
        method === "Input.dispatchMouseEvent"
      ) {
        return this.trackInputOperation(tabId, method, params, operation);
      }
      return operation;
    });
  }

  private scheduleLateAttachTeardown(
    pending: PendingAttach,
  ): Promise<Error | undefined> | undefined {
    if (!pending.debuggerAttachStarted || pending.externalDetachObserved) {
      return undefined;
    }
    if (!pending.teardownRequested) {
      pending.teardownRequested = true;
      this.beginTeardown(pending.tabId, pending.taskId);
    } else if (this.teardownOwners.get(pending.tabId) !== pending.taskId) {
      return undefined;
    }
    if (!pending.rawAttachSettled || !pending.debuggerAttached)
      return undefined;
    const operation = this.teardownDebugger(pending.tabId, pending.taskId);
    this.trackPendingOperation(
      this.pendingAttachTeardownOperations,
      pending.taskId,
      operation,
    );
    void operation.then(
      () => this.persist().catch(() => undefined),
      () => this.persist().catch(() => undefined),
    );
    return operation;
  }

  private async teardownDebugger(
    tabId: number,
    taskId: string,
  ): Promise<Error | undefined> {
    const existing = this.teardownOperations.get(tabId);
    if (existing) return existing;
    const operation = this.runTeardownDebugger(tabId, taskId);
    this.teardownOperations.set(tabId, operation);
    void operation.then(
      () => {
        if (this.teardownOperations.get(tabId) === operation) {
          this.teardownOperations.delete(tabId);
        }
      },
      () => {
        if (this.teardownOperations.get(tabId) === operation) {
          this.teardownOperations.delete(tabId);
        }
      },
    );
    return operation;
  }

  private async runTeardownDebugger(
    tabId: number,
    taskId: string,
  ): Promise<Error | undefined> {
    let releaseError: Error | undefined;
    await this.drainPendingInputOperations(tabId);
    const pressedKeys = this.pressedKeys.get(tabId)?.values() ?? [];
    try {
      await releaseInjectedInput(tabId, pressedKeys);
    } catch (error) {
      releaseError = error instanceof Error ? error : new Error(String(error));
    }
    try {
      await detachDebugger(source(tabId));
      this.finishTeardown(tabId);
      this.pressedKeys.delete(tabId);
      if (releaseError) {
        console.warn(
          "[browser-control] injected input release failed after debugger detach",
          { tabId, taskId, error: releaseError },
        );
      }
      return releaseError;
    } catch (error) {
      const teardownError =
        error instanceof Error ? error : new Error(String(error));
      if (!this.teardownOwners.has(tabId)) {
        this.pressedKeys.delete(tabId);
        if (releaseError) {
          console.warn(
            "[browser-control] injected input release failed after external debugger detach",
            { tabId, taskId, error: releaseError },
          );
        }
        return undefined;
      }
      const combinedError = releaseError
        ? new AggregateError(
            [releaseError, teardownError],
            "Chrome teardown failed.",
          )
        : teardownError;
      console.warn("[browser-control] debugger teardown is still pending", {
        tabId,
        taskId,
        error: combinedError,
      });
      return combinedError;
    }
  }

  private invalidateTask(taskId: string): void {
    const nextGeneration = this.taskGeneration(taskId) + 1;
    this.taskGenerations.set(taskId, nextGeneration);
    const waitersByGeneration = this.taskCancellationWaiters.get(taskId);
    if (!waitersByGeneration) return;
    for (const [generation, waiters] of waitersByGeneration) {
      if (generation >= nextGeneration) continue;
      for (const cancel of waiters) cancel();
      waitersByGeneration.delete(generation);
    }
    if (waitersByGeneration.size === 0) {
      this.taskCancellationWaiters.delete(taskId);
    }
  }

  private assertTabAvailable(taskId: string, tabId: number): void {
    if (this.teardownTabs.has(tabId)) {
      throw new BrowserControlError(
        "TAB_ALREADY_OWNED",
        "Another task is still releasing this tab.",
      );
    }
    const pendingAttachOwner = this.pendingAttaches.get(tabId)?.taskId;
    const reservationOwner = this.tabReservations.get(tabId);
    const owner = this.tabOwners.get(tabId);
    if (
      (pendingAttachOwner && pendingAttachOwner !== taskId) ||
      (reservationOwner && reservationOwner !== taskId) ||
      (owner && owner !== taskId)
    ) {
      throw new BrowserControlError(
        "TAB_ALREADY_OWNED",
        "Another task already controls this tab.",
      );
    }
  }

  private async revalidate(
    taskId: string,
    expectedGeneration?: number,
  ): Promise<TaskSession> {
    if (expectedGeneration !== undefined) {
      this.assertTaskGeneration(taskId, expectedGeneration);
    }
    const session = this.getSession(taskId);
    try {
      await this.assertSessionAllowed(session, taskId, expectedGeneration);
      if (expectedGeneration !== undefined) {
        this.assertTaskGeneration(taskId, expectedGeneration);
      }
      return session;
    } catch (error) {
      if (this.isTaskCancellation(error)) throw error;
      await this.detach(taskId);
      throw error;
    }
  }

  private async observe(
    taskId: string,
    screenshot: boolean,
    maxNodes: number,
    expectedGeneration?: number,
  ): Promise<unknown> {
    const session = await this.revalidate(taskId, expectedGeneration);
    const [tree, image, layout] = await Promise.all([
      this.sendCommand<AxTreeResult>(
        taskId,
        expectedGeneration,
        session.tabId,
        "Accessibility.getFullAXTree",
        { depth: -1 },
      ),
      screenshot
        ? this.sendCommand<ScreenshotResult>(
            taskId,
            expectedGeneration,
            session.tabId,
            "Page.captureScreenshot",
            {
              format: "jpeg",
              quality: 55,
              fromSurface: true,
              captureBeyondViewport: false,
              optimizeForSpeed: true,
            },
          )
        : Promise.resolve(undefined),
      screenshot
        ? this.sendCommand<LayoutMetricsResult>(
            taskId,
            expectedGeneration,
            session.tabId,
            "Page.getLayoutMetrics",
          )
        : Promise.resolve(undefined),
    ]);
    const width = layout?.cssVisualViewport?.clientWidth;
    const height = layout?.cssVisualViewport?.clientHeight;
    if (
      screenshot &&
      (typeof width !== "number" ||
        typeof height !== "number" ||
        width <= 0 ||
        height <= 0 ||
        width > MAX_SCREENSHOT_DIMENSION ||
        height > MAX_SCREENSHOT_DIMENSION)
    ) {
      throw new BrowserControlError(
        "SCREENSHOT_DIMENSIONS_UNSAFE",
        "Chrome viewport dimensions exceed the screenshot safety limit.",
      );
    }
    if (image?.data && image.data.length > MAX_SCREENSHOT_BASE64_CHARS) {
      throw new BrowserControlError(
        "SCREENSHOT_TOO_LARGE",
        "Captured Chrome frame exceeds the in-memory safety limit.",
      );
    }
    const observationId = crypto.randomUUID();
    const cleanedNodes = (tree.nodes ?? []).slice(0, maxNodes).map(cleanAxNode);
    session.observation = {
      id: observationId,
      targets: new Map(
        (tree.nodes ?? []).flatMap((node) =>
          typeof node.backendDOMNodeId === "number"
            ? [
                [
                  node.backendDOMNodeId,
                  {
                    role: cleanAxValue(node.role),
                    name: cleanAxValue(node.name),
                  },
                ] as const,
              ]
            : [],
        ),
      ),
    };
    return {
      tabId: session.tabId,
      observationId,
      nodes: cleanedNodes,
      truncated: (tree.nodes?.length ?? 0) > maxNodes,
      screenshot: image?.data
        ? { mediaType: "image/jpeg", data: image.data, width, height }
        : undefined,
    };
  }

  private async click(
    taskId: string,
    target: { observationId: string; backendNodeId: number },
    button: "left" | "middle" | "right",
    expectedGeneration?: number,
  ): Promise<unknown> {
    const session = await this.revalidate(taskId, expectedGeneration);
    await this.assertFreshTarget(session, target, taskId, expectedGeneration);
    try {
      const box = await this.sendCommand<BoxModelResult>(
        taskId,
        expectedGeneration,
        session.tabId,
        "DOM.getBoxModel",
        { backendNodeId: target.backendNodeId },
      );
      const point = centerOfBox(box);
      await this.revalidate(taskId, expectedGeneration);
      await this.sendCommand(
        taskId,
        expectedGeneration,
        session.tabId,
        "Input.dispatchMouseEvent",
        {
          type: "mousePressed",
          ...point,
          button,
          clickCount: 1,
        },
      );
      await this.sendCommand(
        taskId,
        expectedGeneration,
        session.tabId,
        "Input.dispatchMouseEvent",
        {
          type: "mouseReleased",
          ...point,
          button,
          clickCount: 1,
        },
      );
      return point;
    } finally {
      session.observation = undefined;
    }
  }

  private async type(
    taskId: string,
    target: { observationId: string; backendNodeId: number },
    text: string,
    replace: boolean,
    expectedGeneration?: number,
  ): Promise<unknown> {
    const session = await this.revalidate(taskId, expectedGeneration);
    await this.assertFreshTarget(session, target, taskId, expectedGeneration);
    try {
      await this.sendCommand(
        taskId,
        expectedGeneration,
        session.tabId,
        "DOM.focus",
        {
          backendNodeId: target.backendNodeId,
        },
      );
      if (replace) {
        const modifier = navigator.userAgent.includes("Mac OS") ? 4 : 2;
        await this.sendCommand(
          taskId,
          expectedGeneration,
          session.tabId,
          "Input.dispatchKeyEvent",
          {
            type: "keyDown",
            key: "a",
            code: "KeyA",
            windowsVirtualKeyCode: 65,
            nativeVirtualKeyCode: 65,
            modifiers: modifier,
          },
        );
        await this.sendCommand(
          taskId,
          expectedGeneration,
          session.tabId,
          "Input.dispatchKeyEvent",
          {
            type: "keyUp",
            key: "a",
            code: "KeyA",
            windowsVirtualKeyCode: 65,
            nativeVirtualKeyCode: 65,
            modifiers: modifier,
          },
        );
      }
      await this.revalidate(taskId, expectedGeneration);
      await this.sendCommand(
        taskId,
        expectedGeneration,
        session.tabId,
        "Input.insertText",
        { text },
      );
      return { insertedCharacters: text.length };
    } finally {
      session.observation = undefined;
    }
  }

  private async assertFreshTarget(
    session: TaskSession,
    target: { observationId: string; backendNodeId: number },
    taskId: string,
    expectedGeneration?: number,
  ): Promise<void> {
    const expected = session.observation?.targets.get(target.backendNodeId);
    if (!expected || session.observation?.id !== target.observationId) {
      throw new BrowserControlError(
        "STALE_TARGET",
        "Observe Chrome again before acting on this target.",
      );
    }
    const current = await this.sendCommand<AxTreeResult>(
      taskId,
      expectedGeneration,
      session.tabId,
      "Accessibility.getPartialAXTree",
      { backendNodeId: target.backendNodeId, fetchRelatives: false },
    );
    const node = current.nodes?.find(
      (candidate) => candidate.backendDOMNodeId === target.backendNodeId,
    );
    if (
      !node ||
      cleanAxValue(node.role) !== expected.role ||
      cleanAxValue(node.name) !== expected.name
    ) {
      session.observation = undefined;
      throw new BrowserControlError(
        "STALE_TARGET",
        "Chrome target changed after observation.",
      );
    }
  }

  private async key(
    taskId: string,
    key: BrowserKey,
    modifiers: BrowserModifier[] = [],
    expectedGeneration?: number,
  ): Promise<unknown> {
    const session = await this.revalidate(taskId, expectedGeneration);
    try {
      const data = KEY_DATA[key];
      const params = {
        key: data.key,
        code: data.code,
        windowsVirtualKeyCode: data.keyCode,
        nativeVirtualKeyCode: data.keyCode,
        modifiers: modifierMask(modifiers),
      };
      await this.sendCommand(
        taskId,
        expectedGeneration,
        session.tabId,
        "Input.dispatchKeyEvent",
        { type: "keyDown", ...params },
      );
      await this.sendCommand(
        taskId,
        expectedGeneration,
        session.tabId,
        "Input.dispatchKeyEvent",
        { type: "keyUp", ...params },
      );
      return { key };
    } finally {
      session.observation = undefined;
    }
  }

  private async navigate(
    taskId: string,
    rawUrl: string,
    expectedGeneration?: number,
  ): Promise<unknown> {
    const session = await this.revalidate(taskId, expectedGeneration);
    try {
      const url = assertUrlAllowed(rawUrl, session.allowedOrigins);
      const result = await this.sendCommand<Record<string, unknown>>(
        taskId,
        expectedGeneration,
        session.tabId,
        "Page.navigate",
        { url: url.href },
      );
      return { url: url.href, ...result };
    } finally {
      session.observation = undefined;
    }
  }

  private async openTab(
    taskId: string,
    rawUrl: string,
    expectedGeneration?: number,
  ): Promise<unknown> {
    const handoffGeneration = expectedGeneration ?? this.taskGeneration(taskId);
    this.assertTaskGeneration(taskId, handoffGeneration);
    const session = await this.revalidate(taskId, handoffGeneration);
    this.assertTaskGeneration(taskId, handoffGeneration);
    const url = assertUrlAllowed(rawUrl, session.allowedOrigins);
    let createdTabId: number | undefined;
    let resolveTabCleanup: (() => void) | undefined;
    let rejectTabCleanup: ((reason?: unknown) => void) | undefined;
    let tabCleanup: Promise<void> | undefined;
    try {
      const tabCreation = createBackgroundTab(url.href);
      this.trackPendingOperation(this.pendingTabCreations, taskId, tabCreation);
      const tab = await tabCreation;
      if (typeof tab.id !== "number") {
        throw new BrowserControlError(
          "TAB_ID_UNAVAILABLE",
          "Chrome did not return an id for the background tab.",
        );
      }
      createdTabId = tab.id;
      tabCleanup = new Promise<void>((resolve, reject) => {
        resolveTabCleanup = resolve;
        rejectTabCleanup = reject;
      });
      this.trackPendingOperation(this.pendingTabCleanups, taskId, tabCleanup);
      this.tabReservations.set(createdTabId, taskId);
      if (tab.active !== false) {
        throw new BrowserControlError(
          "TAB_NOT_BACKGROUND",
          "Chrome could not create the requested tab in the background.",
        );
      }
      await this.attach(
        taskId,
        tab.id,
        [...session.allowedOrigins],
        session,
        handoffGeneration,
      );
      return { url: url.href, origin: url.origin, active: false };
    } catch (error) {
      if (createdTabId !== undefined) {
        try {
          const owner = this.tabOwners.get(createdTabId);
          const reservationOwner = this.tabReservations.get(createdTabId);
          if (
            (!owner || owner === taskId) &&
            (!reservationOwner || reservationOwner === taskId)
          ) {
            await removeTab(createdTabId);
          }
        } catch (cleanupError) {
          rejectTabCleanup?.(cleanupError);
          const failure =
            error instanceof Error ? error.message : "Tab handoff failed.";
          const cleanupFailure =
            cleanupError instanceof Error
              ? cleanupError.message
              : "Could not remove the created tab.";
          throw new BrowserControlError(
            "TAB_HANDOFF_CLEANUP_FAILED",
            `${failure} ${cleanupFailure}`,
          );
        }
      }
      throw error;
    } finally {
      if (
        createdTabId !== undefined &&
        this.tabReservations.get(createdTabId) === taskId
      ) {
        this.tabReservations.delete(createdTabId);
      }
      resolveTabCleanup?.();
    }
  }

  private enqueueState<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.stateQueue.then(operation);
    this.stateQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async scroll(
    taskId: string,
    deltaX: number,
    deltaY: number,
    x: number,
    y: number,
    expectedGeneration?: number,
  ): Promise<unknown> {
    const session = await this.revalidate(taskId, expectedGeneration);
    try {
      await this.sendCommand(
        taskId,
        expectedGeneration,
        session.tabId,
        "Input.dispatchMouseEvent",
        { type: "mouseWheel", x, y, deltaX, deltaY },
      );
      return { deltaX, deltaY };
    } finally {
      session.observation = undefined;
    }
  }

  private persist(sessions: Iterable<TaskSession> = this.sessions.values()) {
    const stored: StoredTaskSession[] = [...sessions].map((session) => ({
      taskId: session.taskId,
      tabId: session.tabId,
      allowedOrigins: [...session.allowedOrigins],
    }));
    const pendingTeardowns: StoredTeardown[] = [...this.teardownOwners].map(
      ([tabId, taskId]) => ({ taskId, tabId }),
    );
    const write = this.persistQueue.then(() =>
      chrome.storage.session.set({
        [SESSION_STORAGE_KEY]: stored,
        [TEARDOWN_STORAGE_KEY]: pendingTeardowns,
      }),
    );
    this.persistQueue = write.then(
      () => undefined,
      () => undefined,
    );
    return write;
  }
}
