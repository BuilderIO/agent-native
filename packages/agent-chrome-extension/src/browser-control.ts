import {
  attachDebugger,
  detachDebugger,
  getTab,
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

type TaskSession = {
  taskId: string;
  tabId: number;
  allowedOrigins: Set<string>;
  observation?: BrowserObservation;
};

type StoredTaskSession = Omit<TaskSession, "allowedOrigins"> & {
  allowedOrigins: string[];
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

async function releaseInjectedInput(tabId: number): Promise<void> {
  const debuggee = source(tabId);
  await Promise.allSettled([
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
  ]);
}

export class BrowserControlService {
  private readonly sessions = new Map<string, TaskSession>();
  private readonly tabOwners = new Map<number, string>();
  private readonly taskQueues = new Map<string, Promise<unknown>>();

  get activeTaskCount(): number {
    return this.sessions.size;
  }

  async restore(): Promise<void> {
    const stored = await chrome.storage.session.get(SESSION_STORAGE_KEY);
    const candidates = stored[SESSION_STORAGE_KEY];
    if (!Array.isArray(candidates)) return;
    for (const candidate of candidates as StoredTaskSession[]) {
      if (
        !candidate ||
        typeof candidate.taskId !== "string" ||
        !Number.isInteger(candidate.tabId) ||
        !Array.isArray(candidate.allowedOrigins)
      ) {
        continue;
      }
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
        await detachDebugger(source(session.tabId));
      }
    }
    await this.persist();
  }

  execute(request: NativeRequest): Promise<unknown> {
    if (request.command.type === "stop" || request.command.type === "detach") {
      return this.executeCommand(request.taskId, request.command);
    }
    const previous = this.taskQueues.get(request.taskId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.executeCommand(request.taskId, request.command));
    this.taskQueues.set(request.taskId, next);
    void next.finally(() => {
      if (this.taskQueues.get(request.taskId) === next)
        this.taskQueues.delete(request.taskId);
    });
    return next;
  }

  async emergencyStopAll(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    this.tabOwners.clear();
    this.taskQueues.clear();
    await Promise.allSettled(
      sessions.map(async (session) => {
        await releaseInjectedInput(session.tabId);
        await detachDebugger(source(session.tabId));
      }),
    );
    await this.persist();
  }

  async handleDebuggerDetach(tabId: number): Promise<void> {
    const taskId = this.tabOwners.get(tabId);
    if (!taskId) return;
    this.tabOwners.delete(tabId);
    this.sessions.delete(taskId);
    await this.persist();
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
  ): Promise<unknown> {
    switch (command.type) {
      case "attach":
        return this.attach(taskId, command.tabId, command.allowedOrigins);
      case "detach":
      case "stop":
        await this.detach(taskId);
        return { detached: true };
      case "observe":
        return this.observe(
          taskId,
          command.includeScreenshot ?? true,
          command.maxNodes ?? 400,
        );
      case "click":
        return this.click(taskId, command.target, command.button ?? "left");
      case "type":
        return this.type(
          taskId,
          command.target,
          command.text,
          command.replace ?? false,
        );
      case "key":
        return this.key(taskId, command.key, command.modifiers);
      case "navigate":
        return this.navigate(taskId, command.url);
      case "scroll":
        return this.scroll(
          taskId,
          command.deltaX,
          command.deltaY,
          command.x ?? 0,
          command.y ?? 0,
        );
    }
  }

  private async attach(
    taskId: string,
    tabId: number,
    origins: string[],
  ): Promise<{ tabId: number; origin: string }> {
    const owner = this.tabOwners.get(tabId);
    if (owner && owner !== taskId) {
      throw new BrowserControlError(
        "TAB_ALREADY_OWNED",
        "Another task already controls this tab.",
      );
    }
    if (this.sessions.has(taskId)) await this.detach(taskId);
    const session: TaskSession = {
      taskId,
      tabId,
      allowedOrigins: new Set(origins),
    };
    const tab = await this.assertSessionAllowed(session);
    await attachDebugger(source(tabId));
    try {
      await sendDebuggerCommand(source(tabId), "Page.enable");
      await sendDebuggerCommand(source(tabId), "Accessibility.enable");
      this.sessions.set(taskId, session);
      this.tabOwners.set(tabId, taskId);
      await this.persist();
      return { tabId, origin: new URL(tab.url!).origin };
    } catch (error) {
      await detachDebugger(source(tabId));
      throw error;
    }
  }

  private async detach(taskId: string): Promise<void> {
    const session = this.sessions.get(taskId);
    if (!session) return;
    this.sessions.delete(taskId);
    this.tabOwners.delete(session.tabId);
    this.taskQueues.delete(taskId);
    await releaseInjectedInput(session.tabId);
    await detachDebugger(source(session.tabId));
    await this.persist();
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

  private async assertSessionAllowed(
    session: TaskSession,
  ): Promise<chrome.tabs.Tab> {
    const tab = await getTab(session.tabId);
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

  private async revalidate(taskId: string): Promise<TaskSession> {
    const session = this.getSession(taskId);
    try {
      await this.assertSessionAllowed(session);
      return session;
    } catch (error) {
      await this.detach(taskId);
      throw error;
    }
  }

  private async observe(
    taskId: string,
    screenshot: boolean,
    maxNodes: number,
  ): Promise<unknown> {
    const session = await this.revalidate(taskId);
    const [tree, image, layout] = await Promise.all([
      sendDebuggerCommand<AxTreeResult>(
        source(session.tabId),
        "Accessibility.getFullAXTree",
        { depth: -1 },
      ),
      screenshot
        ? sendDebuggerCommand<ScreenshotResult>(
            source(session.tabId),
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
        ? sendDebuggerCommand<LayoutMetricsResult>(
            source(session.tabId),
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
  ): Promise<unknown> {
    const session = await this.revalidate(taskId);
    await this.assertFreshTarget(session, target);
    try {
      const box = await sendDebuggerCommand<BoxModelResult>(
        source(session.tabId),
        "DOM.getBoxModel",
        { backendNodeId: target.backendNodeId },
      );
      const point = centerOfBox(box);
      await this.revalidate(taskId);
      await sendDebuggerCommand(
        source(session.tabId),
        "Input.dispatchMouseEvent",
        {
          type: "mousePressed",
          ...point,
          button,
          clickCount: 1,
        },
      );
      await sendDebuggerCommand(
        source(session.tabId),
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
  ): Promise<unknown> {
    const session = await this.revalidate(taskId);
    await this.assertFreshTarget(session, target);
    try {
      await sendDebuggerCommand(source(session.tabId), "DOM.focus", {
        backendNodeId: target.backendNodeId,
      });
      if (replace) {
        const modifier = navigator.userAgent.includes("Mac OS") ? 4 : 2;
        await sendDebuggerCommand(
          source(session.tabId),
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
        await sendDebuggerCommand(
          source(session.tabId),
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
      await this.revalidate(taskId);
      await sendDebuggerCommand(source(session.tabId), "Input.insertText", {
        text,
      });
      return { insertedCharacters: text.length };
    } finally {
      session.observation = undefined;
    }
  }

  private async assertFreshTarget(
    session: TaskSession,
    target: { observationId: string; backendNodeId: number },
  ): Promise<void> {
    const expected = session.observation?.targets.get(target.backendNodeId);
    if (!expected || session.observation?.id !== target.observationId) {
      throw new BrowserControlError(
        "STALE_TARGET",
        "Observe Chrome again before acting on this target.",
      );
    }
    const current = await sendDebuggerCommand<AxTreeResult>(
      source(session.tabId),
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
  ): Promise<unknown> {
    const session = await this.revalidate(taskId);
    try {
      const data = KEY_DATA[key];
      const params = {
        key: data.key,
        code: data.code,
        windowsVirtualKeyCode: data.keyCode,
        nativeVirtualKeyCode: data.keyCode,
        modifiers: modifierMask(modifiers),
      };
      await sendDebuggerCommand(
        source(session.tabId),
        "Input.dispatchKeyEvent",
        { type: "keyDown", ...params },
      );
      await sendDebuggerCommand(
        source(session.tabId),
        "Input.dispatchKeyEvent",
        { type: "keyUp", ...params },
      );
      return { key };
    } finally {
      session.observation = undefined;
    }
  }

  private async navigate(taskId: string, rawUrl: string): Promise<unknown> {
    const session = await this.revalidate(taskId);
    try {
      const url = assertUrlAllowed(rawUrl, session.allowedOrigins);
      const result = await sendDebuggerCommand<Record<string, unknown>>(
        source(session.tabId),
        "Page.navigate",
        { url: url.href },
      );
      return { url: url.href, ...result };
    } finally {
      session.observation = undefined;
    }
  }

  private async scroll(
    taskId: string,
    deltaX: number,
    deltaY: number,
    x: number,
    y: number,
  ): Promise<unknown> {
    const session = await this.revalidate(taskId);
    try {
      await sendDebuggerCommand(
        source(session.tabId),
        "Input.dispatchMouseEvent",
        { type: "mouseWheel", x, y, deltaX, deltaY },
      );
      return { deltaX, deltaY };
    } finally {
      session.observation = undefined;
    }
  }

  private async persist(): Promise<void> {
    const stored: StoredTaskSession[] = [...this.sessions.values()].map(
      (session) => ({
        taskId: session.taskId,
        tabId: session.tabId,
        allowedOrigins: [...session.allowedOrigins],
      }),
    );
    await chrome.storage.session.set({ [SESSION_STORAGE_KEY]: stored });
  }
}
