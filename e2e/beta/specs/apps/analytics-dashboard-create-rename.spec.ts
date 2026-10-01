import { expect, test } from "@playwright/test";

import {
  assertSignedInOnBeta,
  runMarker,
  signedInContext,
  skipUnlessAuthed,
} from "../../lib/authed";
import { originFor, selectedSites, siteById } from "../../lib/fleet";
import { BETA_E2E_TEST_TRAFFIC_HEADERS } from "../../lib/test-traffic";

skipUnlessAuthed();

const selected = new Set(selectedSites().map((site) => site.id));
const site = siteById("analytics");
const origin = originFor(site);
const ACTION_HEADERS = {
  ...BETA_E2E_TEST_TRAFFIC_HEADERS,
  "X-Agent-Native-Frontend": "1",
};

type ActionResult = Record<string, unknown>;

async function runAction(
  page: import("@playwright/test").Page,
  name: string,
  data: Record<string, unknown>,
): Promise<ActionResult> {
  const response = await page.request.post(
    `${origin}/_agent-native/actions/${name}`,
    { data, headers: ACTION_HEADERS },
  );
  const result = (await response.json().catch(() => ({}))) as ActionResult;
  expect(
    response.ok(),
    `${name} should succeed (${response.status()}): ${JSON.stringify(result).slice(0, 500)}`,
  ).toBe(true);
  return result;
}

async function readAction(
  page: import("@playwright/test").Page,
  name: string,
  data: Record<string, string> = {},
): Promise<unknown> {
  const response = await page.request.get(
    `${origin}/_agent-native/actions/${name}`,
    { params: data, headers: ACTION_HEADERS },
  );
  const result: unknown = await response.json().catch(() => ({}));
  expect(
    response.ok(),
    `${name} should succeed (${response.status()}): ${JSON.stringify(result).slice(0, 500)}`,
  ).toBe(true);
  return result;
}

async function deleteAction(
  page: import("@playwright/test").Page,
  name: string,
  data: Record<string, unknown>,
): Promise<void> {
  const response = await page.request.delete(
    `${origin}/_agent-native/actions/${name}`,
    { data, headers: ACTION_HEADERS },
  );
  const result = await response.json().catch(() => ({}));
  expect(
    response.ok(),
    `${name} should succeed (${response.status()}): ${JSON.stringify(result).slice(0, 500)}`,
  ).toBe(true);
}

test("Analytics beta creates, renames, and removes a SQL dashboard", async ({
  browser,
}) => {
  test.skip(
    !selected.has("analytics"),
    "analytics is not in this run's selection",
  );

  const context = await signedInContext(browser, site, { seedModel: false });
  const page = await context.newPage();
  const dashboardId = `beta-e2e-${crypto.randomUUID()}`;
  const marker = `${runMarker("analytics dashboard create rename")} ${dashboardId}`;
  const renamed = `${marker} renamed`;
  let createAttempted = false;

  try {
    await assertSignedInOnBeta(context, site);

    createAttempted = true;
    const created = await runAction(page, "update-dashboard", {
      dashboardId,
      config: { name: marker, panels: [] },
    });
    expect(created).toMatchObject({ dashboardId, name: marker });

    const createdReadback = await readAction(page, "get-sql-dashboard", {
      id: dashboardId,
    });
    expect(createdReadback).toMatchObject({
      id: dashboardId,
      kind: "sql",
      name: marker,
      title: marker,
    });

    const renamedResult = await runAction(page, "rename-dashboard", {
      id: dashboardId,
      name: renamed,
    });
    expect(renamedResult).toMatchObject({ id: dashboardId, name: renamed });

    const renamedReadback = await readAction(page, "get-sql-dashboard", {
      id: dashboardId,
    });
    expect(renamedReadback).toMatchObject({
      id: dashboardId,
      kind: "sql",
      name: renamed,
      title: renamed,
    });
  } finally {
    try {
      if (createAttempted) {
        await deleteAction(page, "delete-sql-dashboard", { id: dashboardId });
        const deletedReadback = await page.request.get(
          `${origin}/_agent-native/actions/get-sql-dashboard`,
          { params: { id: dashboardId }, headers: ACTION_HEADERS },
        );
        expect(deletedReadback.status()).toBe(404);

        const dashboards = await readAction(page, "list-sql-dashboards", {
          archived: "all",
          hidden: "all",
        });
        expect(Array.isArray(dashboards)).toBe(true);
        expect(
          (dashboards as Array<{ id?: string }>).some(
            (dashboard) => dashboard.id === dashboardId,
          ),
          `SQL dashboard ${dashboardId} remained after cleanup`,
        ).toBe(false);
      }
    } finally {
      await context.close();
    }
  }
});
