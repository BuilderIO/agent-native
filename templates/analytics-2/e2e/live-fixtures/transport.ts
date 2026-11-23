import type { Page } from "@playwright/test";

import { checkQueryCancellation } from "../query-cancellation.js";
import { checkEmptyQueryContinuation } from "../query-paging.js";
import { assertQaIdentity } from "./shared.js";

export class LiveFixtureUnavailable extends Error {}

async function refuseWhenRouteFetchUnauthenticated(run: () => Promise<void>) {
  try {
    await run();
  } catch (error) {
    if (
      error instanceof Error &&
      /Project fixture read: HTTP 401/.test(error.message)
    )
      throw new LiveFixtureUnavailable(
        "route.fetch from the intercepted transport is unauthenticated (HTTP 401) in the attached QA browser",
      );
    throw error;
  }
}

export async function checkQueryCancellationLive(page: Page, base: string) {
  const workspaceId = await assertQaIdentity(page, base);
  await refuseWhenRouteFetchUnauthenticated(() =>
    checkQueryCancellation(page, page.context(), base, workspaceId),
  );
}

export async function checkPagerEmptyContinuationLive(
  page: Page,
  base: string,
) {
  const workspaceId = await assertQaIdentity(page, base);
  await checkEmptyQueryContinuation({
    page,
    context: page.context(),
    base,
    workspaceId,
  });
}
