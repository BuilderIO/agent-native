// @vitest-environment happy-dom

import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { describe, expect, it, vi } from "vitest";

import { defaultDesignSystemComponents } from "./default-adapter.js";

type TestElement = ReactElement<Record<string, unknown>>;

function findElement(
  node: ReactNode,
  predicate: (element: TestElement) => boolean,
): TestElement | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElement(child, predicate);
      if (match) return match;
    }
    return undefined;
  }
  if (!isValidElement(node)) return undefined;
  const element = node as TestElement;
  if (predicate(element)) return element;
  for (const child of Children.toArray(element.props.children as ReactNode)) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return undefined;
}

function renderComponent(
  component: unknown,
  props: Record<string, unknown>,
): TestElement {
  return (component as (props: Record<string, unknown>) => ReactNode)(
    props,
  ) as TestElement;
}

describe("default design system adapter", () => {
  it("maps visual size and shape props to default styles", () => {
    const iconButton = renderComponent(
      defaultDesignSystemComponents.IconButton,
      {
        label: "More",
        icon: <span />,
        size: "large",
      },
    );
    const spinner = renderComponent(defaultDesignSystemComponents.Spinner, {
      size: "compact",
    });
    const skeleton = renderComponent(defaultDesignSystemComponents.Skeleton, {
      shape: "circle",
    });
    const avatar = renderComponent(defaultDesignSystemComponents.Avatar, {
      name: "Ada Lovelace",
      size: "compact",
      status: "online",
    });

    expect(iconButton.props.className).toContain("h-12");
    expect(spinner.props.className).toContain("size-3");
    expect(skeleton.props.className).toContain("rounded-full");
    expect(
      findElement(avatar, (element) => element.props.role === "img")?.props
        .className,
    ).toContain("bg-green-500");
  });

  it("prevents outside dismissal when a dialog is not dismissible", () => {
    const dialog = renderComponent(defaultDesignSystemComponents.Dialog, {
      open: true,
      onOpenChange: vi.fn(),
      title: "Confirm",
      children: <p>Confirm this action</p>,
      dismissible: false,
    });
    const content = findElement(
      dialog,
      (element) => typeof element.props.onInteractOutside === "function",
    );
    const preventDefault = vi.fn();

    (
      content?.props.onInteractOutside as
        | ((event: { preventDefault: () => void }) => void)
        | undefined
    )?.({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("honors menu selection state and closeOnAction", () => {
    const onAction = vi.fn();
    const menu = renderComponent(defaultDesignSystemComponents.Menu, {
      trigger: <button type="button">Open</button>,
      items: [{ id: "selected", label: "Selected", selected: true }],
      onAction,
      closeOnAction: false,
    });
    const content = (menu.props.children as TestElement[])[1];
    const items = content.props.children as TestElement;
    const renderedItems = (
      items.type as (props: Record<string, unknown>) => ReactNode
    )(items.props);
    const item = findElement(
      renderedItems,
      (element) => element.props.checked === true,
    );
    const preventDefault = vi.fn();

    (
      item?.props.onSelect as
        | ((event: { preventDefault: () => void }) => void)
        | undefined
    )?.({ preventDefault });

    expect(item?.props.checked).toBe(true);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onAction).toHaveBeenCalledWith("selected");
  });

  it("maps checkbox invalid state to aria-invalid", () => {
    const checkbox = renderComponent(defaultDesignSystemComponents.Checkbox, {
      checked: false,
      onChange: vi.fn(),
      invalid: true,
    });
    const input = findElement(
      checkbox,
      (element) => element.props["aria-invalid"] === true,
    );

    expect(input?.props["aria-invalid"]).toBe(true);
    expect(input?.props.invalid).toBeUndefined();
  });
});
