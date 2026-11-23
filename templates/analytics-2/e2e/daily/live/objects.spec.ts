import { randomUUID } from "node:crypto";

import { z } from "zod";

import { publishBrowserFixture } from "../../publish-fixture";
import { checkRecentProjectControls } from "../../recent-project-controls";
import { safeRequest } from "../../safe-request";
import { expect, test } from "./fixtures";

test("OBJECTS-16 Jump back in star persists and published row opens its draft", async ({
  page,
  context,
  base,
}) => {
  test.setTimeout(120_000);
  const title = `QA recent controls ${randomUUID()}`;
  const action = async (
    name: string,
    data: Record<string, unknown>,
    method: "GET" | "POST" = "POST",
  ) => {
    const response = await safeRequest(
      `${method} /_agent-native/actions/${name}`,
      () =>
        context.request.fetch(`${base}/_agent-native/actions/${name}`, {
          method,
          headers: {
            "x-agent-native-frontend": "1",
            "x-agent-native-csrf": "1",
          },
          ...(method === "GET"
            ? { params: z.record(z.string(), z.string()).parse(data) }
            : { data }),
        }),
    );
    expect(response.status(), `${name} succeeded`).toBe(200);
    return response.json();
  };
  const project = z
    .object({ id: z.string() })
    .parse(await action("create-project", { title }));
  try {
    await action("add-project-cell", {
      projectId: project.id,
      kind: "markdown",
    });
    await publishBrowserFixture(page, base, project.id);
    await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
    await checkRecentProjectControls({
      page,
      base,
      project: { ...project, title },
      savedFavorite: async () => {
        const result = z
          .object({
            projects: z.array(
              z.object({ id: z.string(), favorited: z.boolean() }),
            ),
          })
          .parse(await action("list-projects", {}, "GET"));
        const match = result.projects.find((item) => item.id === project.id);
        expect(match).toBeDefined();
        return match?.favorited;
      },
      toast: (text) =>
        page
          .locator('[data-sonner-toast], [role="status"], [role="alert"]')
          .filter({ hasText: text }),
    });
  } finally {
    await page.close();
    await action("trash-project", { projectId: project.id });
    await action("delete-project", { projectId: project.id });
    const absent = await safeRequest(
      "GET /_agent-native/actions/get-project",
      () =>
        context.request.get(`${base}/_agent-native/actions/get-project`, {
          params: { projectId: project.id },
        }),
    );
    expect(absent.status(), "Owned QA project was deleted").toBe(404);
  }
});
