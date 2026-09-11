import { SharedRichEditor } from "@agent-native/toolkit/editor/SharedRichEditor";
import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";

import {
  CLAUDE_SONNET_MODEL_ID,
  CLAUDE_SONNET_MODEL_LABEL,
} from "../../agent/model-config.js";
import {
  type ParsedFrontmatter,
  getRemoteAgentIdFromPath,
  getFrontmatterValue,
  isCustomAgentPath,
  isRemoteAgentPath,
  isSkillPath,
  parseFrontmatter,
  serializeFrontmatter,
} from "../../resources/metadata.js";
import { agentNativePath } from "../api-path.js";
import { cn } from "../utils.js";
import type { Resource } from "./use-resources.js";

export interface ResourceEditorProps {
  resource: Resource;
  onSave: (content: string) => void;
  /** Controlled view mode — if provided, the editor won't manage its own view state */
  view?: "visual" | "code";
  onViewChange?: (v: "visual" | "code") => void;
  /** When true, the editor's internal toolbar row is hidden */
  hideToolbar?: boolean;
  /** When true, content can be viewed and selected but not modified */
  readOnly?: boolean;
}

const CONTROL_STYLE = { fontSize: 12, lineHeight: 1 } as const;

const VIEW_PREF_KEY = "resource-editor-view";

function getViewPref(): "visual" | "code" {
  try {
    const v = localStorage.getItem(VIEW_PREF_KEY);
    if (v === "code") return "code";
  } catch {}
  return "visual";
}

function setViewPref(v: "visual" | "code") {
  try {
    localStorage.setItem(VIEW_PREF_KEY, v);
  } catch {}
}

const FM_INPUT_STYLE: React.CSSProperties = {
  background: "transparent",
  border: "none",
  outline: "none",
  color: "inherit",
  fontSize: "inherit",
  fontFamily: "inherit",
  width: "100%",
  padding: 0,
};

