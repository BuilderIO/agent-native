import { expect, type APIRequestContext } from "@playwright/test";

export async function resetInbox(request: APIRequestContext) {
  const listResponse = await request.get(
    "/_agent-native/actions/list-inbox-items",
    { headers: { "X-Agent-Native-Frontend": "1" } },
  );
  expect(listResponse.ok()).toBeTruthy();
  const { items } = (await listResponse.json()) as {
    items: Array<{ id: string }>;
  };

  for (const item of items) {
    const deleteResponse = await request.post(
      "/_agent-native/actions/delete-inbox-item",
      {
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Native-Frontend": "1",
        },
        data: { inboxItemId: item.id },
      },
    );
    expect(deleteResponse.ok()).toBeTruthy();
  }
}

export async function waitForInboxLoaded(
  page: import("@playwright/test").Page,
) {
  await expect(page.locator(".animate-pulse")).toHaveCount(0);
}

export function inboxItemTitleButton(
  page: import("@playwright/test").Page,
  title: string,
) {
  return page.getByRole("button", { name: title, exact: true });
}

export function inboxItemRowByTitle(
  page: import("@playwright/test").Page,
  title: string,
) {
  return page.locator("[data-inbox-item-id]").filter({
    has: inboxItemTitleButton(page, title),
  });
}

export async function createInboxItem(
  request: APIRequestContext,
  title: string,
) {
  const response = await request.post(
    "/_agent-native/actions/create-inbox-item",
    {
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Native-Frontend": "1",
      },
      data: { title },
    },
  );
  expect(response.ok()).toBeTruthy();
}

export async function gotoInboxPage(page: import("@playwright/test").Page) {
  await page.goto("/inbox");
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await waitForInboxLoaded(page);
}
