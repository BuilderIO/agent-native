import {
  Node as TiptapNode,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  mergeAttributes,
  type NodeViewProps,
} from "@tiptap/react";
import { createElement } from "react";
import { localContentComponents } from "@/local-components";

function parseProps(propsJson: unknown): Record<string, unknown> {
  if (typeof propsJson !== "string" || !propsJson.trim()) return {};
  try {
    const parsed = JSON.parse(propsJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function LocalMdxComponentView({ node, selected }: NodeViewProps) {
  const name = typeof node.attrs.name === "string" ? node.attrs.name : "";
  const Component = name ? localContentComponents[name] : null;
  const props = parseProps(node.attrs.propsJson);
  const unsupportedProps =
    node.attrs.unsupportedProps === true ||
    node.attrs.unsupportedProps === "true";
  const children =
    typeof node.attrs.children === "string" && node.attrs.children.trim()
      ? node.attrs.children
      : undefined;

  if (unsupportedProps) {
    return (
      <NodeViewWrapper
        className={`my-4 rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 px-4 py-3 text-sm text-muted-foreground ${
          selected ? "ring-2 ring-ring" : ""
        }`}
        contentEditable={false}
        data-local-mdx-component={name}
      >
        <code>{name ? `<${name} />` : "Local MDX component"}</code> uses JSX
        props that cannot be previewed yet.
      </NodeViewWrapper>
    );
  }

  if (!Component) {
    return (
      <NodeViewWrapper
        className={`my-4 rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 px-4 py-3 text-sm text-muted-foreground ${
          selected ? "ring-2 ring-ring" : ""
        }`}
        contentEditable={false}
        data-local-mdx-component={name}
      >
        <code>{name ? `<${name} />` : "Local MDX component"}</code> not found in
        local components.
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      className={`my-4 ${selected ? "ring-2 ring-ring ring-offset-2" : ""}`}
      contentEditable={false}
      data-local-mdx-component={name}
    >
      {createElement(Component, props, children)}
    </NodeViewWrapper>
  );
}

export const LocalMdxComponentNode = TiptapNode.create({
  name: "localMdxComponent",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      name: { default: "" },
      propsJson: { default: "{}" },
      unsupportedProps: { default: false },
      children: { default: "" },
      __raw: { default: "" },
      indent: { default: 0 },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-local-mdx-component]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-local-mdx-component": HTMLAttributes.name,
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LocalMdxComponentView);
  },
});
