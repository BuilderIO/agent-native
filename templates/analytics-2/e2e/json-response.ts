import type { Page, Response } from "@playwright/test";
import type { z } from "zod";

export type JsonResponse<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number };

// The body is read inside the response event chain: a click that navigates
// discards the body of the response it triggered, so a caller that awaits the
// click or a screenshot first and calls response.json() after gets a protocol
// error. `onParsed` runs before the promise resolves so cleanup learns the
// created ids even when a later step fails.
export function waitForJsonResponse<S extends z.ZodType>(
  page: Page,
  match: (response: Response) => boolean,
  schema: S,
  options: { timeout?: number; onParsed?: (body: z.output<S>) => void } = {},
): Promise<JsonResponse<z.output<S>>> {
  const bodies = new WeakMap<Response, Promise<unknown>>();
  return page
    .waitForResponse(
      (response) => {
        if (!match(response)) return false;
        if (response.ok()) {
          const bodyPromise = response.json();
          bodies.set(response, bodyPromise);
          void bodyPromise.catch(() => {});
        }
        return true;
      },
      { timeout: options.timeout },
    )
    .then(async (response) => {
      if (!response.ok())
        return { ok: false as const, status: response.status() };
      const bodyPromise = bodies.get(response);
      if (!bodyPromise) throw new Error("Matched response body was not read");
      const body = schema.parse(await bodyPromise);
      options.onParsed?.(body);
      return { ok: true as const, status: response.status(), body };
    });
}
