import { IconComponents } from "@tabler/icons-react";
import type { ElementType } from "react";

export interface LocalComponentSlashItem {
  title: string;
  description: string;
  searchText?: string;
  icon: ElementType;
  action: (editor: LocalComponentSlashEditor) => void;
}

export interface LocalComponentSlashEditor {
  chain: () => {
    focus: () => {
      insertContent: (content: unknown) => { run: () => boolean };
    };
  };
}

function humanizeComponentName(name: string) {
  return (
    name
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || name
  );
}

export function buildLocalComponentSlashItems(
  components: Record<string, unknown>,
): LocalComponentSlashItem[] {
  return Object.entries(components)
    .filter(
      ([name, component]) =>
        /^[A-Z][A-Za-z0-9_]*$/.test(name) && typeof component === "function",
    )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name]) => {
      const title = humanizeComponentName(name);
      const raw = `<${name} />`;
      return {
        title,
        description: "Local MDX component",
        searchText: `${name} ${title} local component mdx`,
        icon: IconComponents,
        action: (editor) => {
          editor
            .chain()
            .focus()
            .insertContent({
              type: "localMdxComponent",
              attrs: {
                name,
                propsJson: "{}",
                unsupportedProps: false,
                children: "",
                __raw: raw,
              },
            })
            .run();
        },
      };
    });
}
