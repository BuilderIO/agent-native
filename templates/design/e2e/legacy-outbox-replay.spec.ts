import { expect, test, type Page } from "@playwright/test";

import {
  appPath,
  createFixtureDesign,
  designFrame,
  gotoEditor,
} from "./helpers";

const OUTBOX_DATABASE = "agent-native-design-save-outbox";
const OUTBOX_STORE = "entries";

async function action(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await page.request.post(
    appPath(`/_agent-native/actions/${name}`),
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function readDesign(page: Page, designId: string) {
  const response = await page.request.get(
    appPath(
      `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
    ),
  );
  if (!response.ok()) throw new Error(`get-design: ${await response.text()}`);
  return (await response.json()) as {
    files?: Array<{ content?: string; filename?: string; id?: string }>;
  };
}

async function seedLegacyOutboxEntry(
  page: Page,
  entry: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(
    async ({ databaseName, storeName, value }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName, 2);
        request.onupgradeneeded = () => {
          const database = request.result;
          const store = database.objectStoreNames.contains(storeName)
            ? request.transaction?.objectStore(storeName)
            : database.createObjectStore(storeName, { keyPath: "key" });
          if (store && !store.indexNames.contains("by-design-id")) {
            store.createIndex("by-design-id", "designId", { unique: false });
          }
          if (store && !store.indexNames.contains("by-updated-at")) {
            store.createIndex("by-updated-at", "updatedAt", { unique: false });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("Outbox open was blocked"));
      });

      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        transaction.objectStore(storeName).put(value);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      database.close();
    },
    { databaseName: OUTBOX_DATABASE, storeName: OUTBOX_STORE, value: entry },
  );
}

async function hasOutboxEntry(page: Page, key: string): Promise<boolean> {
  return await page.evaluate(
    async ({ databaseName, storeName, entryKey }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const exists = await new Promise<boolean>((resolve, reject) => {
        const transaction = database.transaction(storeName, "readonly");
        const request = transaction.objectStore(storeName).get(entryKey);
        request.onsuccess = () => resolve(request.result !== undefined);
        request.onerror = () => reject(request.error);
      });
      database.close();
      return exists;
    },
    { databaseName: OUTBOX_DATABASE, storeName: OUTBOX_STORE, entryKey: key },
  );
}

async function getSessionActorScope(page: Page): Promise<string> {
  const response = await page.request.get(
    appPath("/_agent-native/auth/session"),
  );
  if (!response.ok()) throw new Error(`session: ${await response.text()}`);
  const session = (await response.json()) as {
    email?: string;
    userId?: string;
  };
  if (!session.email) throw new Error("Authenticated session is unavailable");
  return session.userId ?? "anonymous";
}

test("legacy hashless outbox content rebases without overwriting newer source", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const designId = await createFixtureDesign(page, "Legacy outbox replay");
  const currentHtml = `<!doctype html><html lang="en" data-agent-native-node-id="legacy-outbox-html"><head><meta charset="utf-8"></head><body style="margin:0" data-agent-native-node-id="legacy-outbox-body"><main data-agent-native-node-id="legacy-outbox-main" style="padding:24px"><p data-agent-native-node-id="legacy-outbox-current">Newer server source</p></main></body></html>`;
  const staleHtml = `<!doctype html><html lang="en" data-agent-native-node-id="legacy-outbox-html"><head><meta charset="utf-8"></head><body style="margin:0" data-agent-native-node-id="legacy-outbox-body"><main data-agent-native-node-id="legacy-outbox-main" style="padding:24px"><p data-agent-native-node-id="legacy-outbox-stale">Stale queued source</p></main></body></html>`;

  try {
    const initialDesign = await readDesign(page, designId);
    const file = initialDesign.files?.find(
      (candidate) => candidate.filename === "index.html",
    );
    if (!file?.id) throw new Error("Missing index.html file ID");

    await action(page, "update-file", { id: file.id, content: currentHtml });
    await gotoEditor(page, designId);
    await expect(designFrame(page).locator("body")).toContainText(
      "Newer server source",
    );

    const actorScope = await getSessionActorScope(page);
    const operationSource = "legacy-outbox-before-versioned-saves";
    const key = [designId, actorScope, "update-file", file.id, operationSource]
      .map(encodeURIComponent)
      .join(":");
    await seedLegacyOutboxEntry(page, {
      key,
      designId,
      actorScope,
      actionName: "update-file",
      resourceId: file.id,
      operationSource,
      operationRevision: 1,
      payload: {
        id: file.id,
        content: staleHtml,
        operationSource,
        operationRevision: 1,
      },
      updatedAt: Date.now(),
    });

    const updateFilePayloads: Array<Record<string, unknown>> = [];
    page.on("request", (request) => {
      if (
        request.method() !== "POST" ||
        !new URL(request.url()).pathname.endsWith(
          "/_agent-native/actions/update-file",
        )
      ) {
        return;
      }
      updateFilePayloads.push(
        request.postDataJSON() as Record<string, unknown>,
      );
    });

    await page.reload();
    await expect(
      page.getByText(
        "This screen changed elsewhere. Your last edit was not saved.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(designFrame(page).locator("body")).toContainText(
      "Newer server source",
    );
    await expect
      .poll(() => hasOutboxEntry(page, key), { timeout: 10_000 })
      .toBe(false);

    expect(
      updateFilePayloads.filter(
        (payload) => payload.id === file.id && payload.content === staleHtml,
      ),
    ).toEqual([]);
    const finalDesign = await readDesign(page, designId);
    expect(
      finalDesign.files?.find((candidate) => candidate.id === file.id)?.content,
    ).toBe(currentHtml);
    await expect(
      designFrame(page).locator(
        '[data-agent-native-node-id="legacy-outbox-current"]',
      ),
    ).toHaveText("Newer server source");
  } finally {
    await action(page, "delete-design", { id: designId });
  }
});
