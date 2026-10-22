import { expect, it, vi } from "vitest";

vi.mock("../../../../packages/core/src/client/use-action.ts", () => ({
  callAction: vi.fn(),
}));

import { callAction } from "../../../../packages/core/src/client/use-action.ts";
import { deleteScratchDeck } from "./client-action.ts";
import {
  ActionHttpError,
  ActionRequestTimeoutError,
  ActionTransportError,
  CouldNotRun,
  getHarnessUnavailableError,
} from "./run-outcomes.ts";

const args = {
  body: { id: "scratch-deck" },
  compatibilityVersion: "slides-write-v1",
  source: new URL(
    "../../../../packages/core/src/client/use-action.ts",
    import.meta.url,
  ).href,
  timeoutMs: 30_000,
};

const page = {
  async evaluate<A, R>(run: (args: A) => Promise<R>, input: A): Promise<R> {
    return structuredClone(await run(input));
  },
};

it("returns successful cleanup results across the browser boundary", async () => {
  vi.mocked(callAction).mockResolvedValueOnce({ success: true });
  await expect(deleteScratchDeck(page, args)).resolves.toEqual({
    success: true,
  });
});

it.each([
  [403, "Approval required"],
  [500, "Deletion failed"],
])(
  "keeps HTTP %s cleanup failures distinct from infrastructure outages",
  async (status, message) => {
    vi.mocked(callAction).mockRejectedValueOnce(
      Object.assign(new Error(message), { status }),
    );
    const error = await deleteScratchDeck(page, args).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ActionHttpError);
    expect(error).toMatchObject({ actionName: "delete-deck", status });
    expect(getHarnessUnavailableError(error)).toBeNull();
  },
);

it("preserves the mutating-request timeout classification", async () => {
  vi.mocked(callAction).mockRejectedValueOnce(
    Object.assign(new Error("Deletion timed out"), {
      status: 408,
      timedOut: true,
    }),
  );
  const error = await deleteScratchDeck(page, args).catch(
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ActionRequestTimeoutError);
  expect(getHarnessUnavailableError(error)).toBeNull();
});

it("marks a browser-client network outage as could not run", async () => {
  vi.mocked(callAction).mockRejectedValueOnce(new Error("Failed to fetch"));
  const error = await deleteScratchDeck(page, args).catch(
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ActionTransportError);
  expect(getHarnessUnavailableError(error)).toBeInstanceOf(CouldNotRun);
});

it("marks a closed Playwright target as could not run", async () => {
  const closedPage = {
    evaluate: vi
      .fn()
      .mockRejectedValue(
        new Error("Target page, context or browser has been closed"),
      ),
  };
  const error = await deleteScratchDeck(closedPage, args).catch(
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ActionTransportError);
  expect(getHarnessUnavailableError(error)).toBeInstanceOf(CouldNotRun);
});
