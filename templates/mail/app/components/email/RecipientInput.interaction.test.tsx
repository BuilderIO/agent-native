// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  contacts: [
    { name: "Ada Example", email: "ada@example.test" },
    { name: "Adam Example", email: "adam@example.test" },
    { name: "Bea Example", email: "bea@example.test" },
  ],
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
  useAliases: () => ({ data: [] }),
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
  return <RecipientInput value={value} onChange={setValue} placeholder="To" />;
}

describe("RecipientInput autocomplete interaction", () => {
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

    // Step 1: ArrowDown activates the second match.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(
      options[1].getAttribute("id"),
    );

    // Step 2: ArrowUp returns both the active descendant and selection to Ada.
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(
      options[0].getAttribute("id"),
    );

    // Step 3: Tab accepts the active result and clears the query/listbox.
    fireEvent.keyDown(input, { key: "Tab" });
    expect(screen.getByText("ada@example.test")).toBeTruthy();
    expect(input.value).toBe("");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("dismisses suggestions with Escape without discarding the query", () => {
    render(<RecipientHarness />);
    const input = screen.getByRole("combobox") as HTMLInputElement;

    // Step 1: type a query and confirm its listbox is visible.
    fireEvent.change(input, { target: { value: "ad" } });
    expect(screen.getAllByRole("option")).toHaveLength(2);

    // Step 2: Escape hides suggestions but preserves the in-progress text.
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("ad");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryAllByRole("option")).toHaveLength(0);

    // Step 3: editing the query opens the matching list again.
    fireEvent.change(input, { target: { value: "bea" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(input.getAttribute("aria-expanded")).toBe("true");
  });

  it("does not add a case-insensitive duplicate and filters its contact suggestion", () => {
    render(<RecipientHarness initialValue="ADA@example.test" />);
    const input = screen.getByRole("combobox") as HTMLInputElement;

    // Step 1: the existing address is omitted from suggestions regardless of case.
    fireEvent.change(input, { target: { value: "ada@" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);

    // Step 2: explicitly confirming the same address still cannot duplicate a chip.
    fireEvent.change(input, { target: { value: "ada@example.test" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getAllByText("ADA@example.test")).toHaveLength(1);
    expect(input.value).toBe("");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("locks a single pasted address into a chip on blur", () => {
    render(<RecipientHarness />);
    const input = screen.getByRole("combobox") as HTMLInputElement;

    // Step 1: a single-token paste follows native input behavior.
    fireEvent.paste(input, {
      clipboardData: { getData: () => "ada@example.test" },
    });
    fireEvent.change(input, { target: { value: "ada@example.test" } });
    expect(input.value).toBe("ada@example.test");

    // Step 2: leaving the field commits a valid address as a chip.
    fireEvent.blur(input);
    expect(screen.getByText("ada@example.test")).toBeTruthy();
    expect(input.value).toBe("");
  });

  it("splits pasted addresses, dedupes case-insensitively, and preserves leftovers", () => {
    render(<RecipientHarness initialValue="ADA@example.test" />);
    const input = screen.getByRole("combobox") as HTMLInputElement;

    // Step 1: a multi-address paste intercepts the paste and adds valid new emails.
    fireEvent.paste(input, {
      clipboardData: {
        getData: () =>
          "ada@example.test; BEA@example.test\nnot-an-address, bea@example.test",
      },
    });

    // Step 2: existing/new duplicates are removed, valid casing is preserved,
    // and non-address text remains editable rather than silently disappearing.
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
});
