import { randomUUID } from "node:crypto";

import { expect, type Page, type Request } from "@playwright/test";
import { z } from "zod";

const collectionsSchema = z.object({
  collections: z.array(
    z.object({ id: z.string(), name: z.string(), description: z.string() }),
  ),
});

export async function checkHomeCreateCollection(page: Page, base: string) {
  const name = `QA collection ${randomUUID()}`;
  const headers = {
    "x-agent-native-frontend": "1",
    "x-agent-native-csrf": "1",
  };
  const createRequests: Request[] = [];
  const trackCreate = (request: Request) => {
    if (
      request.method() === "POST" &&
      request.url() === `${base}/_agent-native/actions/create-collection`
    )
      createRequests.push(request);
  };
  const readCollections = async () => {
    const response = await page.request.get(
      `${base}/_agent-native/actions/list-collections`,
      { headers },
    );
    if (!response.ok())
      throw new Error(`Could not read collections (${response.status()})`);
    return collectionsSchema.parse(await response.json()).collections;
  };
  page.on("request", trackCreate);
  try {
    await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Create new", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "New collection", exact: true })
      .click();
    await expect(page).toHaveURL(
      `${base}/home/collections?dialog=create-collection`,
    );
    const dialog = page.getByRole("dialog", { name: "Create new collection" });
    await dialog.getByLabel("Name", { exact: true }).fill(name);
    await dialog
      .getByLabel("Description", { exact: true })
      .fill("Created from Home");
    const created = page.waitForResponse(
      (response) =>
        response.url() === `${base}/_agent-native/actions/create-collection` &&
        response.request().method() === "POST" &&
        response.ok(),
    );
    await dialog
      .getByRole("button", { name: "Create collection", exact: true })
      .click();
    const id = z
      .object({ id: z.string().min(1) })
      .parse(await (await created).json()).id;
    await expect(dialog).toHaveCount(0);
    expect((await readCollections()).filter((item) => item.id === id)).toEqual([
      { id, name, description: "Created from Home" },
    ]);
  } finally {
    page.off("request", trackCreate);
    let uncertain: Error | undefined;
    for (const request of createRequests) {
      try {
        const response = await Promise.race([
          request.response(),
          new Promise<never>((_resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error("Collection create did not settle")),
              30000,
            );
            timer.unref();
          }),
        ]);
        if (!response)
          throw new Error("Collection create returned no response");
        const failure = await response.finished();
        if (failure) throw failure;
      } catch (error) {
        uncertain = new Error(
          "Collection creation outcome could not be confirmed",
          { cause: error },
        );
      }
    }
    const owned = (await readCollections()).filter(
      (item) => item.name === name,
    );
    for (const item of owned) {
      const response = await page.request.post(
        `${base}/_agent-native/actions/delete-collection`,
        { headers, data: { collectionId: item.id } },
      );
      if (!response.ok())
        throw new Error(
          `Could not clean Home collection (${response.status()})`,
        );
    }
    expect(
      (await readCollections()).filter((item) => item.name === name),
    ).toEqual([]);
    if (uncertain) throw uncertain;
  }
}
