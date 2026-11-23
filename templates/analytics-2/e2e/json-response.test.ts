import assert from "node:assert/strict";
import { it } from "node:test";

import type { Page, Response } from "@playwright/test";
import { z } from "zod";

import { waitForJsonResponse } from "./json-response.js";

it("starts reading the matched response before navigation discards its body", async () => {
  let navigated = false;
  const response = {
    ok: () => true,
    status: () => 200,
    json: () =>
      navigated
        ? Promise.reject(new Error("Response body unavailable"))
        : Promise.resolve({ id: "project-1" }),
  } as Response;
  const page = {
    waitForResponse: (match: (response: Response) => boolean) => {
      assert.equal(match(response), true);
      navigated = true;
      return Promise.resolve(response);
    },
  } as unknown as Page;

  assert.deepEqual(
    await waitForJsonResponse(page, () => true, z.object({ id: z.string() })),
    { ok: true, status: 200, body: { id: "project-1" } },
  );
});

it("preserves HTTP failures and body read errors", async () => {
  const makePage = (response: Response) =>
    ({
      waitForResponse: (match: (response: Response) => boolean) => {
        assert.equal(match(response), true);
        return Promise.resolve(response);
      },
    }) as unknown as Page;
  const schema = z.object({ id: z.string() });
  const failed = { ok: () => false, status: () => 403 } as Response;
  assert.deepEqual(
    await waitForJsonResponse(makePage(failed), () => true, schema),
    {
      ok: false,
      status: 403,
    },
  );

  const error = new Error("body read failed");
  const unreadable = {
    ok: () => true,
    status: () => 200,
    json: () => Promise.reject(error),
  } as Response;
  await assert.rejects(
    waitForJsonResponse(makePage(unreadable), () => true, schema),
    error,
  );
});
