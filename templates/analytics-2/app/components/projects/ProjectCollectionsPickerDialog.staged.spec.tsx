// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", async () => {
  const messages = (await import("../../i18n/en-US")).default as Record<
    string,
    unknown
  >;
  const lookup = (key: string): string => {
    let node: unknown = messages;
    for (const part of key.split(".")) {
      node = (node as Record<string, unknown> | undefined)?.[part];
    }
    return typeof node === "string" ? node : key;
  };
  return {
    useT: () => (key: string, values?: Record<string, string>) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replace(`{{${name}}}`, value),
        lookup(key),
      ),
  };
});

import { ProjectCollectionsPickerDialog } from "./ProjectCollectionsPickerDialog";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("A2-PROJECT-MENU-CONTROLS collection selection", () => {
  it("stages selections until Add project and cancels without writing", async () => {
    const node = document.createElement("div");
    document.body.append(node);
    const root = createRoot(node);
    const onToggle = vi.fn(async () => {});
    const onClose = vi.fn();
    await act(async () =>
      root.render(
        <ProjectCollectionsPickerDialog
          projectTitle="Revenue"
          collections={[
            { id: "a", name: "Available" },
            { id: "b", name: "Already filed" },
          ]}
          filedIds={["b"]}
          onClose={onClose}
          onToggle={onToggle}
          staged
        />,
      ),
    );
    expect(node.textContent).not.toContain("Already filed");
    const checkbox = node.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(checkbox).not.toBeNull();
    await act(async () => checkbox?.click());
    expect(onToggle).not.toHaveBeenCalled();
    const cancel = [...node.querySelectorAll("button")].find(
      (b) => b.textContent === "Cancel",
    );
    expect(cancel).toBeDefined();
    await act(async () => cancel?.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    node.remove();
  });
});

it("retries only failed additions after a partial save", async () => {
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  const onClose = vi.fn();
  const onToggle = vi.fn(async (id: string) => {
    if (
      id === "b" &&
      onToggle.mock.calls.filter(([value]) => value === "b").length === 1
    )
      throw new Error("Try again");
  });
  await act(async () =>
    root.render(
      <ProjectCollectionsPickerDialog
        projectTitle="Revenue"
        collections={[
          { id: "a", name: "First" },
          { id: "b", name: "Second" },
        ]}
        filedIds={[]}
        onClose={onClose}
        onToggle={onToggle}
        staged
      />,
    ),
  );
  const boxes = node.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  await act(async () => {
    boxes[0]?.click();
    boxes[1]?.click();
  });
  const add = [...node.querySelectorAll("button")].find(
    (b) => b.textContent === "Add project",
  );
  await act(async () => add?.click());
  expect(node.textContent).toContain("Try again");
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => add?.click());
  expect(onToggle.mock.calls.map(([id]) => id)).toEqual(["a", "b", "b"]);
  expect(onClose).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  node.remove();
});

async function mountStaged(
  collections: { id: string; name: string; canManage?: boolean }[],
  onToggle = vi.fn(async () => {}),
) {
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  await act(async () =>
    root.render(
      <ProjectCollectionsPickerDialog
        projectTitle="Revenue"
        collections={collections}
        filedIds={[]}
        onClose={() => {}}
        onToggle={onToggle}
        staged
      />,
    ),
  );
  return { node, root, onToggle };
}

describe("staged collection picker limits", () => {
  it("stops at 20 selections and says so", async () => {
    const collections = Array.from({ length: 22 }, (_, index) => ({
      id: `c${index}`,
      name: `Collection ${index}`,
    }));
    const { node, root } = await mountStaged(collections);
    const boxes = () => [
      ...node.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ];
    for (const box of boxes().slice(0, 20)) await act(async () => box.click());
    expect(node.textContent).toContain(
      "You can select up to 20 collections at once",
    );
    expect(boxes()[20]?.disabled).toBe(true);
    expect(boxes()[0]?.disabled).toBe(false);
    await act(async () => boxes()[0]?.click());
    expect(boxes()[20]?.disabled).toBe(false);
    await act(async () => root.unmount());
    node.remove();
  });

  it("disables a collection the member cannot manage, with the reason", async () => {
    const { node, root } = await mountStaged([
      { id: "m", name: "Managed", canManage: true },
      { id: "r", name: "Read only", canManage: false },
    ]);
    const boxes = node.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(boxes[0]?.disabled).toBe(false);
    expect(boxes[1]?.disabled).toBe(true);
    expect(boxes[1]?.closest("label")?.getAttribute("title")).toBe(
      "Must be collection manager to add project.",
    );
    await act(async () => root.unmount());
    node.remove();
  });

  it("shows the source's fixed failure text instead of a raw server message", async () => {
    const { node, root } = await mountStaged(
      [{ id: "a", name: "A" }],
      vi.fn(async () => {
        throw new Error("SQLSTATE 23505");
      }),
    );
    await act(async () =>
      node.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click(),
    );
    const add = [...node.querySelectorAll("button")].find(
      (b) => b.textContent === "Add project",
    );
    await act(async () => add?.click());
    expect(node.querySelector('[role="alert"]')?.textContent).toBe(
      "Error adding projects to collection. Try again, or contact support if the issue persists.",
    );
    await act(async () => root.unmount());
    node.remove();
  });
});
