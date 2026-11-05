// @vitest-environment happy-dom

import {
  WRITE_FAILURE_EVENT,
  type WriteFailureDetail,
} from "@agent-native/core/client/write-failure";
import { afterEach, describe, expect, it, vi } from "vitest";

import { reportFailedFetchWrite } from "./report-failed-fetch-write";

function listenForFailures() {
  const reported: WriteFailureDetail[] = [];
  const listener = (event: Event) => {
    reported.push((event as CustomEvent<WriteFailureDetail>).detail);
  };
  window.addEventListener(WRITE_FAILURE_EVENT, listener);
  return {
    reported,
    stop: () => window.removeEventListener(WRITE_FAILURE_EVENT, listener),
  };
}

describe("announcing a failed raw fetch write", () => {
  const stops: Array<() => void> = [];

  afterEach(() => {
    stops.splice(0).forEach((stop) => stop());
    vi.restoreAllMocks();
  });

  it("reports a non-ok response with its status", async () => {
    const { reported, stop } = listenForFailures();
    stops.push(stop);

    reportFailedFetchWrite(
      Promise.resolve(new Response(null, { status: 500 })),
    );
    await vi.waitFor(() => expect(reported).toHaveLength(1));

    const first = reported.length > 0 ? reported[0] : undefined;
    expect(first?.error).toMatchObject({ status: 500 });
  });

  it("reports a rejected request", async () => {
    const { reported, stop } = listenForFailures();
    stops.push(stop);
    const failure = new TypeError("Failed to fetch");

    reportFailedFetchWrite(Promise.reject(failure));
    await vi.waitFor(() => expect(reported).toHaveLength(1));

    const first = reported.length > 0 ? reported[0] : undefined;
    expect(first?.error).toBe(failure);
  });

  it("stays quiet when the write lands", async () => {
    const { reported, stop } = listenForFailures();
    stops.push(stop);

    reportFailedFetchWrite(
      Promise.resolve(new Response(null, { status: 200 })),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(reported).toEqual([]);
  });
});
