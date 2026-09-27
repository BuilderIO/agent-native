// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  contacts: [
    { name: "Ada Example", email: "ada@example.test", count: 12 },
    { name: "Adam Example", email: "adam@example.test", count: 6 },
    { name: "Bea Example", email: "bea@example.test", count: 1 },
  ],
  aliases: [] as Array<{
    id: string;
    name: string;
    emails: string[];
    createdAt: string;
    updatedAt: string;
  }>,
  navigate: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: any) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
}));

vi.mock("@/hooks/use-aliases", () => ({
  useAliases: () => ({ data: mocks.aliases }),
  useCreateAlias: () => ({
    isPending: false,
    mutateAsync: async () => undefined,
  }),
}));

vi.mock("@/hooks/use-emails", () => ({
  useContacts: () => ({ data: mocks.contacts }),
}));

vi.mock("@/lib/alias-utils", () => ({
  ALIAS_PREFIX: "alias:",
  aliasIdFromToken: (value: string) => value.slice("alias:".length),
  isAliasToken: (value: string) => value.startsWith("alias:"),
}));

import { RecipientInput } from "./RecipientInput";

function RecipientHarness({ initialValue = "" }: { initialValue?: string }) {
  const [value, setValue] = useState(initialValue);
  return (
    <RecipientInput
      value={value}
      onChange={setValue}
      placeholder="To"
      ariaLabel="To recipients"
    />
  );
}

