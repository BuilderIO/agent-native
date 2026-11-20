import type { PropDefs } from "@agent-native/design-system";
import type { ArgTypes } from "@storybook/react-vite";

/**
 * Storybook controls for a component, read from its catalog props: each
 * enum is a radio of its values with its default, each boolean a toggle, and
 * every description is the definition's. Stories never list a component's
 * options themselves, so the controls can't drift from what it accepts.
 */
export function propControls(defs: PropDefs): {
  args: Record<string, string | boolean>;
  argTypes: ArgTypes;
} {
  const args: Record<string, string | boolean> = {};
  const argTypes: ArgTypes = {};
  for (const [name, def] of Object.entries(defs)) {
    if (def.type === "enum") {
      if (def.default !== undefined) args[name] = def.default;
      argTypes[name] = {
        control: def.values.length > 5 ? "select" : "inline-radio",
        options: [...def.values],
        description: def.description,
        table: {
          type: {
            summary: def.values.map((value) => `"${value}"`).join(" | "),
          },
          ...(def.default === undefined
            ? {}
            : { defaultValue: { summary: `"${def.default}"` } }),
        },
      };
    } else if (def.type === "boolean") {
      args[name] = def.default ?? false;
      argTypes[name] = {
        control: "boolean",
        description: def.description,
        table: {
          type: { summary: "boolean" },
          defaultValue: { summary: String(def.default ?? false) },
        },
      };
    } else {
      argTypes[name] = { description: def.description };
    }
  }
  return { args, argTypes };
}
