import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const workspaceRoot = resolve(import.meta.dirname, "..");
const designRequire = createRequire(
  pathToFileURL(resolve(workspaceRoot, "templates/design/package.json")),
);
const { build } = designRequire("esbuild") as {
  build(options: Record<string, unknown>): Promise<{
    outputFiles: Array<{ text: string }>;
  }>;
};

const electronStub = String.raw`
let nextViewId = 1000;
const contentsById = new Map();
const sessions = new Map();
const views = [];

class FakeWebContents {
  constructor(id, type = "webview") {
    this.id = id;
    this.type = type;
    this.destroyed = false;
    this.currentUrl = "";
    this.loadCalls = [];
    this.sent = [];
    this.listeners = new Map();
    this.windowOpenHandler = null;
    this.captureCalls = 0;
    this.captureSize = { width: 1600, height: 1200 };
  }
  on(event, listener) {
    const listeners = this.listeners.get(event) || new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }
  removeListener(event, listener) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }
  emit(event, ...args) {
    for (const listener of this.listeners.get(event) || []) listener(...args);
  }
  isDestroyed() { return this.destroyed; }
  getType() { return this.type; }
  getURL() { return this.currentUrl; }
  loadURL(url) {
    this.loadCalls.push(url);
    this.currentUrl = url;
    this.emit("did-start-navigation");
    return Promise.resolve();
  }
  setWindowOpenHandler(handler) { this.windowOpenHandler = handler; }
  insertCSS() { return Promise.resolve("capture-css"); }
  removeInsertedCSS() { return Promise.resolve(); }
  executeJavaScript() { return Promise.resolve(); }
  capturePage() {
    this.captureCalls += 1;
    return Promise.resolve({
      getSize: () => this.captureSize,
      toPNG: () => new Uint8Array([137, 80, 78, 71]),
    });
  }
  send(...args) { this.sent.push(args); }
  close() {
    this.destroyed = true;
    this.emit("destroyed");
  }
}

class FakeSession {
  setPermissionCheckHandler(handler) { this.permissionCheckHandler = handler; }
  setPermissionRequestHandler(handler) { this.permissionRequestHandler = handler; }
}

class WebContentsView {
  constructor(options) {
    this.options = options;
    this.webContents = new FakeWebContents(nextViewId++, "window");
    this.visible = false;
    this.bounds = null;
    views.push(this);
  }
  setVisible(value) { this.visible = value; }
  setBounds(value) { this.bounds = value; }
}

const session = {
  fromPartition(partition) {
    const value = sessions.get(partition) || new FakeSession();
    sessions.set(partition, value);
    return value;
  },
};
const webContents = { fromId: (id) => contentsById.get(id) };
const __electronTest = {
  FakeWebContents,
  contentsById,
  sessions,
  views,
  reset() {
    nextViewId = 1000;
    contentsById.clear();
    sessions.clear();
    views.splice(0);
  },
};
export { session, webContents, WebContentsView, __electronTest };
`;

