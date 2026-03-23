import { useEffect, useState, useRef } from "react";
import type { Editor } from "@tiptap/react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const LANGUAGES = [
  { value: "", label: "Plain text" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
  { value: "json", label: "JSON" },
  { value: "sql", label: "SQL" },
  { value: "bash", label: "Bash" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
  { value: "java", label: "Java" },
  { value: "ruby", label: "Ruby" },
  { value: "php", label: "PHP" },
  { value: "yaml", label: "YAML" },
  { value: "markdown", label: "Markdown" },
  { value: "xml", label: "XML" },
  { value: "graphql", label: "GraphQL" },
];

interface CodeBlockLangPickerProps {
  editor: Editor;
}

export function CodeBlockLangPicker({ editor }: CodeBlockLangPickerProps) {
  const [position, setPosition] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const [currentLang, setCurrentLang] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => {
      if (!editor.isActive("codeBlock")) {
        setPosition(null);
        return;
      }

      const lang = editor.getAttributes("codeBlock").language || "";
      setCurrentLang(lang);

      // Find the code block DOM node
      const { $from } = editor.state.selection;
      let depth = $from.depth;
      while (depth > 0 && $from.node(depth).type.name !== "codeBlock") {
        depth--;
      }
      if (depth === 0 && $from.node(0).type.name !== "codeBlock") {
        setPosition(null);
        return;
      }

      const start = $from.start(depth);
      try {
        const domNode = editor.view.nodeDOM(start - 1);
        if (!domNode || !(domNode instanceof HTMLElement)) {
          setPosition(null);
          return;
        }
        const wrapper = domNode.closest(".compose-editor-wrapper");
        if (!wrapper) {
          setPosition(null);
          return;
        }
        const blockRect = domNode.getBoundingClientRect();
        const wrapperRect = wrapper.getBoundingClientRect();
        setPosition({
          top: blockRect.top - wrapperRect.top + 4,
          right: wrapperRect.right - blockRect.right + 4,
        });
      } catch {
        setPosition(null);
      }
    };

    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
    };
  }, [editor]);

  if (!position) return null;

  return (
    <div
      ref={wrapperRef}
      className="code-lang-picker"
      style={{
        position: "absolute",
        top: position.top,
        right: position.right,
        zIndex: 10,
      }}
    >
      <Select
        value={currentLang || "__plain"}
        onValueChange={(value) => {
          const lang = value === "__plain" ? "" : value;
          editor
            .chain()
            .focus()
            .updateAttributes("codeBlock", { language: lang || null })
            .run();
          setCurrentLang(lang);
        }}
      >
        <SelectTrigger
          className="code-lang-select h-7 w-auto min-w-[100px] text-xs"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <SelectValue placeholder="Plain text" />
        </SelectTrigger>
        <SelectContent>
          {LANGUAGES.map((l) => (
            <SelectItem key={l.value || "__plain"} value={l.value || "__plain"}>
              {l.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
