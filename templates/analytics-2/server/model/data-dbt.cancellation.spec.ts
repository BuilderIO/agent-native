import { expect, it, vi } from "vitest";
const fetch = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: fetch,
}));
import { validateDbtConfiguration } from "./data-dbt.js";
const config = {
  hasDbtMetadata: true,
  dbtVersion: "current",
  dbtCloudHostname: "cloud.getdbt.com",
  dbtEnvironmentId: "9",
};
it("does not dispatch provider work for an already cancelled native validation", async () => {
  fetch.mockReset();
  const controller = new AbortController();
  controller.abort();
  await expect(
    validateDbtConfiguration(
      config,
      "flagged-integration-credential",
      controller.signal,
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).not.toHaveBeenCalled();
});
it("cancels the in-flight provider request when its native validation is cancelled", async () => {
  fetch.mockReset();
  let signal: AbortSignal | undefined;
  fetch.mockImplementation(
    (_url: unknown, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        signal = init.signal;
        signal.addEventListener(
          "abort",
          () => reject(new Error("cancelled provider request")),
          { once: true },
        );
      }),
  );
  const controller = new AbortController();
  const pending = validateDbtConfiguration(
    config,
    "flagged-integration-credential",
    controller.signal,
  );
  const rejection = expect(pending).rejects.toMatchObject({
    errorCode: "data_dbt_metadata_failed",
  });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  controller.abort();
  await rejection;
  expect(signal?.aborted).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
});