const result = await build({
  stdin: {
    contents: `
      export { DesktopDesignPreviewManager } from ${JSON.stringify(
        resolve(
          workspaceRoot,
          "packages/desktop-app/src/main/design-preview-manager.ts",
        ),
      )};
      export { __electronTest } from "electron";
    `,
    resolveDir: workspaceRoot,
    sourcefile: "qa-design-preview-manager-entry.ts",
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  write: false,
  plugins: [
    {
      name: "electron-test-double",
      setup(api: {
        onResolve(
          options: { filter: RegExp },
          callback: () => { path: string; namespace: string },
        ): void;
        onLoad(
          options: { filter: RegExp; namespace: string },
          callback: () => { contents: string; loader: string },
        ): void;
      }) {
        api.onResolve({ filter: /^electron$/ }, () => ({
          path: "electron",
          namespace: "electron-test-double",
        }));
        api.onLoad({ filter: /.*/, namespace: "electron-test-double" }, () => ({
          contents: electronStub,
          loader: "js",
        }));
      },
    },
  ],
});

const bundled = result.outputFiles[0]?.text;
assert.ok(bundled, "esbuild must produce the manager QA bundle");
const loaded = (await import(
  `data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`
)) as {
  DesktopDesignPreviewManager: new (window: unknown) => {
    registerOwner(id: number, appId: string, bounds: unknown): void;
    clearOwner(id?: number): void;
    handleRequest(sender: unknown, request: unknown): void;
    snapshot(): {
      partition?: string;
      generation?: number;
      visible: boolean;
    };
  };
  __electronTest: {
    FakeWebContents: new (id: number, type?: string) => any;
    contentsById: Map<number, any>;
    sessions: Map<string, any>;
    views: any[];
    reset(): void;
  };
};
const { DesktopDesignPreviewManager, __electronTest: electron } = loaded;

function update(generation: number, overrides: Record<string, unknown> = {}) {
  return {
    action: "update",
    appId: "design",
    workspaceId: "workspace-1",
    connectionId: "connection-1",
    screenId: "screen-1",
    generation,
    url: "https://app.example.test/login",
    previewBounds: { x: 10, y: 20, width: 800, height: 600 },
    clipBounds: { x: 0, y: 0, width: 1000, height: 700 },
    mode: "interact",
    presentation: "focused",
    scale: 1,
    rotationDegrees: 0,
    borderRadius: 0,
    devicePixelRatio: 2,
    obscured: false,
    visible: true,
    ...overrides,
  };
}

function setup() {
  electron.reset();
  const owner = new electron.FakeWebContents(7, "webview");
  electron.contentsById.set(owner.id, owner);
  const contentView = {
    children: [] as unknown[],
    addChildView(view: unknown) {
      this.children = this.children.filter((candidate) => candidate !== view);
      this.children.push(view);
    },
    removeChildView(view: unknown) {
      this.children = this.children.filter((candidate) => candidate !== view);
    },
  };
  const manager = new DesktopDesignPreviewManager({ contentView });
  manager.registerOwner(owner.id, "design", {
    x: 50,
    y: 40,
    width: 1000,
    height: 700,
  });
  return { manager, owner };
}

{
  const { manager, owner } = setup();
  const spoofed = new electron.FakeWebContents(8, "webview");
  manager.handleRequest(spoofed, update(1));
  assert.equal(electron.views.length, 0, "spoofed senders must be ignored");
  manager.handleRequest(owner, update(1));
  assert.equal(electron.views.length, 1);
  assert.deepEqual(electron.views[0].options.webPreferences, {
    partition: manager.snapshot().partition,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
  });
}

{
  const { manager, owner } = setup();
  manager.handleRequest(owner, update(1));
  const firstPartition = manager.snapshot().partition!;
  const firstSession = electron.sessions.get(firstPartition);
  assert.equal(firstSession.permissionCheckHandler(), false);
  let permissionAllowed: boolean | undefined;
  firstSession.permissionRequestHandler(null, null, (allowed: boolean) => {
    permissionAllowed = allowed;
  });
  assert.equal(permissionAllowed, false);
  manager.handleRequest(owner, update(2, { screenId: "screen-2" }));
  assert.equal(manager.snapshot().partition, firstPartition);
  assert.equal(electron.sessions.get(firstPartition), firstSession);
  manager.handleRequest(owner, update(3, { connectionId: "connection-2" }));
  assert.notEqual(manager.snapshot().partition, firstPartition);
}

{
  const { manager, owner } = setup();
  manager.handleRequest(owner, update(1));
  const view = electron.views[0];
  view.webContents.emit("did-finish-load");
  manager.handleRequest(owner, update(2, { mode: "edit" }));
  assert.equal(
    manager.snapshot().visible,
    true,
    "native pixels stay visible until the decoded snapshot is acknowledged",
  );
  assert.equal(view.webContents.destroyed, false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(view.webContents.captureCalls, 1);
  const snapshotState = owner.sent.find(
    ([, state]) => state?.state === "snapshot",
  )?.[1];
  assert.ok(snapshotState);
  manager.handleRequest(owner, {
    action: "snapshot-ready",
    appId: "design",
    workspaceId: "workspace-1",
    connectionId: "connection-1",
    screenId: "screen-1",
    generation: 3,
    version: snapshotState.version + 1,
  });
  assert.equal(
    manager.snapshot().visible,
    true,
    "a stale or spoofed snapshot acknowledgement cannot hide native pixels",
  );
  manager.handleRequest(owner, {
    action: "snapshot-ready",
    appId: "design",
    workspaceId: "workspace-1",
    connectionId: "connection-1",
    screenId: "screen-1",
    generation: 4,
    version: snapshotState.version,
  });
  assert.equal(manager.snapshot().visible, false);
}

{
  const { manager, owner } = setup();
  manager.handleRequest(owner, update(1));
  const view = electron.views[0];
  view.webContents.emit("did-finish-load");
  view.webContents.captureSize = { width: 5000, height: 1200 };
  manager.handleRequest(owner, update(2, { mode: "draw" }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(manager.snapshot().visible, false);
  assert.equal(
    owner.sent.some(
      ([, state]) =>
        state?.state === "failed" && state?.reason === "snapshot-too-large",
    ),
    true,
  );
}

{
  const { manager, owner } = setup();
  manager.handleRequest(owner, update(1));
  const view = electron.views[0];
  view.webContents.currentUrl = "https://app.example.test/dashboard";
  view.webContents.emit("did-finish-load");
  manager.handleRequest(owner, update(2));
  assert.deepEqual(view.webContents.loadCalls, [
    "https://app.example.test/login",
  ]);
}

{
  const { manager, owner } = setup();
  manager.handleRequest(owner, update(1));
  const view = electron.views[0];
  assert.deepEqual(
    view.webContents.windowOpenHandler({ url: "https://evil.example/" }),
    { action: "deny" },
  );
  let prevented = false;
  view.webContents.emit(
    "will-navigate",
    { preventDefault: () => (prevented = true) },
    "https://evil.example/",
  );
  assert.equal(prevented, true);
}

{
  const { manager, owner } = setup();
  manager.handleRequest(owner, update(100));
  const oldView = electron.views[0];
  owner.emit("did-start-navigation");
  assert.equal(oldView.webContents.destroyed, true);
  manager.handleRequest(owner, update(0));
  assert.equal(manager.snapshot().generation, 0);
}

{
  const { manager, owner } = setup();
  manager.handleRequest(owner, update(1));
  const oldView = electron.views[0];
  manager.registerOwner(owner.id, "design", {
    x: 50,
    y: 40,
    width: 900,
    height: 700,
  });
  assert.equal(oldView.webContents.destroyed, true);
  assert.equal(manager.snapshot().visible, false);
}

{
  const { manager, owner } = setup();
  manager.handleRequest(owner, update(1));
  const view = electron.views[0];
  view.webContents.emit("did-finish-load");
  assert.equal(manager.snapshot().visible, true);
  view.webContents.emit("did-start-navigation");
  assert.equal(manager.snapshot().visible, false);
  manager.handleRequest(owner, update(2));
  assert.equal(
    manager.snapshot().visible,
    false,
    "a geometry heartbeat must not reveal a native page mid-navigation",
  );
  view.webContents.emit("did-finish-load");
  assert.equal(manager.snapshot().visible, true);
}

{
  const { manager, owner } = setup();
  manager.handleRequest(owner, update(1));
  const view = electron.views[0];
  manager.clearOwner(owner.id + 1);
  assert.equal(
    view.webContents.destroyed,
    false,
    "an inactive old tab must not clear a newer owner",
  );
  manager.clearOwner(owner.id);
  assert.equal(view.webContents.destroyed, true);
  assert.equal(manager.snapshot().visible, false);
}

console.log(
  "qa-design-preview-manager: clean (10 adversarial manager scenarios)",
);
