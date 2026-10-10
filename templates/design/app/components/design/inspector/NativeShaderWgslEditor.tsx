import type { NativeDraftPreviewDiagnostic } from "@shared/native-draft-preview-contract";
import { useEffect, useRef } from "react";

import {
  ensureMonacoEnvironment,
  monaco,
} from "../code-workbench/editor/monaco-setup";

let registered = false;

function ensureWgslLanguage() {
  if (registered) return;
  monaco.languages.register({ id: "wgsl" });
  monaco.languages.setMonarchTokensProvider("wgsl", {
    keywords: [
      "fn",
      "var",
      "let",
      "const",
      "struct",
      "return",
      "if",
      "else",
      "for",
      "while",
      "loop",
      "break",
      "continue",
      "discard",
      "override",
      "alias",
      "enable",
      "true",
      "false",
    ],
    tokenizer: {
      root: [
        [/\/\/.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        [
          /\b[a-zA-Z_][\w]*\b/,
          {
            cases: { "@keywords": "keyword", "@default": "identifier" },
          },
        ],
        [/[0-9]+(?:\.[0-9]+)?/, "number"],
        [/@[a-zA-Z_][\w]*/, "annotation"],
      ],
      comment: [
        [/[^/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[/*]/, "comment"],
      ],
    },
  });
  registered = true;
}

export function NativeShaderWgslEditor({
  value,
  onChange,
  diagnostics,
  readOnly,
}: {
  value: string;
  onChange: (value: string) => void;
  diagnostics: NativeDraftPreviewDiagnostic[];
  readOnly?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<ReturnType<typeof monaco.editor.create> | null>(
    null,
  );
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    ensureMonacoEnvironment();
    ensureWgslLanguage();
    const model = monaco.editor.createModel(value, "wgsl");
    const editor = monaco.editor.create(host, {
      model,
      theme: "vs-dark",
      minimap: { enabled: false },
      lineNumbersMinChars: 3,
      scrollBeyondLastLine: false,
      automaticLayout: true,
      fontSize: 12,
      readOnly,
    });
    editorRef.current = editor;
    const subscription = editor.onDidChangeModelContent(() => {
      onChangeRef.current(editor.getValue());
    });
    return () => {
      subscription.dispose();
      editor.dispose();
      model.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.getValue() === value) return;
    editor.setValue(value);
  }, [value]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model) return;
    monaco.editor.setModelMarkers(
      model,
      "native-shader-lab",
      diagnostics
        .filter((diagnostic) => diagnostic.line !== undefined)
        .map((diagnostic) => ({
          startLineNumber: diagnostic.line!,
          startColumn: diagnostic.column ?? 1,
          endLineNumber: diagnostic.line!,
          endColumn: (diagnostic.column ?? 1) + 1,
          message: diagnostic.message,
          severity:
            diagnostic.severity === "error"
              ? monaco.MarkerSeverity.Error
              : diagnostic.severity === "warning"
                ? monaco.MarkerSeverity.Warning
                : monaco.MarkerSeverity.Info,
        })),
    );
  }, [diagnostics]);

  return <div ref={hostRef} className="h-full min-h-0 w-full" />;
}
