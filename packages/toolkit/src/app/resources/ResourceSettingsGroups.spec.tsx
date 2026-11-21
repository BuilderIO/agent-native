// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import {
  resourceWriteError,
  type ResourceMeta,
} from "@agent-native/core/client/resources/use-resources";
import { IconBook } from "@tabler/icons-react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  ResourceSettingsGroups,
  type ResourceSourceTree,
} from "./ResourceSettingsGroups.js";

vi.mock(
  "@agent-native/core/client/resources/use-skill-choices",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/core/client/resources/use-skill-choices")
    >()),
    useSkillChoices: () => ({
      choices: { marks: {}, switches: {} },
      canMark: false,
      isLoaded: true,
    }),
  }),
);

const skill: ResourceMeta = {
  id: "workspace-skill",
  path: "skills/learn-shared/SKILL.md",
  owner: "__organization__:org-1",
  mimeType: "text/markdown",
  size: 20,
  createdAt: 0,
  updatedAt: 0,
  createdBy: "system",
  visibility: "workspace",
  threadId: null,
  runId: null,
  expiresAt: null,
  metadata: null,
};
const emptyTree: ResourceSourceTree = {
  nodes: [],
  isLoading: false,
  isError: false,
  retry: () => {},
};
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function openSkillMenu(
  resource: ResourceMeta,
  onRemove: (resource: ResourceMeta) => Promise<void>,
) {
  await act(async () =>
    root.render(
      <AgentNativeI18nProvider persistPreference={false}>
        <ResourceSettingsGroups
          groups={[
            {
              id: "organization",
              view: "skills",
              sources: ["shared"],
              emptyTitle: "No skills",
              emptyIcon: IconBook,
            },
          ]}
          trees={{
            personal: emptyTree,
            workspace: emptyTree,
            shared: {
              ...emptyTree,
              nodes: [
                {
                  type: "file",
                  kind: "skill",
                  name: "SKILL.md",
                  path: resource.path,
                  resource,
                },
              ],
            },
          }}
          canEditOrg
          orgName="Test org"
          deletingId={null}
          onOpen={() => {}}
          onRemove={onRemove}
        />
      </AgentNativeI18nProvider>,
    ),
  );
  const trigger = container.querySelector('button[aria-label="More actions"]');
  if (!trigger) throw new Error("Missing skill actions menu");
  await act(async () =>
    trigger.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
    ),
  );
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

it("keeps a built-in inherited skill accessible without offering Remove", async () => {
  const inherited: ResourceMeta = {
    ...skill,
    owner: "__shared__",
    inheritedFromAppDefault: true,
  };
  const items = await openSkillMenu(inherited, vi.fn());
  expect(items.map((item) => item.textContent)).toEqual(["Open", "Download"]);
});

it("keeps the remove confirmation open with the server's reason after a refusal", async () => {
  const reason = "Resource changed before it could be deleted";
  const onRemove = vi.fn(async () => {
    throw await resourceWriteError(
      Response.json({ error: reason }, { status: 409 }),
      "Delete failed",
    );
  });
  const items = await openSkillMenu(skill, onRemove);
  const remove = items.find((item) => item.textContent === "Remove");
  if (!remove) throw new Error("Missing Remove action for organization skill");
  await act(async () => remove.click());
  const confirm = [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[role="alertdialog"] button',
    ),
  ].find((button) => button.textContent === "Remove");
  if (!confirm) throw new Error("Missing Remove confirmation");
  await act(async () => confirm.click());

  expect(onRemove).toHaveBeenCalledWith(skill);
  expect(
    document.querySelector('[role="alertdialog"] [role="alert"]')?.textContent,
  ).toBe(reason);
});