function FrontmatterBar({
  resourcePath,
  frontmatter,
  onChange,
  readOnly,
}: {
  resourcePath: string;
  frontmatter: ParsedFrontmatter;
  onChange: (updated: ParsedFrontmatter) => void;
  readOnly?: boolean;
}) {
  const getField = (key: string) => getFrontmatterValue(frontmatter, key) ?? "";

  const updateField = (key: string, value: string) => {
    if (readOnly) return;
    const exists = frontmatter.fields.some((f) => f.key === key);
    const newFields = exists
      ? frontmatter.fields.map((f) => (f.key === key ? { ...f, value } : f))
      : [...frontmatter.fields, { key, value }];
    const updated: ParsedFrontmatter = {
      ...frontmatter,
      raw: serializeFrontmatter(newFields),
      fields: newFields,
    };
    onChange(updated);
  };

  const name = getField("name");
  const description = getField("description");
  const isUserInvocable = getField("user-invocable") === "true";
  const model = getField("model") || "inherit";
  const tools = getField("tools") || "inherit";
  const isCustomAgent = isCustomAgentPath(resourcePath);
  const isSkill = isSkillPath(resourcePath);

  return (
    <div
      style={{
        padding: "8px 12px",
        marginBottom: 8,
        borderRadius: 6,
        background: "hsl(var(--muted) / 0.5)",
        border: "1px solid hsl(var(--border) / 0.5)",
        fontSize: 12,
        lineHeight: 1.5,
        color: "hsl(var(--muted-foreground))",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          value={name}
          onChange={(e) => updateField("name", e.target.value)}
          readOnly={readOnly}
          placeholder={isCustomAgent ? "Agent name" : "Skill name"}
          style={{
            ...FM_INPUT_STYLE,
            fontWeight: 600,
            color: "hsl(var(--foreground))",
            fontSize: 13,
            flex: 1,
          }}
        />
        {isSkill ? (
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 10,
              cursor: "pointer",
              whiteSpace: "nowrap",
              userSelect: "none",
              padding: "1px 5px",
              borderRadius: 3,
              background: isUserInvocable
                ? "hsl(var(--primary) / 0.15)"
                : "transparent",
              color: isUserInvocable
                ? "hsl(var(--primary))"
                : "hsl(var(--muted-foreground))",
              border: isUserInvocable
                ? "none"
                : "1px dashed hsl(var(--border))",
              fontWeight: 500,
            }}
          >
            <input
              type="checkbox"
              checked={isUserInvocable}
              disabled={readOnly}
              onChange={(e) =>
                updateField(
                  "user-invocable",
                  e.target.checked ? "true" : "false",
                )
              }
              style={{ display: "none" }}
            />
            /{name || "command"}
          </label>
        ) : null}
        {isCustomAgent ? (
          <select
            value={model}
            disabled={readOnly}
            onChange={(e) => updateField("model", e.target.value)}
            style={{
              borderRadius: 4,
              border: "1px solid hsl(var(--border))",
              background: "hsl(var(--background))",
              color: "hsl(var(--foreground))",
              fontSize: 11,
              padding: "2px 6px",
            }}
          >
            <option value="inherit">Default model</option>
            <option value="claude-fable-5">Claude Fable 5</option>
            <option value="claude-opus-4-8">Claude Opus 4.8</option>
            <option value={CLAUDE_SONNET_MODEL_ID}>
              {CLAUDE_SONNET_MODEL_LABEL}
            </option>
            <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
          </select>
        ) : null}
      </div>
      <input
        value={description}
        readOnly={readOnly}
        onChange={(e) => updateField("description", e.target.value)}
        placeholder={
          isCustomAgent
            ? "Description — what this agent should handle"
            : "Description — what this skill does"
        }
        style={{
          ...FM_INPUT_STYLE,
          marginTop: 2,
          opacity: 0.8,
          color: "hsl(var(--muted-foreground))",
        }}
      />
      {isCustomAgent ? (
        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 6,
            alignItems: "center",
          }}
        >
          <label
            style={{
              fontSize: 10,
              color: "hsl(var(--muted-foreground))",
              minWidth: 28,
            }}
          >
            Tools
          </label>
          <select
            value={tools}
            disabled={readOnly}
            onChange={(e) => updateField("tools", e.target.value)}
            style={{
              borderRadius: 4,
              border: "1px solid hsl(var(--border))",
              background: "hsl(var(--background))",
              color: "hsl(var(--foreground))",
              fontSize: 11,
              padding: "2px 6px",
            }}
          >
            <option value="inherit">Inherit</option>
            <option value="allowlist">Allowlist later</option>
            <option value="denylist">Denylist later</option>
          </select>
        </div>
      ) : null}
    </div>
  );
}

// --- Syntax-highlighted code editor (textarea + overlay) ---

