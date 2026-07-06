import { useT } from "@agent-native/core/client";
import { IconPencil } from "@tabler/icons-react";
import {
  Node as TiptapNode,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  mergeAttributes,
  type NodeViewProps,
} from "@tiptap/react";
import { createElement } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  coerceLocalContentComponentProps,
  serializeLocalMdxComponentSource,
  type LocalContentComponentInputConfig,
  type LocalContentComponentInputs,
} from "@/local-component-config";
import {
  localContentComponentInputs,
  localContentComponents,
} from "@/local-components";

export const LOCAL_FILE_USER_EDIT_META = "localFileUserEdit";

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

function inputLabel(name: string, input: LocalContentComponentInputConfig) {
  return (
    input.label ??
    name
      .replace(/[-_]+/g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/\b\w/g, (char) => char.toUpperCase())
  );
}

function optionParts(
  option: NonNullable<LocalContentComponentInputConfig["options"]>[number],
) {
  return typeof option === "string"
    ? { label: option, value: option }
    : { label: option.label, value: option.value };
}

function formValue(
  props: Record<string, unknown>,
  name: string,
  input: LocalContentComponentInputConfig,
) {
  const value = props[name] ?? input.default;
  if (input.type === "boolean") return value === true || value === "true";
  if (value === undefined || value === null) return "";
  return String(value);
}

function LocalComponentInputEditor({
  componentName,
  inputs,
  props,
  children,
  editor,
  getPos,
  updateAttributes,
}: {
  componentName: string;
  inputs: LocalContentComponentInputs;
  props: Record<string, unknown>;
  children?: string;
  editor: NodeViewProps["editor"];
  getPos: NodeViewProps["getPos"];
  updateAttributes: NodeViewProps["updateAttributes"];
}) {
  const t = useT();
  const updateProp = (name: string, value: unknown) => {
    const pos = getPos();
    const liveNode =
      typeof pos === "number" ? editor.state.doc.nodeAt(pos) : null;
    const liveProps = liveNode ? parseProps(liveNode.attrs.propsJson) : props;
    const liveChildren =
      typeof liveNode?.attrs.children === "string"
        ? liveNode.attrs.children
        : children;
    const nextProps = { ...liveProps, [name]: value };
    const raw = serializeLocalMdxComponentSource({
      name: componentName,
      props: nextProps,
      children: liveChildren,
    });

    const nextAttrs = {
      propsJson: JSON.stringify(nextProps),
      unsupportedProps: false,
      __raw: raw,
    };

    if (typeof pos === "number" && liveNode) {
      const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
        ...liveNode.attrs,
        ...nextAttrs,
      });
      tr.setMeta(LOCAL_FILE_USER_EDIT_META, true);
      editor.view.dispatch(tr);
      return;
    }

    updateAttributes(nextAttrs);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="pointer-events-none absolute right-2 top-2 z-10 h-7 w-7 rounded-md bg-background/95 opacity-0 shadow-sm transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus:pointer-events-auto focus:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:opacity-100"
          aria-label={`Edit ${componentName} inputs`}
        >
          <IconPencil className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-80 space-y-4">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{componentName}</div>
          <div className="text-xs text-muted-foreground">
            {t("editor.localComponentInputs")}
          </div>
        </div>
        <div className="space-y-3">
          {Object.entries(inputs).map(([name, input]) => {
            const label = inputLabel(name, input);
            const id = `local-component-${componentName}-${name}`;
            const value = formValue(props, name, input);
            return (
              <div key={name} className="space-y-1.5">
                <Label htmlFor={id} className="text-xs">
                  {label}
                </Label>
                {input.type === "boolean" ? (
                  <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <input
                      id={id}
                      type="checkbox"
                      checked={Boolean(value)}
                      onChange={(event) =>
                        updateProp(name, event.currentTarget.checked)
                      }
                    />
                    <span>
                      {input.description ?? t("editor.localComponentEnabled")}
                    </span>
                  </label>
                ) : input.type === "select" ? (
                  <select
                    id={id}
                    value={String(value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onChange={(event) =>
                      updateProp(name, event.currentTarget.value)
                    }
                  >
                    <option value="">
                      {t("editor.localComponentDefault")}
                    </option>
                    {(input.options ?? []).map((option) => {
                      const normalized = optionParts(option);
                      return (
                        <option key={normalized.value} value={normalized.value}>
                          {normalized.label}
                        </option>
                      );
                    })}
                  </select>
                ) : input.type === "textarea" ? (
                  <textarea
                    id={id}
                    value={String(value)}
                    placeholder={input.placeholder}
                    className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onChange={(event) =>
                      updateProp(name, event.currentTarget.value)
                    }
                  />
                ) : (
                  <Input
                    id={id}
                    type={input.type === "number" ? "number" : "text"}
                    value={String(value)}
                    placeholder={input.placeholder}
                    onChange={(event) =>
                      updateProp(
                        name,
                        input.type === "number"
                          ? event.currentTarget.value === ""
                            ? ""
                            : Number(event.currentTarget.value)
                          : event.currentTarget.value,
                      )
                    }
                  />
                )}
                {input.description && input.type !== "boolean" ? (
                  <p className="text-xs text-muted-foreground">
                    {input.description}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function LocalMdxComponentView({
  editor,
  getPos,
  node,
  updateAttributes,
}: NodeViewProps) {
  const t = useT();
  const name = typeof node.attrs.name === "string" ? node.attrs.name : "";
  const Component = name ? localContentComponents[name] : null;
  const inputs = name ? localContentComponentInputs[name] : undefined;
  const rawProps = parseProps(node.attrs.propsJson);
  const props = coerceLocalContentComponentProps(rawProps, inputs);
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
        className="my-4 rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 px-4 py-3 text-sm text-muted-foreground"
        contentEditable={false}
        data-local-mdx-component={name}
      >
        <code>{name ? `<${name} />` : t("editor.localMdxComponent")}</code>{" "}
        {t("editor.localMdxUnsupportedProps")}
      </NodeViewWrapper>
    );
  }

  if (!Component) {
    return (
      <NodeViewWrapper
        className="my-4 rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 px-4 py-3 text-sm text-muted-foreground"
        contentEditable={false}
        data-local-mdx-component={name}
      >
        <code>{name ? `<${name} />` : t("editor.localMdxComponent")}</code>{" "}
        {t("editor.localMdxNotFound")}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      className="group relative my-4"
      contentEditable={false}
      data-local-mdx-component={name}
    >
      {editor.isEditable && inputs ? (
        <LocalComponentInputEditor
          componentName={name}
          inputs={inputs}
          props={rawProps}
          children={children}
          editor={editor}
          getPos={getPos}
          updateAttributes={updateAttributes}
        />
      ) : null}
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
