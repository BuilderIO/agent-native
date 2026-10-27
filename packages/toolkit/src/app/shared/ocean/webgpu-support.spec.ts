// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  probeWebgpuSupport,
  resetWebgpuSupportProbe,
} from "./webgpu-support.js";

function stubGpu(requestAdapter: () => Promise<unknown>) {
  Object.defineProperty(navigator, "gpu", {
    configurable: true,
    value: { requestAdapter },
  });
}

describe("probeWebgpuSupport", () => {
  beforeEach(() => {
    resetWebgpuSupportProbe();
    sessionStorage.clear();
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, "gpu");
    vi.restoreAllMocks();
  });

  it("requests an adapter once for concurrent and repeated probes", async () => {
    const requestAdapter = vi.fn(async () => null);
    stubGpu(requestAdapter);

    const [first, second] = await Promise.all([
      probeWebgpuSupport(),
      probeWebgpuSupport(),
    ]);
    expect(first).toBe("unsupported");
    expect(second).toBe("unsupported");
    expect(await probeWebgpuSupport()).toBe("unsupported");
    expect(requestAdapter).toHaveBeenCalledTimes(1);
  });

  it("reuses a settled answer from the tab session after a reload", async () => {
    const requestAdapter = vi.fn(async () => ({}));
    stubGpu(requestAdapter);
    expect(await probeWebgpuSupport()).toBe("supported");

    resetWebgpuSupportProbe();
    expect(await probeWebgpuSupport()).toBe("supported");
    expect(requestAdapter).toHaveBeenCalledTimes(1);
  });

  it("retries after a failed probe instead of caching the failure", async () => {
    const requestAdapter = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("device lost"))
      .mockResolvedValueOnce({});
    stubGpu(requestAdapter);

    expect(await probeWebgpuSupport()).toBe("probe-failed");
    expect(await probeWebgpuSupport()).toBe("supported");
    expect(requestAdapter).toHaveBeenCalledTimes(2);
  });

  it("still probes when session storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const requestAdapter = vi.fn(async () => null);
    stubGpu(requestAdapter);

    expect(await probeWebgpuSupport()).toBe("unsupported");
    expect(requestAdapter).toHaveBeenCalledTimes(1);
  });
});
