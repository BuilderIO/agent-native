import Editor, { OnMount } from "@monaco-editor/react";
import { useTheme } from "next-themes";
import { useRef, useEffect } from "react";

interface MonacoMarkdownEditorProps {
  content: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}

export function MonacoMarkdownEditor({
  content,
  onChange,
  readOnly = false,
}: MonacoMarkdownEditorProps) {
  const { theme } = useTheme();
  const editorRef = useRef<any>(null);
  const isSettingContent = useRef(false);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // Define a custom dark theme matching our app
    monaco.editor.defineTheme("markpad-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "keyword.md", foreground: "569cd6" },
        { token: "string.link.md", foreground: "6a9955" },
        { token: "markup.heading", foreground: "e0e0e0", fontStyle: "bold" },
        { token: "comment", foreground: "666666" },
      ],
      colors: {
        "editor.background": "#141414",
        "editor.foreground": "#e0e0e0",
        "editor.lineHighlightBackground": "#1a1a1a",
        "editor.selectionBackground": "#264f78",
        "editorCursor.foreground": "#e0e0e0",
        "editorLineNumber.foreground": "#444444",
        "editorLineNumber.activeForeground": "#888888",
        "editorIndentGuide.background": "#222222",
        "editorGutter.background": "#141414",
        "editor.selectionHighlightBackground": "#264f7844",
        "scrollbarSlider.background": "#ffffff10",
        "scrollbarSlider.hoverBackground": "#ffffff20",
        "scrollbarSlider.activeBackground": "#ffffff30",
      },
    });

    monaco.editor.defineTheme("markpad-light", {
      base: "vs",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#ffffff",
        "editor.foreground": "#262626",
        "editor.lineHighlightBackground": "#f8f8f8",
        "editor.selectionBackground": "#b4d7ff",
        "editorLineNumber.foreground": "#c0c0c0",
        "editorLineNumber.activeForeground": "#888888",
        "editorGutter.background": "#ffffff",
        "scrollbarSlider.background": "#00000010",
        "scrollbarSlider.hoverBackground": "#00000020",
      },
    });

    editor.updateOptions({
      theme: theme === "dark" ? "markpad-dark" : "markpad-light",
    });
  };

  // Sync theme changes
  useEffect(() => {
    if (editorRef.current) {
      const monaco = (window as any).monaco;
      if (monaco) {
        monaco.editor.setTheme(
          theme === "dark" ? "markpad-dark" : "markpad-light",
        );
      }
    }
  }, [theme]);

  // Sync content from outside
  useEffect(() => {
    if (editorRef.current && !isSettingContent.current) {
      const currentValue = editorRef.current.getValue();
      if (currentValue !== content) {
        // Don't interrupt if user is actively typing
        if (editorRef.current.hasTextFocus()) return;

        isSettingContent.current = true;
        editorRef.current.setValue(content);
        isSettingContent.current = false;
      }
    }
  }, [content]);

  return (
    <Editor
      height="100%"
      defaultLanguage="markdown"
      value={content}
      onChange={(value) => {
        if (!isSettingContent.current) {
          onChange(value || "");
        }
      }}
      onMount={handleMount}
      theme={theme === "dark" ? "markpad-dark" : "markpad-light"}
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        fontFamily: "'JetBrains Mono', monospace",
        lineHeight: 24,
        wordWrap: "on",
        padding: { top: 24, bottom: 24 },
        scrollBeyondLastLine: false,
        renderLineHighlight: "line",
        lineNumbers: "off",
        glyphMargin: false,
        folding: false,
        lineDecorationsWidth: 24,
        lineNumbersMinChars: 0,
        overviewRulerBorder: false,
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        scrollbar: {
          verticalScrollbarSize: 6,
          horizontalScrollbarSize: 6,
          useShadows: false,
        },
        bracketPairColorization: { enabled: false },
        renderWhitespace: "none",
        tabSize: 2,
        smoothScrolling: true,
        cursorBlinking: "smooth",
        cursorSmoothCaretAnimation: "on",
        contextmenu: false,
        readOnly,
      }}
      loading={
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          Loading editor...
        </div>
      }
    />
  );
}
