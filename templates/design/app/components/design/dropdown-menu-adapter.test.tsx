// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("expected element is missing");
  return value;
}

afterEach(() => {
  document.body.innerHTML = "";
});

async function mountMenu() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value="dark">
            <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuItem>
            Copy
            <DropdownMenuShortcut>C</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
  });
  return root;
}

function classesOf(element: Element) {
  return element.className.split(/\s+/);
}

describe("Design dropdown menu adapter", () => {
  it("replaces the toolkit row size, text size and highlight", async () => {
    const root = await mountMenu();
    const content = must(document.querySelector('[role="menu"]'));
    expect(classesOf(content)).toContain("p-1");

    const copy = must(
      [...document.querySelectorAll('[role="menuitem"]')].find((item) =>
        item.textContent.startsWith("Copy"),
      ),
    );
    const copyClasses = classesOf(copy);
    expect(copyClasses).toContain("min-h-[var(--design-control-height)]");
    expect(copyClasses).toContain("text-xs");
    expect(copyClasses).not.toContain("text-sm");
    expect(copyClasses).toContain(
      "data-[highlighted]:bg-[var(--design-brand)]",
    );
    expect(copyClasses).not.toContain("focus:bg-accent");
    expect(classesOf(must(copy.querySelector("span")))).toContain(
      "text-[11px]",
    );

    const label = must(
      [...document.querySelectorAll("div")].find(
        (node) => node.textContent === "Theme",
      ),
    );
    expect(classesOf(label)).toContain("text-[11px]");
    await act(async () => root.unmount());
  });

  it("marks the current radio value with a check", async () => {
    const root = await mountMenu();
    const dark = must(
      [...document.querySelectorAll('[role="menuitemradio"]')].find(
        (item) => item.textContent === "Dark",
      ),
    );
    expect(dark.getAttribute("aria-checked")).toBe("true");
    expect(dark.querySelector("svg.tabler-icon-check")).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("gives destructive rows the destructive color", async () => {
    const root = await mountMenu();
    const destructive = must(
      document.querySelector('[role="menuitem"][data-variant="destructive"]'),
    );
    expect(classesOf(destructive)).toContain(
      "text-[var(--design-destructive)]",
    );
    expect(destructive.hasAttribute("variant")).toBe(false);
    await act(async () => root.unmount());
  });
});
