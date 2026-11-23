import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";
import { z } from "zod";

import { fetchUiAction } from "../ui-capability.js";

export const QA_EMAIL = "qa-fleet@builder.io";

export const actionHeaders = {
  "x-agent-native-frontend": "1",
  "x-agent-native-csrf": "1",
};

export async function callAction(
  page: Page,
  base: string,
  name: string,
  input: Record<string, unknown> = {},
  method: "GET" | "POST" = "POST",
): Promise<unknown> {
  const query =
    method === "GET" ? `?${new URLSearchParams(input as never)}` : "";
  const response = await fetchUiAction(
    page.request,
    base,
    `${base}/_agent-native/actions/${name}${query}`,
    {
      method,
      ...(method === "POST" ? { data: input } : {}),
    },
  );
  if (!response.ok()) throw new Error(`${name}: HTTP ${response.status()}`);
  return response.json();
}

export async function assertQaIdentity(page: Page, base: string) {
  const shell = z
    .object({
      user: z.object({ email: z.string() }),
      workspace: z.object({ id: z.string() }),
    })
    .parse(await callAction(page, base, "get-workspace-shell", {}, "GET"));
  expect(shell.user.email, "signed-in account is the QA account").toBe(
    QA_EMAIL,
  );
  return shell.workspace.id;
}

export function fixtureTitle(label: string) {
  return `QA ${label} ${randomUUID()}`;
}

export async function deleteProjectAndExpect404(
  page: Page,
  base: string,
  projectId: string,
) {
  await callAction(page, base, "trash-project", { projectId });
  await callAction(page, base, "delete-project", { projectId });
  const readback = await page.request.get(
    `${base}/_agent-native/actions/get-project?${new URLSearchParams({ projectId })}`,
    { headers: actionHeaders },
  );
  expect(readback.status(), "deleted fixture project reads back 404").toBe(404);
}
