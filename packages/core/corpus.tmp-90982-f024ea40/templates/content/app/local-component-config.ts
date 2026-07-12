import type { ElementType } from "react";

export type LocalContentComponentInputType =
  | "string"
  | "textarea"
  | "number"
  | "boolean"
  | "select";

export interface LocalContentComponentInputOption {
  label: string;
  value: string;
}

export interface LocalContentComponentInputConfig {
  type?: LocalContentComponentInputType;
  label?: string;
  description?: string;
  placeholder?: string;
  default?: string | number | boolean;
  options?: Array<string | LocalContentComponentInputOption>;
}

export type LocalContentComponentInputs = Record<
  string,
  LocalContentComponentInputConfig
>;

export interface LocalContentComponentModuleConfig {
  inputs?: LocalContentComponentInputs;
}

export interface LocalContentComponentDefinition {
  component: ElementType;
  inputs?: LocalContentComponentInputs;
}

export function normalizeLocalContentComponentInputs(
  value: unknown,
): LocalContentComponentInputs | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const normalized: LocalContentComponentInputs = {};
  for (const [name, input] of Object.entries(value)) {
    if (!/^[A-Za-z_][\w-]*$/.test(name)) continue;
    if (!input || typeof input !== "object" || Array.isArray(input)) continue;
    const raw = input as Record<string, unknown>;
    const type =
      raw.type === "textarea" ||
      raw.type === "number" ||
      raw.type === "boolean" ||
      raw.type === "select"
        ? raw.type
        : "string";
    normalized[name] = {
      type,
      label: typeof raw.label === "string" ? raw.label : undefined,
      description:
        typeof raw.description === "string" ? raw.description : undefined,
      placeholder:
        typeof raw.placeholder === "string" ? raw.placeholder : undefined,
      default:
        typeof raw.default === "string" ||
        typeof raw.default === "number" ||
        typeof raw.default === "boolean"
          ? raw.default
          : undefined,
      options: Array.isArray(raw.options)
        ? raw.options
            .map((option) => {
              if (typeof option === "string") return option;
              if (
                option &&
                typeof option === "object" &&
                !Array.isArray(option) &&
                typeof (option as { value?: unknown }).value === "string"
              ) {
                return {
                  value: (option as { value: string }).value,
                  label:
                    typeof (option as { label?: unknown }).label === "string"
                      ? ((option as { label: string }).label ?? "")
                      : (option as { value: string }).value,
                };
              }
              return null;
            })
            .filter(
              (option): option is string | LocalContentComponentInputOption =>
                Boolean(option),
            )
        : undefined,
    };
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function coerceBoolean(value: unknown) {
  return value === true || value === "true" || value === "1" || value === 1;
}

export function coerceLocalContentComponentProps(
  rawProps: Record<string, unknown>,
  inputs?: LocalContentComponentInputs,
): Record<string, unknown> {
  if (!inputs) return rawProps;
  const props: Record<string, unknown> = { ...rawProps };
  for (const [name, input] of Object.entries(inputs)) {
    const value = rawProps[name] ?? input.default;
    if (value === undefined) continue;
    if (input.type === "number") {
      if (value === "") {
        delete props[name];
        continue;
      }
      const numberValue =
        typeof value === "number" ? value : Number(String(value));
      props[name] = Number.isFinite(numberValue) ? numberValue : value;
    } else if (input.type === "boolean") {
      props[name] = coerceBoolean(value);
    } else {
      props[name] = String(value);
    }
  }
  return props;
}

function escapeAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function serializeLocalMdxComponentSource({
  name,
  props,
  children,
}: {
  name: string;
  props: Record<string, unknown>;
  children?: string;
}) {
  const attrs = Object.entries(props)
    .filter(([key, value]) => {
      return (
        /^[A-Za-z_][\w-]*$/.test(key) &&
        value !== undefined &&
        value !== null &&
        value !== ""
      );
    })
    .map(([key, value]) => `${key}="${escapeAttribute(String(value))}"`)
    .join(" ");
  const open = attrs ? `<${name} ${attrs}` : `<${name}`;
  const childSource = children?.trim();
  return childSource ? `${open}>\n${childSource}\n</${name}>` : `${open} />`;
}
