// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemGroupHeader,
  ItemGroupLabel,
  ItemMedia,
  type ItemProps,
  ItemTitle,
} from "./item.js";

afterEach(cleanup);

describe("Item part", () => {
  it("draws each piece with its class, size 2 ghost rows in a ghost group by default", () => {
    render(
      <section>
        <ItemGroupHeader>
          <ItemGroupLabel>Notifications</ItemGroupLabel>
        </ItemGroupHeader>
        <ItemGroup data-testid="group">
          <Item data-testid="row">
            <ItemMedia framed>
              <svg />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Error emails</ItemTitle>
              <ItemDescription>When a run fails.</ItemDescription>
            </ItemContent>
            <ItemActions>
              <button type="button">Edit</button>
            </ItemActions>
            <ItemFooter>Details</ItemFooter>
          </Item>
        </ItemGroup>
      </section>,
    );
    const group = screen.getByTestId("group");
    expect(group.className).toBe("item-group");
    expect(group.dataset.variant).toBe("ghost");
    const row = screen.getByTestId("row");
    expect(row.className).toBe("item");
    expect(row.dataset.size).toBe("2");
    expect(row.dataset.variant).toBe("ghost");
    expect(
      screen.getByRole("heading", { name: "Notifications" }).className,
    ).toBe("item-group-label");
    const media = row.querySelector(".item-media");
    expect(media?.getAttribute("data-framed")).toBe("");
    expect(media?.getAttribute("aria-hidden")).toBe("true");
    for (const piece of [
      "item-content",
      "item-title",
      "item-description",
      "item-actions",
      "item-footer",
    ]) {
      expect(row.querySelector(`.${piece}`), piece).not.toBeNull();
    }
  });

  it("sets no list roles of its own, so mixed content stays valid", () => {
    render(
      <ItemGroup data-testid="group">
        <Item data-testid="row">Row</Item>
        <p>Not a row</p>
      </ItemGroup>,
    );
    expect(screen.getByTestId("group").getAttribute("role")).toBeNull();
    expect(screen.getByTestId("row").getAttribute("role")).toBeNull();
  });

  it("hides a group label visually while keeping its name", () => {
    render(<ItemGroupLabel visuallyHidden>Usage</ItemGroupLabel>);
    const label = screen.getByRole("heading", { name: "Usage" });
    expect(label.dataset.visuallyHidden).toBe("");
  });

  it("writes the variants and size it is given", () => {
    render(
      <ItemGroup data-testid="group" variant="outline">
        <Item data-testid="row" size="1" variant="soft">
          <ItemMedia data-testid="media">
            <span>AL</span>
          </ItemMedia>
        </Item>
      </ItemGroup>,
    );
    expect(screen.getByTestId("group").dataset.variant).toBe("outline");
    const row = screen.getByTestId("row");
    expect(row.dataset.size).toBe("1");
    expect(row.dataset.variant).toBe("soft");
    const media = screen.getByTestId("media");
    expect(media.hasAttribute("data-framed")).toBe(false);
    expect(media.hasAttribute("aria-hidden")).toBe(false);
  });

  it("refuses a variant it doesn't have instead of drawing the default", () => {
    const props = { variant: "solid" } as unknown as ItemProps;
    expect(() => render(<Item {...props}>Row</Item>)).toThrow(
      /variant="solid" is not one of/,
    );
  });

  it("renders as a link or a button through render", () => {
    render(
      <>
        <Item render={<a href="/profile" />} size="1">
          Profile
        </Item>
        <Item render={<button type="button" />}>History</Item>
      </>,
    );
    const link = screen.getByRole("link", { name: "Profile" });
    expect(link.className).toBe("item");
    expect(link.dataset.size).toBe("1");
    const button = screen.getByRole("button", { name: "History" });
    expect(button.className).toBe("item");
  });
});
