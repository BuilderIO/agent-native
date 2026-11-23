import type { Page } from "@playwright/test";

import {
  checkQueryErrorReload,
  type ExpectedQueryFailure,
} from "../query-error-reload.js";
import { assertQaIdentity } from "./shared.js";

export async function checkQueryErrorReloadLive(page: Page, base: string) {
  await assertQaIdentity(page, base);
  await checkQueryErrorReload(page, base, (failure: ExpectedQueryFailure) => {
    let markSeen: () => void = () => {};
    const seenPromise = new Promise<true>((resolve) => {
      markSeen = () => resolve(true);
    });
    const onResponse = async (
      response: import("@playwright/test").Response,
    ) => {
      const request = response.request();
      const expectedPath = `${new URL(base).pathname.replace(/\/$/, "")}${failure.path}`;
      if (
        request.method() !== failure.method ||
        new URL(response.url()).pathname !== expectedPath ||
        response.status() !== failure.status
      )
        return;
      const body = await response.text().catch(() => "");
      let status: unknown;
      try {
        status = (JSON.parse(body) as { status?: unknown }).status;
      } catch {
        status = undefined;
      }
      if (
        status === failure.errorCode &&
        request.postData()?.includes(failure.cellId) &&
        request.postData()?.includes(failure.projectId)
      )
        markSeen();
    };
    page.on("response", onResponse);
    return {
      verify: async () => {
        const seen = await Promise.race([
          seenPromise,
          new Promise<false>((resolve) =>
            setTimeout(() => resolve(false), 10_000),
          ),
        ]);
        if (!seen)
          throw new Error(
            `Expected ${failure.status} ${failure.errorCode} from start-notebook-run was not observed`,
          );
      },
      dispose: () => void page.off("response", onResponse),
    };
  });
}
