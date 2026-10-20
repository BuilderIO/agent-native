// @vitest-environment happy-dom
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

type Runtime = {
  mounts: Map<string, unknown>;
  scanning: Promise<void> | null;
  running: Promise<void> | null;
  onMessage(event: MessageEvent): void;
  scan(): Promise<void>;
  setParameters(id: string, params: Record<string, unknown>): Promise<void>;
  issue(code: string, message: string, instanceId?: string): void;
};
let runtime: Runtime;
const turn = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
const send = (params: Record<string, unknown>) =>
  runtime.onMessage(
    new MessageEvent("message", {
      source: window,
      data: {
        type: "native-shader-set-parameters",
        instanceId: "glass",
        params,
      },
    }),
  );
beforeAll(async () => {
  const loading = vi
    .spyOn(document, "readyState", "get")
    .mockReturnValue("loading");
  await import("./native-shader-runtime.bridge");
  runtime = window.__anNativeShaders as unknown as Runtime;
  loading.mockRestore();
});
beforeEach(() => {
  runtime.mounts = new Map([
    ["glass", { definition: { properties: { thickness: {}, frost: {} } } }],
  ]);
  runtime.scanning = null;
  runtime.running = null;
});
afterEach(() => {
  runtime.mounts.clear();
  vi.restoreAllMocks();
});

describe("native parameter preview message dispatch", () => {
  it("coalesces transient messages without changing direct awaited parameter calls", async () => {
    let release!: () => void;
    const apply = vi
      .spyOn(runtime, "setParameters")
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    send({ thickness: 1 });
    send({ thickness: 2 });
    send({ frost: 4 });
    send({ thickness: 28 });
    expect(apply).toHaveBeenCalledTimes(1);
    release();
    await turn();
    await turn();
    expect(apply.mock.calls).toEqual([
      ["glass", { thickness: 1 }],
      ["glass", { thickness: 28, frost: 4 }],
    ]);
    await runtime.setParameters("glass", { thickness: 5 });
    await runtime.setParameters("glass", { thickness: 6 });
    expect(apply).toHaveBeenCalledTimes(4);
  });

  it("cancels a dequeued transient preview across a canonical scan barrier", async () => {
    let release!: () => void;
    runtime.scanning = new Promise<void>((resolve) => {
      release = resolve;
    });
    const apply = vi
      .spyOn(runtime, "setParameters")
      .mockResolvedValue(undefined);
    send({ thickness: 1 });
    const scan = runtime.scan();
    runtime.scanning = null;
    release();
    await scan;
    await turn();
    await turn();
    expect(apply).not.toHaveBeenCalled();
  });

  it("reports invalid preview property names through the existing issue path", () => {
    const apply = vi
      .spyOn(runtime, "setParameters")
      .mockResolvedValue(undefined);
    const issue = vi.spyOn(runtime, "issue").mockImplementation(() => {});
    send({ unknownProperty: 1 });
    expect(apply).not.toHaveBeenCalled();
    expect(issue).toHaveBeenCalledWith(
      "params-invalid",
      expect.stringContaining("unknownProperty"),
      "glass",
    );
  });
});
