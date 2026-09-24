// @vitest-environment happy-dom

import {
  Children,
  act,
  isValidElement,
  useEffect,
  type ReactElement,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
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
  it("only force-mounts tab panels when requested and hides inactive content", () => {
    const tabs = renderComponent(defaultDesignSystemComponents.Tabs, {
      value: "other",
      onChange: vi.fn(),
      items: [
        {
          value: "chat",
          label: "Chat",
          content: <textarea />,
          keepMounted: true,
        },
        { value: "other", label: "Other", content: <p>Other</p> },
      ],
    });
    const persistent = findElement(
      tabs,
      (element) => element.props.forceMount === true,
    );
    expect(persistent?.props.value).toBe("chat");
    expect(persistent?.props.className).toBe("hidden");
    expect(persistent?.props.hidden).toBe(true);
    const content = (tabs.props.children as ReactNode[])[1];
    const ordinaryPanel = findElement(
      content,
      (element) => element.props.value === "other",
    );
    expect(ordinaryPanel?.props.forceMount).toBeUndefined();
    expect(ordinaryPanel?.props.className).toBeUndefined();
  });
  it("switches between tabs and visible named regions without remounting content", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const node = document.createElement("div");
    document.body.append(node);
    const root = createRoot(node);
    let mounts = 0;
    function Chat() {
      useEffect(() => {
        mounts++;
      }, []);
      return <textarea defaultValue="Unsent draft" />;
    }
    const Tabs = defaultDesignSystemComponents.Tabs;
    const items = [
      { value: "chat", label: "Chat", keepMounted: true, content: <Chat /> },
      {
        value: "canvas",
        label: "Canvas",
        keepMounted: true,
        content: <button>Avatar</button>,
      },
    ];
    const render = async (display: "tabs" | "panels", value: string) =>
      act(async () => {
        root.render(
          <Tabs
            items={items}
            value={value}
            onChange={() => {}}
            display={display}
          />,
        );
      });
    try {
      await render("tabs", "chat");
      const composer = node.querySelector("textarea");
      const canvas = node.querySelectorAll<HTMLElement>('[role="tabpanel"]')[1];
      expect(canvas.hidden).toBe(true);
      expect(canvas.className).toContain("hidden");
      await render("panels", "chat");
      const regions = [
        ...node.querySelectorAll<HTMLElement>('[role="region"]'),
      ];
      expect(regions).toHaveLength(2);
      for (const [index, region] of regions.entries()) {
        expect(region.hidden).toBe(false);
        expect(region.hasAttribute("aria-hidden")).toBe(false);
        expect(region.hasAttribute("inert")).toBe(false);
        expect(region.className).not.toContain("hidden");
        expect(
          document.getElementById(region.getAttribute("aria-labelledby")!)
            ?.textContent,
        ).toBe(items[index].label);
      }
      expect(node.querySelector("textarea")).toBe(composer);
      await render("tabs", "canvas");
      expect(node.querySelector<HTMLElement>('[role="tabpanel"]')?.hidden).toBe(
        true,
      );
      expect(node.querySelector("textarea")).toBe(composer);
      expect(mounts).toBe(1);
    } finally {
      await act(async () => root.unmount());
      node.remove();
      vi.unstubAllGlobals();
    }
  });
  it("preserves native click handlers for composed ActionButtons", () => {
    const onPress = vi.fn();
    const onClick = vi.fn();
    const button = renderComponent(defaultDesignSystemComponents.ActionButton, {
      children: "Share",
      onPress,
      onClick,
    });

    (button.props.onClick as ((event: unknown) => void) | undefined)?.({});

    expect(onPress).toHaveBeenCalledOnce();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("preserves inset focus semantics for ActionButtons", () => {
    const button = renderComponent(defaultDesignSystemComponents.ActionButton, {
      children: "Sort",
      emphasis: "ghost",
      inset: true,
    });

    expect(button.props.variant).toBe("ghost-inset");
  });

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