describe("RecipientInput autocomplete interaction", () => {
  beforeEach(() => {
    mocks.contacts.splice(
      0,
      mocks.contacts.length,
      { name: "Ada Example", email: "ada@example.test", count: 12 },
      { name: "Adam Example", email: "adam@example.test", count: 6 },
      { name: "Bea Example", email: "bea@example.test", count: 1 },
    );
    mocks.aliases.splice(0, mocks.aliases.length);
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps ArrowDown, Enter, and the active descendant on the same contact", () => {
    render(<RecipientHarness />);
    const input = screen.getByRole("combobox") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "ad" } });

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(input.getAttribute("aria-activedescendant")).toBe(
      options[0].getAttribute("id"),
    );

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(
      options[1].getAttribute("id"),
    );

    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("adam@example.test")).toBeTruthy();
    expect(input.value).toBe("");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("moves up through suggestions and selects the active contact with Tab", () => {
    render(<RecipientHarness />);
    const input = screen.getByRole("combobox") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "ad" } });
    const options = screen.getAllByRole("option");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(
      options[1].getAttribute("id"),
    );

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(
      options[0].getAttribute("id"),
    );

    fireEvent.keyDown(input, { key: "Tab" });
    expect(screen.getByText("ada@example.test")).toBeTruthy();
    expect(input.value).toBe("");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("resets the active suggestion when the query changes", () => {
    render(<RecipientHarness />);
    const input = screen.getByRole("combobox") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "ad" } });
    const initialOptions = screen.getAllByRole("option");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(initialOptions[1].getAttribute("aria-selected")).toBe("true");

    fireEvent.change(input, { target: { value: "a" } });
    const updatedOptions = screen.getAllByRole("option");
    expect(updatedOptions[0].getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(
      updatedOptions[0].getAttribute("id"),
    );
  });

  it("dismisses suggestions with Escape without discarding the query", () => {
    render(<RecipientHarness />);
    const input = screen.getByRole("combobox") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "ad" } });
    expect(screen.getAllByRole("option")).toHaveLength(2);

    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("ad");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryAllByRole("option")).toHaveLength(0);

    fireEvent.change(input, { target: { value: "bea" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(input.getAttribute("aria-expanded")).toBe("true");
  });

  it("does not add a case-insensitive duplicate and filters its contact suggestion", () => {
    render(<RecipientHarness initialValue="ADA@example.test" />);
    const input = screen.getByRole("combobox") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "ada@" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);

    fireEvent.change(input, { target: { value: "ada@example.test" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getAllByText("ADA@example.test")).toHaveLength(1);
    expect(input.value).toBe("");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("preserves ranked same-name contacts and matches an exact address case-insensitively", () => {
    mocks.contacts.splice(
      0,
      mocks.contacts.length,
      {
        name: "Jordan Example",
        email: "frequent@example.test",
        count: 12,
      },
      { name: "Avery Example", email: "jordan@example.test", count: 6 },
      {
        name: "Jordan Example",
        email: "less-frequent@example.test",
        count: 1,
      },
    );
    render(<RecipientHarness />);
    const input = screen.getByRole("combobox") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "Jordan Example" } });
    const sameNameOptions = screen.getAllByRole("option");
    expect(sameNameOptions).toHaveLength(2);
    expect(sameNameOptions[0].textContent).toContain("frequent@example.test");
    expect(sameNameOptions[1].textContent).toContain(
      "less-frequent@example.test",
    );

    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("frequent@example.test")).toBeTruthy();

    fireEvent.change(input, { target: { value: "JORDAN@EXAMPLE.TEST" } });
    const exactAddressOptions = screen.getAllByRole("option");
    expect(exactAddressOptions).toHaveLength(1);
    expect(exactAddressOptions[0].textContent).toContain("Avery Example");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("jordan@example.test")).toBeTruthy();
  });

  it("locks a single pasted address into a chip on blur", () => {
    render(<RecipientHarness />);
    const input = screen.getByRole("combobox") as HTMLInputElement;

    fireEvent.paste(input, {
      clipboardData: { getData: () => "ada@example.test" },
    });
    fireEvent.change(input, { target: { value: "ada@example.test" } });
    expect(input.value).toBe("ada@example.test");

    fireEvent.blur(input);
    expect(screen.getByText("ada@example.test")).toBeTruthy();
    expect(input.value).toBe("");
  });

  it("names the recipient field and chip removal control", () => {
    render(<RecipientHarness initialValue="ada@example.test" />);
    const input = screen.getByRole("combobox") as HTMLInputElement;

    expect(input.getAttribute("aria-label")).toBe("To recipients");

    const removeButton = screen.getByRole("button", {
      name: "mail.recipients.removeRecipient",
    });
    fireEvent.click(removeButton);

    expect(screen.queryByText("ada@example.test")).toBeNull();
  });

  it("keeps malformed recipient text visible after blur instead of committing it", () => {
    render(<RecipientHarness />);
    const input = screen.getByRole("combobox") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "unfinished recipient" } });
    fireEvent.blur(input);

    expect(input.value).toBe("unfinished recipient");
    expect(screen.queryByText("unfinished recipient")).toBeNull();
  });

  it("splits pasted addresses, dedupes case-insensitively, and preserves leftovers", () => {
    render(<RecipientHarness initialValue="ADA@example.test" />);
    const input = screen.getByRole("combobox") as HTMLInputElement;

    fireEvent.paste(input, {
      clipboardData: {
        getData: () =>
          "ada@example.test; BEA@example.test\nnot-an-address, bea@example.test",
      },
    });

    expect(screen.getAllByText("ADA@example.test")).toHaveLength(1);
    expect(screen.getByText("BEA@example.test")).toBeTruthy();
    expect(input.value).toBe("not-an-address");
  });

  it("uses the hovered contact on mouse selection without replacing existing chips", () => {
    render(<RecipientHarness initialValue="ada@example.test" />);
    const input = screen.getByRole("combobox") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "be" } });
    const [option] = screen.getAllByRole("option");
    fireEvent.mouseEnter(option);
    expect(input.getAttribute("aria-activedescendant")).toBe(
      option.getAttribute("id"),
    );
    fireEvent.mouseDown(option);

    expect(screen.getByText("ada@example.test")).toBeTruthy();
    expect(screen.getByText("bea@example.test")).toBeTruthy();
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps the keyboard-active contact suggestion in view", () => {
    mocks.contacts.splice(
      0,
      mocks.contacts.length,
      ...Array.from({ length: 8 }, (_, index) => ({
        name: `Person ${index + 1}`,
        email: `person${index + 1}@example.test`,
        count: 8 - index,
      })),
    );
    const scrollCalls: Array<{
      element: HTMLElement;
      options?: ScrollIntoViewOptions;
    }> = [];
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollIntoView",
    );
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: function (this: HTMLElement, options?: ScrollIntoViewOptions) {
        scrollCalls.push({ element: this, options });
      },
    });

    try {
      render(<RecipientHarness />);
      const input = screen.getByRole("combobox") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "Person" } });

      const options = screen.getAllByRole("option");
      expect(options).toHaveLength(8);
      const scrollContainer = screen.getByRole("listbox")
        .firstElementChild as HTMLElement;
      expect(scrollContainer.className).toContain("max-h-[200px]");

      for (let index = 0; index < 7; index += 1) {
        fireEvent.keyDown(input, { key: "ArrowDown" });
      }

      expect(options[7].getAttribute("aria-selected")).toBe("true");
      expect(scrollCalls[scrollCalls.length - 1]).toEqual({
        element: options[7],
        options: { block: "nearest" },
      });
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(
          HTMLElement.prototype,
          "scrollIntoView",
          originalDescriptor,
        );
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
      }
    }
  });

  it("selects the first visible result again after an empty query state", () => {
    render(<RecipientHarness />);
    const input = screen.getByRole("combobox") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "ad" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.change(input, { target: { value: "xy" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(input.getAttribute("aria-activedescendant")).toBeNull();

    fireEvent.change(input, { target: { value: "be" } });
    const [option] = screen.getAllByRole("option");
    expect(option.textContent).toContain("Bea Example");
    expect(option.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(
      option.getAttribute("id"),
    );

    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("bea@example.test")).toBeTruthy();
  });

  it("commits a typed address with comma and ignores an empty separator", () => {
    render(<RecipientHarness />);
    const input = screen.getByRole("combobox") as HTMLInputElement;

    fireEvent.change(input, { target: { value: " ada@example.test " } });
    fireEvent.keyDown(input, { key: "," });

    expect(screen.getByText("ada@example.test")).toBeTruthy();
    expect(input.value).toBe("");
    expect(input.getAttribute("aria-expanded")).toBe("false");

    fireEvent.keyDown(input, { key: "," });
    expect(screen.getAllByText("ada@example.test")).toHaveLength(1);
  });

  it("removes the last chip with Backspace only when the input is empty", () => {
    render(
      <RecipientHarness initialValue="ada@example.test, bea@example.test" />,
    );
    const input = screen.getByRole("combobox") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "draft" } });
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(screen.getByText("ada@example.test")).toBeTruthy();
    expect(screen.getByText("bea@example.test")).toBeTruthy();
    expect(input.value).toBe("draft");

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(screen.getByText("ada@example.test")).toBeTruthy();
    expect(screen.queryByText("bea@example.test")).toBeNull();
  });

  it("keeps alias and contact keyboard indexes aligned with visible options", () => {
    mocks.aliases.push({
      id: "team",
      name: "Ada Team",
      emails: ["first@example.test", "second@example.test"],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    render(<RecipientHarness />);
    const input = screen.getByRole("combobox") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "ad" } });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(options[0].textContent).toContain("Ada Team");
    expect(options[1].textContent).toContain("Ada Example");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(
      options[1].getAttribute("id"),
    );

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options[2].getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(
      options[2].getAttribute("id"),
    );

    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("adam@example.test")).toBeTruthy();
  });

  it("accepts an alias suggestion with Enter and resets the recipient query", () => {
    mocks.aliases.push({
      id: "team",
      name: "Ada Team",
      emails: ["first@example.test", "second@example.test"],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    render(<RecipientHarness />);
    const input = screen.getByRole("combobox") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "team" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("Ada Team")).toBeTruthy();
    expect(input.value).toBe("");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });
});
