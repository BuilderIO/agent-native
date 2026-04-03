import { useState, useRef, useEffect, useCallback } from "react";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import { IconChevronDown, IconCheck } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

const lowlight = createLowlight(common);

const LANGUAGES = [
  { value: null, label: "Plain text" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "bash", label: "Bash" },
  { value: "shell", label: "Shell" },
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "markdown", label: "Markdown" },
  { value: "sql", label: "SQL" },
  { value: "java", label: "Java" },
  { value: "c", label: "C" },
  { value: "cpp", label: "C++" },
  { value: "csharp", label: "C#" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
  { value: "ruby", label: "Ruby" },
  { value: "php", label: "PHP" },
  { value: "swift", label: "Swift" },
  { value: "kotlin", label: "Kotlin" },
  { value: "scala", label: "Scala" },
  { value: "r", label: "R" },
  { value: "perl", label: "Perl" },
  { value: "lua", label: "Lua" },
  { value: "xml", label: "XML" },
  { value: "graphql", label: "GraphQL" },
  { value: "dockerfile", label: "Dockerfile" },
  { value: "ini", label: "INI" },
  { value: "diff", label: "Diff" },
  { value: "plaintext", label: "Plain text" },
] as const;

function CodeBlockView({ node, updateAttributes, extension }: NodeViewProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [filter, setFilter] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const currentLang = node.attrs.language as string | null;
  const displayLabel =
    LANGUAGES.find(
      (l) =>
        l.value === currentLang ||
        (l.value === null && !currentLang) ||
        (l.value === "plaintext" && !currentLang),
    )?.label ||
    currentLang ||
    "Plain text";

  const filteredLanguages = LANGUAGES.filter((l) =>
    l.label.toLowerCase().includes(filter.toLowerCase()),
  );

  const closePicker = useCallback(() => {
    setShowPicker(false);
    setFilter("");
  }, []);

  useEffect(() => {
    if (!showPicker) return;
    filterRef.current?.focus();
    const handleClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        closePicker();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showPicker, closePicker]);

  return (
    <NodeViewWrapper className="notion-code-block-wrapper">
      <div className="notion-code-block-header" contentEditable={false}>
        <div className="relative" ref={pickerRef}>
          <button
            type="button"
            className="notion-code-lang-btn"
            onClick={() => setShowPicker(!showPicker)}
          >
            {displayLabel}
            <IconChevronDown size={12} />
          </button>
          {showPicker && (
            <div className="notion-code-lang-picker">
              <input
                ref={filterRef}
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") closePicker();
                  if (e.key === "Enter" && filteredLanguages.length > 0) {
                    updateAttributes({
                      language: filteredLanguages[0].value || "",
                    });
                    closePicker();
                  }
                }}
                placeholder="Search languages..."
                className="notion-code-lang-search"
              />
              <div className="notion-code-lang-list">
                {filteredLanguages.map((lang) => (
                  <button
                    key={lang.value ?? "plain"}
                    type="button"
                    className={cn(
                      "notion-code-lang-option",
                      (currentLang === lang.value ||
                        (!currentLang && !lang.value)) &&
                        "active",
                    )}
                    onClick={() => {
                      updateAttributes({ language: lang.value || "" });
                      closePicker();
                    }}
                  >
                    {lang.label}
                    {(currentLang === lang.value ||
                      (!currentLang && !lang.value)) && <IconCheck size={14} />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <pre>
        <NodeViewContent as="code" />
      </pre>
    </NodeViewWrapper>
  );
}

export const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Tab: ({ editor }) => {
        if (editor.isActive("codeBlock")) {
          editor.commands.insertContent("\t");
          return true;
        }
        return false;
      },
    };
  },
}).configure({
  lowlight,
  HTMLAttributes: { class: "notion-code-block" },
  defaultLanguage: null,
});