function highlightJson(text: string): string {
  // Escape HTML first
  const esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Tokenize JSON with regex
  return esc.replace(
    /("(?:\\.|[^"\\])*")\s*:|("(?:\\.|[^"\\])*")|((?:-?\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b|\bnull\b)/g,
    (match, key, str, num, lit) => {
      if (key) return `<span class="sh-key">${key}</span>:`;
      if (str) return `<span class="sh-str">${str}</span>`;
      if (num) return `<span class="sh-num">${num}</span>`;
      if (lit) return `<span class="sh-lit">${lit}</span>`;
      return match;
    },
  );
}

const shStyles = `
.sh-key { color: #7dd3fc; }
.sh-str { color: #86efac; }
.sh-num { color: #fca5a5; }
.sh-lit { color: #c4b5fd; }
`;

function SyntaxHighlightEditor({
  value,
  onChange,
  language: _language,
  readOnly,
}: {
  value: string;
  onChange: (v: string) => void;
  language: "json";
  readOnly?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const highlighted = useMemo(() => highlightJson(value), [value]);

  const syncScroll = useCallback(() => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  const monoFont =
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';
  const sharedStyle: React.CSSProperties = {
    fontFamily: monoFont,
    fontSize: 13,
    lineHeight: 1.6,
    padding: 12,
    margin: 0,
    border: "none",
    whiteSpace: "pre",
    wordWrap: "normal",
    overflowWrap: "normal",
    tabSize: 2,
  };

  return (
    <>
      <style>{shStyles}</style>
      <div
        className="flex-1 min-h-0"
        style={{ position: "relative", overflow: "hidden" }}
      >
        <pre
          ref={preRef}
          aria-hidden
          style={{
            ...sharedStyle,
            position: "absolute",
            inset: 0,
            overflow: "auto",
            pointerEvents: "none",
            color: "hsl(var(--muted-foreground))",
            background: "transparent",
          }}
          dangerouslySetInnerHTML={{ __html: highlighted + "\n" }}
        />
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            if (!readOnly) onChange(e.target.value);
          }}
          onScroll={syncScroll}
          readOnly={readOnly}
          spellCheck={false}
          style={{
            ...sharedStyle,
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            overflow: "auto",
            resize: "none",
            background: "transparent",
            color: "transparent",
            caretColor: "hsl(var(--foreground))",
            outline: "none",
            WebkitTextFillColor: "transparent",
          }}
        />
      </div>
    </>
  );
}

const RESOURCE_MARKDOWN_FEATURES = {
  tables: false,
  tasks: false,
  image: false,
};

function VisualMarkdownEditor({
  content,
  onChange,
  resourcePath,
  readOnly,
}: {
  content: string;
  onChange: (md: string) => void;
  resourcePath: string;
  readOnly?: boolean;
}) {
  const parsed = useMemo(() => parseFrontmatter(content), [content]);
  const frontmatterRef = useRef(parsed);
  frontmatterRef.current = parsed;
  const body = parsed?.body ?? content;

  const commitBody = useCallback(
    (nextBody: string) => {
      const frontmatter = frontmatterRef.current;
      onChange(frontmatter ? frontmatter.raw + nextBody : nextBody);
    },
    [onChange],
  );

  return (
    <div className="re-editor-wrapper min-h-full">
      {parsed ? (
        <FrontmatterBar
          resourcePath={resourcePath}
          frontmatter={parsed}
          readOnly={readOnly}
          onChange={(updated) => {
            if (readOnly) return;
            frontmatterRef.current = updated;
            onChange(updated.raw + body);
          }}
        />
      ) : null}
      <SharedRichEditor
        value={body}
        onChange={commitBody}
        editable={!readOnly}
        interactive={!readOnly}
        dialect="gfm"
        features={RESOURCE_MARKDOWN_FEATURES}
        placeholder="Type '/' for commands..."
        editorClassName="re-prose"
        ariaLabel="Resource markdown"
      />
    </div>
  );
}

// --- Main ResourceEditor ---

interface RemoteAgentFormValue {
  id?: string;
  name: string;
  description: string;
  url: string;
  color: string;
}

function parseRemoteAgentContent(
  content: string,
  path: string,
): RemoteAgentFormValue {
  const fallbackId = getRemoteAgentIdFromPath(path);
  try {
    const data = JSON.parse(content || "{}");
    return {
      id: data.id || fallbackId,
      name: data.name ?? "",
      description: data.description ?? "",
      url: data.url ?? "",
      color: data.color ?? "#6B7280",
    };
  } catch {
    return {
      id: fallbackId,
      name: "",
      description: "",
      url: "",
      color: "#6B7280",
    };
  }
}

function serializeRemoteAgent(value: RemoteAgentFormValue): string {
  return (
    JSON.stringify(
      {
        id: value.id,
        name: value.name,
        description: value.description || undefined,
        url: value.url,
        color: value.color,
      },
      null,
      2,
    ) + "\n"
  );
}

function RemoteAgentFormEditor({
  resource,
  onChange,
  readOnly,
}: {
  resource: Resource;
  onChange: (content: string) => void;
  readOnly?: boolean;
}) {
  const [value, setValue] = useState<RemoteAgentFormValue>(() =>
    parseRemoteAgentContent(resource.content, resource.path),
  );
  const prevIdRef = useRef(resource.id);

  useEffect(() => {
    if (prevIdRef.current !== resource.id) {
      setValue(parseRemoteAgentContent(resource.content, resource.path));
      prevIdRef.current = resource.id;
    }
  }, [resource.id, resource.content, resource.path]);

  const update = (patch: Partial<RemoteAgentFormValue>) => {
    if (readOnly) return;
    const next = { ...value, ...patch };
    setValue(next);
    onChange(serializeRemoteAgent(next));
  };

  const inputClass =
    "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent";
  const labelClass = "block text-[11px] font-medium text-muted-foreground mb-1";

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-y-auto p-4">
      <div className="max-w-md space-y-3">
        <p className="text-[11px] text-muted-foreground/70 leading-snug">
          Connected remote agent over the A2A protocol. @-mention it in chat to
          delegate tasks.
        </p>
        <div>
          <label className={labelClass}>Name</label>
          <input
            className={inputClass}
            value={value.name}
            readOnly={readOnly}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="Analytics"
          />
        </div>
        <div>
          <label className={labelClass}>URL</label>
          <input
            className={inputClass}
            value={value.url}
            readOnly={readOnly}
            onChange={(e) => update({ url: e.target.value })}
            placeholder="https://analytics.example.com"
          />
          <p className="mt-1 text-[10px] text-muted-foreground/50">
            A2A endpoint. The agent card is served at{" "}
            <code>/.well-known/agent-card.json</code>.
          </p>
        </div>
        <div>
          <label className={labelClass}>Description</label>
          <textarea
            className={cn(inputClass, "resize-y")}
            rows={3}
            value={value.description}
            readOnly={readOnly}
            onChange={(e) => update({ description: e.target.value })}
            placeholder="What this agent is good at — helps the main agent decide when to delegate."
          />
        </div>
        <div>
          <label className={labelClass}>Color</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={value.color}
              disabled={readOnly}
              onChange={(e) => update({ color: e.target.value })}
              className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent"
            />
            <input
              className={cn(inputClass, "flex-1")}
              value={value.color}
              readOnly={readOnly}
              onChange={(e) => update({ color: e.target.value })}
              placeholder="#6B7280"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ResourceEditor({
  resource,
  onSave,
  view: controlledView,
  onViewChange,
  hideToolbar,
  readOnly,
}: ResourceEditorProps) {
  const [content, setContent] = useState(resource.content);
  const [internalView, setInternalView] = useState<"visual" | "code">(
    getViewPref,
  );
  const view = controlledView ?? internalView;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevIdRef = useRef(resource.id);

  // Reset content when resource changes
  useEffect(() => {
    if (prevIdRef.current !== resource.id) {
      setContent(resource.content);
      prevIdRef.current = resource.id;
    }
  }, [resource.id, resource.content]);

  const handleChange = useCallback(
    (newContent: string) => {
      if (readOnly) return;
      setContent(newContent);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onSave(newContent);
      }, 1000);
    },
    [onSave, readOnly],
  );

  const switchView = useCallback(
    (v: "visual" | "code") => {
      setInternalView(v);
      setViewPref(v);
      onViewChange?.(v);
    },
    [onViewChange],
  );

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const isMarkdown =
    resource.mimeType === "text/markdown" || resource.path.endsWith(".md");
  const isImage = resource.mimeType.startsWith("image/");
  const isRemoteAgent = isRemoteAgentPath(resource.path);

  // Remote-agent manifest → form editor
  if (isRemoteAgent) {
    return (
      <div className="flex h-full flex-col">
        <RemoteAgentFormEditor
          resource={resource}
          onChange={handleChange}
          readOnly={readOnly}
        />
      </div>
    );
  }

  // Image preview
  if (isImage) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-1 items-center justify-center overflow-auto p-4">
          <img
            src={agentNativePath(`/_agent-native/resources/${resource.id}?raw`)}
            alt={resource.path}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      </div>
    );
  }

  // Markdown files get visual/code toggle
  if (isMarkdown) {
    return (
      <div className="flex h-full flex-col">
        <style>{editorStyles}</style>
        {!hideToolbar && (
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="flex items-center gap-1">
              <button
                onClick={() => switchView("visual")}
                className={cn(
                  "rounded-md px-2 py-1.5 text-[12px] leading-none",
                  view === "visual"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
                style={CONTROL_STYLE}
              >
                Visual
              </button>
              <button
                onClick={() => switchView("code")}
                className={cn(
                  "rounded-md px-2 py-1.5 text-[12px] leading-none",
                  view === "code"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
                style={CONTROL_STYLE}
              >
                Code
              </button>
            </div>
          </div>
        )}
        {view === "visual" ? (
          <div
            className="flex-1 min-h-0 overflow-y-auto p-3"
            key={resource.id + "-visual"}
          >
            <VisualMarkdownEditor
              content={content}
              onChange={handleChange}
              resourcePath={resource.path}
              readOnly={readOnly}
            />
          </div>
        ) : (
          <textarea
            value={content}
            onChange={(e) => handleChange(e.target.value)}
            readOnly={readOnly}
            className="flex-1 min-h-0 resize-none bg-transparent p-3 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50"
            style={{
              fontFamily:
                'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              lineHeight: 1.6,
            }}
            spellCheck={false}
          />
        )}
      </div>
    );
  }

  // Non-markdown text files
  const isJson =
    resource.mimeType === "application/json" || resource.path.endsWith(".json");

  return (
    <div className="flex h-full flex-col">
      {isJson ? (
        <SyntaxHighlightEditor
          value={content}
          onChange={handleChange}
          language="json"
          readOnly={readOnly}
        />
      ) : (
        <textarea
          value={content}
          onChange={(e) => handleChange(e.target.value)}
          readOnly={readOnly}
          className="flex-1 min-h-0 resize-none bg-transparent p-3 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50"
          style={{
            fontFamily:
              'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
            lineHeight: 1.6,
          }}
          spellCheck={false}
        />
      )}
    </div>
  );
}

// --- Scoped editor styles (injected inline so no external CSS needed) ---

const editorStyles = `
/* Prose styling for the visual editor */
.re-prose {
  outline: none;
  color: hsl(var(--foreground));
  line-height: 1.65;
  font-size: 13px;
  min-height: 100%;
}
.re-prose > *:first-child { margin-top: 0; }

.re-prose h1 {
  font-size: 1.5em;
  font-weight: 700;
  margin: 1em 0 0.25em;
  line-height: 1.25;
}
.re-prose h2 {
  font-size: 1.25em;
  font-weight: 600;
  margin: 0.8em 0 0.2em;
  line-height: 1.3;
}
.re-prose h3 {
  font-size: 1.1em;
  font-weight: 600;
  margin: 0.6em 0 0.15em;
  line-height: 1.35;
}
.re-prose p {
  margin: 0.35em 0;
  min-height: 1.65em;
}
.re-prose ul {
  list-style-type: disc;
  padding-left: 1.4em;
  margin: 0.2em 0;
}
.re-prose ol {
  list-style-type: decimal;
  padding-left: 1.4em;
  margin: 0.2em 0;
}
.re-prose li { margin: 0.05em 0; }
.re-prose li p { margin: 0; }

.re-prose blockquote {
  border-left: 2px solid hsl(var(--border));
  padding-left: 0.8em;
  margin: 0.3em 0;
  color: hsl(var(--muted-foreground));
}
.re-prose code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.88em;
  background: hsl(var(--muted));
  padding: 0.1em 0.3em;
  border-radius: 3px;
}
.re-prose pre {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12px;
  background: hsl(var(--muted));
  border-radius: 4px;
  padding: 0.7em 0.9em;
  margin: 0.3em 0;
  overflow-x: auto;
  line-height: 1.5;
}
.re-prose pre code {
  background: none;
  padding: 0;
  border: none;
  font-size: inherit;
}
.re-prose hr {
  border: none;
  border-top: 1px solid hsl(var(--border));
  margin: 1em 0;
}
.re-prose strong { font-weight: 600; }
.re-prose em { font-style: italic; }
.re-prose s { text-decoration: line-through; }

.re-link {
  color: hsl(var(--foreground));
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-color: hsl(var(--muted-foreground));
  cursor: pointer;
}
.re-link:hover {
  text-decoration-color: hsl(var(--foreground));
}

/* Placeholder */
.re-prose p.is-editor-empty:first-child::before,
.re-prose p.is-empty::before,
.re-prose h1.is-empty::before,
.re-prose h2.is-empty::before,
.re-prose h3.is-empty::before {
  content: attr(data-placeholder);
  float: left;
  color: hsl(var(--muted-foreground));
  opacity: 0.5;
  pointer-events: none;
  height: 0;
}

/* Selection */
.re-prose ::selection {
  background: hsl(210 100% 52% / 0.2);
}

`;
