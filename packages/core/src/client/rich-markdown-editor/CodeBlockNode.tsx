import { useMemo, useState } from "react";
import type { Node as TiptapNode } from "@tiptap/core";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import type { createLowlight } from "lowlight";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import { cn } from "../utils.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";

/**
 * A selectable language for the code-block picker. `value === null` is the
 * "Auto" sentinel: the block stores no language and the lowlight plugin
 * auto-detects (biased toward the editor's registered, web-leaning grammar
 * set). Keeping it first makes Auto the default, matching how plans skew toward
 * JS/TS/JSON without the author having to choose.
 */
export interface CodeLanguageOption {
  value: string | null;
  label: string;
}

/** Default picker list — Auto first, then the web-leaning grammars plans use. */
export const DEFAULT_CODE_LANGUAGES: CodeLanguageOption[] = [
  { value: null, label: "Auto" },
  { value: "typescript", label: "TypeScript" },
  { value: "javascript", label: "JavaScript" },
  { value: "tsx", label: "TSX" },
  { value: "jsx", label: "JSX" },
  { value: "json", label: "JSON" },
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
  { value: "bash", label: "Bash" },
  { value: "python", label: "Python" },
  { value: "sql", label: "SQL" },
  { value: "yaml", label: "YAML" },
  { value: "markdown", label: "Markdown" },
  { value: "graphql", label: "GraphQL" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
  { value: "diff", label: "Diff" },
];

/** Class hooks so each app themes the shared node with its own palette. */
export interface CodeBlockClassNames {
  wrapper: string;
  header: string;
  langButton: string;
  langButtonReadonly: string;
  picker: string;
  search: string;
  list: string;
  option: string;
  optionActive: string;
}

const DEFAULT_CLASS_NAMES: CodeBlockClassNames = {
  wrapper: "an-code-block",
  header: "an-code-block__header",
  langButton: "an-code-block__lang",
  langButtonReadonly: "an-code-block__lang--readonly",
  picker: "an-code-block__picker",
  search: "an-code-block__search",
  list: "an-code-block__list",
  option: "an-code-block__option",
  optionActive: "is-active",
};

export interface CreateCodeBlockNodeOptions {
  /** Lowlight instance backing syntax highlighting (same one the app registers). */
  lowlight: ReturnType<typeof createLowlight>;
  /** Picker languages. Defaults to {@link DEFAULT_CODE_LANGUAGES} (Auto first). */
  languages?: CodeLanguageOption[];
  /** Class hooks for per-app theming. Defaults to the shared `an-code-block__*`. */
  classNames?: Partial<CodeBlockClassNames>;
}

function optionLabel(
  language: string | null,
  languages: CodeLanguageOption[],
): string {
  if (!language) return languages[0]?.label ?? "Auto";
  const match = languages.find((option) => option.value === language);
  return match?.label ?? language;
}

interface CodeBlockNodeViewExtraOptions {
  languagePickerOptions: CodeLanguageOption[];
  codeBlockClassNames: CodeBlockClassNames;
}

function CodeBlockView({
  node,
  updateAttributes,
  editor,
  extension,
}: NodeViewProps) {
  const options = extension.options as unknown as CodeBlockNodeViewExtraOptions;
  const languages = options.languagePickerOptions;
  const classNames = options.codeBlockClassNames;

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const isEditable = editor.isEditable;

  const current = (node.attrs.language as string | null) || null;
  const label = optionLabel(current, languages);

  const filtered = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return languages;
    return languages.filter((option) =>
      option.label.toLowerCase().includes(query),
    );
  }, [filter, languages]);

  const select = (value: string | null) => {
    // Store `""` for Auto so tiptap-markdown emits a bare fence (no language),
    // matching the auto-detect read path.
    updateAttributes({ language: value ?? "" });
    setFilter("");
    setOpen(false);
  };

  return (
    <NodeViewWrapper className={classNames.wrapper}>
      <div className={classNames.header} contentEditable={false}>
        {isEditable ? (
          <Popover
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              if (!next) setFilter("");
            }}
          >
            <PopoverTrigger asChild>
              <button type="button" className={classNames.langButton}>
                {label}
                <IconChevronDown className="size-3" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" side="bottom" className="w-52 p-0">
              <input
                autoFocus
                type="text"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && filtered.length > 0) {
                    event.preventDefault();
                    select(filtered[0].value);
                  }
                }}
                placeholder="Search languages…"
                className={classNames.search}
              />
              <div className={classNames.list}>
                {filtered.map((option) => {
                  const active =
                    option.value === current || (!option.value && !current);
                  return (
                    <button
                      key={option.value ?? "auto"}
                      type="button"
                      className={cn(
                        classNames.option,
                        active && classNames.optionActive,
                      )}
                      onClick={() => select(option.value)}
                    >
                      {option.label}
                      {active && <IconCheck className="size-3.5" />}
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        ) : (
          label && (
            <span
              className={cn(
                classNames.langButton,
                classNames.langButtonReadonly,
              )}
            >
              {label}
            </span>
          )
        )}
      </div>
      <pre>
        <NodeViewContent as={"code" as never} />
      </pre>
    </NodeViewWrapper>
  );
}

/**
 * The shared Notion-style code block: {@link CodeBlockLowlight} (so fenced
 * markdown round-trips byte-identically — the node name and `language` attr are
 * unchanged) plus a React node view that adds a language picker header instead
 * of a bare highlighted `<pre>`. "Auto" stores no language and the lowlight
 * plugin auto-detects.
 *
 * Lifted from the Content editor's bespoke code block so Plans (and any app
 * opting into `features.codeBlock`) share one implementation. Theming is fully
 * class-driven via {@link CreateCodeBlockNodeOptions.classNames}, so each app
 * maps the hooks onto its own palette.
 */
export function createCodeBlockNode({
  lowlight,
  languages = DEFAULT_CODE_LANGUAGES,
  classNames,
}: CreateCodeBlockNodeOptions): TiptapNode {
  const resolvedClassNames: CodeBlockClassNames = {
    ...DEFAULT_CLASS_NAMES,
    ...(classNames ?? {}),
  };

  return CodeBlockLowlight.extend({
    addOptions() {
      return {
        ...this.parent?.(),
        languagePickerOptions: languages,
        codeBlockClassNames: resolvedClassNames,
      };
    },
    addNodeView() {
      return ReactNodeViewRenderer(CodeBlockView);
    },
    addKeyboardShortcuts() {
      return {
        ...this.parent?.(),
        Tab: ({ editor }) => {
          if (editor.isActive(this.name)) {
            editor.commands.insertContent("\t");
            return true;
          }
          return false;
        },
      };
    },
  }).configure({
    lowlight,
    defaultLanguage: null,
  }) as unknown as TiptapNode;
}
