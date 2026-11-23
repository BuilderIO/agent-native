import { expect, test, uniqueName } from "./fixtures";
import {
  openHome,
  projectUrl,
  searchDialog,
  searchInput,
  searchResponse,
  seedProject,
} from "./objects.helpers";

function observe<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

async function requireObserved<T>(promise: ReturnType<typeof observe<T>>) {
  const result = await promise;
  if (!result.ok) throw result.error;
  return result.value;
}

test("report A2-SEARCH-STALE-QUERY-ACTIVATION keeps old results from immediate Enter", async ({
  daily,
}) => {
  const oldTitle = uniqueName("Old search result");
  const newTitle = uniqueName("New search result");
  const oldProject = await seedProject(daily, oldTitle);
  const newProject = await seedProject(daily, newTitle);
  let releaseSearch = () => {};
  const searchGate = new Promise<void>((resolve) => {
    releaseSearch = resolve;
  });
  try {
    await openHome(daily);
    await daily.page
      .getByRole("button", { name: "Search", exact: true })
      .click();
    const input = searchInput(daily.page);
    const dialog = searchDialog(daily.page);
    const oldResponse = observe(searchResponse(daily, oldTitle));
    await input.fill(oldTitle);
    await requireObserved(oldResponse);
    await expect(dialog.getByText(oldTitle, { exact: true })).toBeVisible();
    await daily.page.route(
      "**/_agent-native/actions/search-workspace**",
      async (route) => {
        if (
          new URL(route.request().url()).searchParams.get("text") === newTitle
        )
          await searchGate;
        await route.continue();
      },
    );
    await input.fill("");
    await input.press("Enter");
    await expect(daily.page).toHaveURL(/\/home$/);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(oldTitle, { exact: true })).toHaveCount(0);
    const newResponse = observe(searchResponse(daily, newTitle));
    const newRequest = observe(
      daily.page.waitForRequest(
        (request) =>
          request.url().includes("/_agent-native/actions/search-workspace") &&
          new URL(request.url()).searchParams.get("text") === newTitle,
      ),
    );
    await input.fill(newTitle);
    await expect(dialog.getByText(oldTitle, { exact: true })).toHaveCount(0);
    await requireObserved(newRequest);
    await expect(dialog.getByText(oldTitle, { exact: true })).toHaveCount(0);
    releaseSearch();
    await requireObserved(newResponse);
    await expect(dialog.getByText(newTitle, { exact: true })).toBeVisible();
    await input.press("ArrowDown");
    await input.press("Enter");
    await expect(daily.page).toHaveURL(projectUrl(newProject.id));
    const saved = await daily.action<{
      project: { id: string; title: string };
    }>("get-project", { projectId: newProject.id }, "GET");
    expect(saved.project.id).toBe(newProject.id);
    expect(saved.project.title).toBe(newTitle);
  } finally {
    releaseSearch();
    await daily.page.unrouteAll({ behavior: "ignoreErrors" });
    await daily.open("/home");
    await daily.cleanupProject(oldProject.id);
    await daily.cleanupProject(newProject.id);
    for (const projectId of [oldProject.id, newProject.id]) {
      const readback = await daily.context.request.get(
        `${daily.server.base}/_agent-native/actions/get-project`,
        { params: { projectId } },
      );
      expect(readback.status()).toBe(404);
    }
  }
});
