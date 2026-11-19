import { afterEach, expect, it, vi } from "vitest";

import { ssrfSafeFetch } from "./url-safety.js";

afterEach(() => vi.unstubAllGlobals());

it("rechecks dispatch policy after asynchronous URL validation", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  let blocked = false;
  const error = Object.assign(new Error("fixture policy"), {
    errorCode: "fixture_blocked",
    statusCode: 503,
  });
  await expect(
    ssrfSafeFetch(
      "https://93.184.216.34/fixture",
      {},
      {
        assertUrlAllowed: async () => {
          blocked = true;
        },
        beforeDispatch: () => {
          if (blocked) throw error;
        },
      },
    ),
  ).rejects.toBe(error);
  expect(fetch).not.toHaveBeenCalled();
});

it("rechecks the policy at each redirect dispatch", async () => {
  let blocked = false;
  const fetch = vi.fn(async () => {
    blocked = true;
    return new Response(null, {
      status: 302,
      headers: { location: "/fixture-next" },
    });
  });
  vi.stubGlobal("fetch", fetch);
  const error = new Error("fixture policy");
  await expect(
    ssrfSafeFetch(
      "https://93.184.216.34/fixture",
      {},
      {
        beforeDispatch: () => {
          if (blocked) throw error;
        },
      },
    ),
  ).rejects.toBe(error);
  expect(fetch).toHaveBeenCalledTimes(1);
});
