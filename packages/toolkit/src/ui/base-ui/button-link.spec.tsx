// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Button, ButtonLink, IconButtonLink } from "./button.js";

afterEach(cleanup);

function attributes(element: Element) {
  return Object.fromEntries(
    [...element.attributes].map((attribute) => [
      attribute.name,
      attribute.value,
    ]),
  );
}

function RouterLink({
  to,
  ...props
}: Omit<React.ComponentProps<"a">, "href"> & { to: string }) {
  return <a {...props} href={`/app${to}`} data-router="" />;
}

describe("Button Link part", () => {
  it("is a link with Button's look and no button semantics", () => {
    render(
      <ButtonLink href="/docs" variant="soft" color="gray">
        Docs
      </ButtonLink>,
    );
    const link = screen.getByRole("link", { name: "Docs" });
    expect({
      buttons: screen.queryAllByRole("button").length,
      ...attributes(link),
    }).toEqual({
      buttons: 0,
      class: "button",
      href: "/docs",
      "data-size": "md",
      "data-variant": "soft",
      "data-color": "gray",
    });
  });

  it("draws with the same attributes as the Button it sits beside", () => {
    render(
      <>
        <Button size="md" variant="surface" color="danger" highContrast>
          Delete
        </Button>
        <ButtonLink
          href="/trash"
          size="md"
          variant="surface"
          color="danger"
          highContrast
        >
          Trash
        </ButtonLink>
      </>,
    );
    const pick = (element: Element) =>
      Object.fromEntries(
        Object.entries(attributes(element)).filter(
          ([name]) => name === "class" || name.startsWith("data-"),
        ),
      );
    expect(pick(screen.getByRole("link", { name: "Trash" }))).toEqual(
      pick(screen.getByRole("button", { name: "Delete" })),
    );
  });

  it("passes link attributes through for the current page and a new tab", () => {
    render(
      <>
        <ButtonLink href="/home" aria-current="page">
          Home
        </ButtonLink>
        <ButtonLink
          href="https://example.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          Example (opens in a new tab)
        </ButtonLink>
      </>,
    );
    const home = screen.getByRole("link", { name: "Home" });
    const external = screen.getByRole("link", {
      name: "Example (opens in a new tab)",
    });
    expect({
      current: home.getAttribute("aria-current"),
      target: external.getAttribute("target"),
      rel: external.getAttribute("rel"),
    }).toEqual({
      current: "page",
      target: "_blank",
      rel: "noopener noreferrer",
    });
  });

  it("renders as a router link and keeps its link role", () => {
    render(
      <ButtonLink render={<RouterLink to="/settings" />} className="extra">
        Settings
      </ButtonLink>,
    );
    const link = screen.getByRole("link", { name: "Settings" });
    expect({
      href: link.getAttribute("href"),
      router: link.hasAttribute("data-router"),
      classes: [...link.classList].sort(),
      size: link.getAttribute("data-size"),
    }).toEqual({
      href: "/app/settings",
      router: true,
      classes: ["button", "extra"],
      size: "md",
    });
  });

  it("forwards its ref to the anchor", () => {
    const ref = React.createRef<HTMLAnchorElement>();
    render(
      <ButtonLink ref={ref} href="/docs">
        Docs
      </ButtonLink>,
    );
    expect(ref.current?.tagName).toBe("A");
  });

  it("rejects a value outside the scale", () => {
    const invalid = { size: "5" } as unknown as { size: "sm" };
    expect(() =>
      render(
        <ButtonLink href="/docs" {...invalid}>
          Docs
        </ButtonLink>,
      ),
    ).toThrow(/size="5"/);
  });
});

describe("Icon Button Link part", () => {
  it("is an icon button that is a link, named by its label", () => {
    render(
      <IconButtonLink href="/help" aria-label="Help" variant="ghost">
        <svg aria-hidden="true" />
      </IconButtonLink>,
    );
    const link = screen.getByRole("link", { name: "Help" });
    expect({
      className: link.className,
      variant: link.getAttribute("data-variant"),
      buttons: screen.queryAllByRole("button").length,
    }).toEqual({ className: "icon-button", variant: "ghost", buttons: 0 });
  });
});
