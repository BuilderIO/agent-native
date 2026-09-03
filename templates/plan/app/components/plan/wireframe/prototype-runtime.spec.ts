// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { mountPrototypeRuntime } from "./prototype-runtime";

const flush = async () => {
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  await Promise.resolve();
};

async function waitFor(assertion: () => void) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await flush();
    }
  }
  throw lastError;
}

describe("mountPrototypeRuntime", () => {
  it("runs a functional todo-style prototype without scripts", async () => {
    document.body.innerHTML = `
      <div id="root">
        <div x-data="{ draft: '', filter: 'all', todos: [{ text: 'Existing task', done: false }] }">
          <input aria-label="Task" x-model="draft" @keydown.enter="draft && todos.push({ text: draft, done: false }); draft = ''">
          <button class="primary" @click="draft && todos.push({ text: draft, done: false }); draft = ''">Add</button>
          <button data-filter="all" @click="filter = 'all'" :class="{ 'primary': filter === 'all' }">All</button>
          <button data-filter="done" @click="filter = 'done'" :class="{ 'primary': filter === 'done' }">Done</button>
          <button data-mark-all @click="setAll(todos, 'done', true)">Mark all done</button>
          <button data-clear-done @click="removeWhere(todos, 'done', true)">Clear done</button>
          <span data-total x-text="count(todos)"></span>
          <span data-done-count x-text="countWhere(todos, 'done', true)"></span>
          <span data-remaining x-text="remaining(todos, 'done')"></span>
          <div class="wf-box" x-for="todo in todos" x-show="filter === 'all' || (filter === 'done' && todo.done)" :class="{ 'is-done': todo.done }" :data-done="todo.done">
            <label><input type="checkbox" x-model="todo.done"><span x-text="todo.text"></span></label>
            <button data-remove @click="remove(todos, todo)">Remove</button>
          </div>
        </div>
      </div>
    `;
    const root = document.getElementById("root");
    expect(root).toBeInstanceOf(HTMLElement);
    const cleanup = mountPrototypeRuntime(root as HTMLElement);

    await flush();
    expect(root?.textContent).toContain("Existing task");

    const input = root?.querySelector<HTMLInputElement>(
      'input[aria-label="Task"]',
    );
    expect(input).toBeTruthy();
    input!.value = "Ship prototype";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    input!.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
    );
    await flush();

    expect(input!.value).toBe("");
    expect(root?.textContent).toContain("Ship prototype");
    expect(root?.querySelector("[data-total]")?.textContent).toBe("2");
    expect(root?.querySelector("[data-remaining]")?.textContent).toBe("2");

    const shipRow = Array.from(
      root!.querySelectorAll<HTMLElement>("[data-plan-prototype-clone-for]"),
    ).find((row) => row.textContent?.includes("Ship prototype"));
    expect(shipRow).toBeTruthy();
    const checkbox = shipRow!.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    checkbox!.checked = true;
    checkbox!.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    await waitFor(() => {
      const row = Array.from(
        root!.querySelectorAll<HTMLElement>("[data-plan-prototype-clone-for]"),
      ).find((item) => item.textContent?.includes("Ship prototype"));
      expect(row?.getAttribute("data-done")).toBe("true");
    });
    expect(root?.querySelector("[data-done-count]")?.textContent).toBe("1");
    expect(root?.querySelector("[data-remaining]")?.textContent).toBe("1");

    root
      ?.querySelector<HTMLButtonElement>('button[data-filter="done"]')
      ?.click();
    await flush();
    const visibleRows = Array.from(
      root!.querySelectorAll<HTMLElement>("[data-plan-prototype-clone-for]"),
    ).filter((row) => !row.hidden);
    expect(visibleRows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Ship prototype"),
    ]);

    visibleRows[0]
      ?.querySelector<HTMLButtonElement>("button[data-remove]")
      ?.click();
    await flush();
    expect(root?.textContent).not.toContain("Ship prototype");

    root?.querySelector<HTMLButtonElement>("button[data-mark-all]")?.click();
    await flush();
    expect(root?.querySelector("[data-done-count]")?.textContent).toBe("1");
    expect(root?.querySelector("[data-remaining]")?.textContent).toBe("0");

    root?.querySelector<HTMLButtonElement>("button[data-clear-done]")?.click();
    await flush();
    expect(root?.querySelector("[data-total]")?.textContent).toBe("0");

    cleanup();
  });
});
