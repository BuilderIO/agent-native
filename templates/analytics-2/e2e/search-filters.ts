import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";
import { z } from "zod";

export async function checkSearchFilters(
  page: Page,
  base: string,
): Promise<void> {
  const query = `missing-${randomUUID()}`;
  await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
  const title = `Search agent fixture ${randomUUID()}`;
  const headers = {
    "x-agent-native-frontend": "1",
    "x-agent-native-csrf": "1",
  };
  const created = await page.request.post(
    `${base}/_agent-native/actions/create-project`,
    {
      headers,
      data: { title },
    },
  );
  expect(created.ok()).toBe(true);
  const { id } = z
    .object({ id: z.string().min(1) })
    .parse(await created.json());
  try {
    const params = new URLSearchParams({ text: title });
    const response = await page.request.get(
      `${base}/_agent-native/actions/search-workspace?${params}`,
      { headers },
    );
    expect(response.ok()).toBe(true);
    const result = z
      .object({
        results: z.array(z.object({ kind: z.string(), id: z.string() })),
      })
      .parse(await response.json());
    expect(
      result.results
        .filter((row) => row.kind === "project")
        .map((row) => row.id),
    ).toEqual([id]);
  } finally {
    const trashed = await page.request.post(
      `${base}/_agent-native/actions/trash-project`,
      { headers, data: { projectId: id } },
    );
    if (!trashed.ok())
      throw new Error(`Could not trash search fixture (${trashed.status()})`);
    const deleted = await page.request.post(
      `${base}/_agent-native/actions/delete-project`,
      { headers, data: { projectId: id } },
    );
    if (!deleted.ok())
      throw new Error(`Could not delete search fixture (${deleted.status()})`);
    const readback = await page.request.get(
      `${base}/_agent-native/actions/get-project?${new URLSearchParams({ projectId: id })}`,
      { headers },
    );
    expect(readback.status()).toBe(404);
  }
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Search your workspace" });
  const input = dialog.getByRole("textbox", { name: "Search your workspace" });
  const searchRequest = (match?: (params: URLSearchParams) => boolean) =>
    page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.pathname.endsWith("/actions/search-workspace") &&
        url.searchParams.get("text") === query &&
        (!match || match(url.searchParams))
      );
    });
  const completedSearch = async (
    pending: Promise<import("@playwright/test").Request>,
  ) => {
    const request = await pending;
    const response = await request.response();
    expect(response?.ok()).toBe(true);
    return new URL(request.url()).searchParams;
  };
  const first = searchRequest();
  await input.fill(query);
  await completedSearch(first);
  await expect(
    dialog.getByText("No results found", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("Try a different phrase or loosen the filters."),
  ).toHaveCount(0);
  const archiveRequest = searchRequest();
  await dialog.getByRole("switch", { name: "Include archived" }).click();
  expect((await completedSearch(archiveRequest)).get("includeArchived")).toBe(
    "true",
  );
  await expect(dialog.getByRole("button", { name: "Reset all" })).toHaveCount(
    0,
  );
  await dialog.getByRole("button", { name: "Search by", exact: true }).click();
  const fieldRequest = searchRequest((params) =>
    params.getAll("fields[]").includes("cellContents"),
  );
  await dialog
    .getByRole("menuitemcheckbox", { name: "Description", exact: true })
    .click();
  expect((await completedSearch(fieldRequest)).getAll("fields[]")).toEqual([
    "title",
    "cellContents",
  ]);
  await dialog.getByRole("button", { name: "Date", exact: true }).click();
  const day = dialog.locator('.ws-calendar-day[data-in-month="true"]').first();
  const dateRequest = searchRequest();
  await day.click();
  expect((await completedSearch(dateRequest)).get("dateFrom")).not.toBeNull();
  const resetRequests: string[] = [];
  const onRequest = (request: import("@playwright/test").Request) => {
    if (new URL(request.url()).pathname.endsWith("/actions/search-workspace"))
      resetRequests.push(request.url());
  };
  page.on("request", onRequest);
  try {
    const quickRequest = searchRequest(
      (params) => params.get("projectsOnly") === "true",
    );
    const resetRequest = searchRequest((params) =>
      params.getAll("fields[]").includes("cellContents"),
    );
    await dialog
      .getByRole("button", { name: "Reset all", exact: true })
      .click();
    const [, params] = await Promise.all([
      completedSearch(quickRequest),
      completedSearch(resetRequest),
    ]);
    expect(params.get("text")).toBe(query);
    expect(params.getAll("fields[]")).toEqual([
      "title",
      "description",
      "cellContents",
    ]);
    expect(params.get("dateFrom")).toBeNull();
    expect(params.get("dateTo")).toBeNull();
    expect(params.get("includeArchived")).toBe("false");
    expect(params.getAll("creatorIds[]")).toEqual([]);
    expect(params.getAll("categoryIds[]")).toEqual([]);
    expect(params.getAll("statusIds[]")).toEqual([]);
    await expect(input).toHaveValue(query);
    await expect(
      dialog.getByRole("button", { name: "Search by", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Date", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("switch", { name: "Include archived" }),
    ).toHaveAttribute("aria-checked", "false");
    await expect(dialog.getByRole("button", { name: "Reset all" })).toHaveCount(
      0,
    );
    expect(resetRequests).toHaveLength(2);
    const requests = resetRequests.map((value) => new URL(value).searchParams);
    const quick = requests.filter(
      (request) => request.get("projectsOnly") === "true",
    );
    const full = requests.filter((request) => !request.has("projectsOnly"));
    expect(quick).toHaveLength(1);
    expect(full).toHaveLength(1);
    expect(quick.map((request) => request.getAll("fields[]"))).toEqual([
      ["title", "description"],
    ]);
    expect(full.map((request) => request.getAll("fields[]"))).toEqual([
      ["title", "description", "cellContents"],
    ]);
    const sharedParams = (request: URLSearchParams) => {
      const shared = new URLSearchParams(request);
      shared.delete("fields[]");
      shared.delete("projectsOnly");
      shared.sort();
      return shared.toString();
    };
    expect(quick.map(sharedParams)).toEqual(full.map(sharedParams));
    await page.screenshot({
      path: ".tmp/analytics-owner/report-search-filters.png",
      fullPage: true,
    });
  } finally {
    page.off("request", onRequest);
  }

  const threadQuery = `thread-fixture-${randomUUID()}`;
  const threadRoute = (url: URL) =>
    url.pathname.endsWith("/actions/search-workspace") &&
    url.searchParams.get("text") === threadQuery;
  await page.route(threadRoute, (route) =>
    route.fulfill({
      json: {
        results: [
          {
            kind: "thread",
            id: "empty",
            title: "",
            href: "/thread/empty",
            updatedAt: "2026-11-08T10:00:00.000Z",
          },
          {
            kind: "thread",
            id: "named",
            title: "New thread",
            href: "/thread/named",
            updatedAt: "2026-11-08T10:00:00.000Z",
          },
        ],
      },
    }),
  );
  try {
    await input.fill(threadQuery);
    await expect(dialog.getByText("My Threads", { exact: true })).toBeVisible();
    await expect(
      dialog.getByRole("menuitem", { name: /Untitled thread/ }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("menuitem", { name: /New thread/ }),
    ).toBeVisible();
  } finally {
    await page.unrouteAll({ behavior: "wait" });
  }
}
