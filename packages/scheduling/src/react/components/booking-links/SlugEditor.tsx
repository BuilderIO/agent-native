import { Label } from "@agent-native/toolkit/ui";
import { useState } from "react";

import { useSchedulingT } from "../../i18n.js";

export interface SlugEditorProps {
  host: string;
  pathPrefix?: string;
  username: string;
  slug: string;
  onUsernameChange?: (next: string) => void;
  onSlugChange: (next: string) => void;
  hideLabel?: boolean;
  label?: string;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cls(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function SlugEditor(props: SlugEditorProps) {
  const t = useSchedulingT();
  const {
    host,
    pathPrefix = "",
    username,
    slug,
    onUsernameChange,
    onSlugChange,
    hideLabel,
    label = t("url"),
  } = props;

  const [editing, setEditing] = useState<"username" | "slug" | null>(null);
  const [draft, setDraft] = useState("");

  const startEdit = (field: "username" | "slug") => {
    if (field === "username" && !onUsernameChange) return;
    setEditing(field);
    setDraft(field === "username" ? username : slug);
  };

  const commit = () => {
    if (!editing) return;
    const val = draft.trim();
    if (val) {
      if (editing === "username" && onUsernameChange) {
        onUsernameChange(slugify(val));
      } else if (editing === "slug") {
        onSlugChange(slugify(val));
      }
    }
    setEditing(null);
  };

  const prefix = pathPrefix ? `${pathPrefix}/` : "/";

  return (
    <div className="space-y-2">
      {!hideLabel && <Label>{label}</Label>}
      <div className="flex flex-wrap items-center gap-0 rounded-lg border border-border bg-muted/20 px-3 py-2 font-mono text-sm break-all">
        <span className="text-muted-foreground">
          {host}
          {prefix}
        </span>

        {editing === "username" ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) =>
              setDraft(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
            }
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(null);
            }}
            className="inline-block bg-primary/10 text-primary border-b border-primary/40 outline-none px-0.5 py-0 font-mono text-sm w-auto min-w-[3ch]"
            style={{ width: `${Math.max(3, draft.length)}ch` }}
          />
        ) : onUsernameChange ? (
          <button
            type="button"
            onClick={() => startEdit("username")}
            className={cls(
              "inline rounded px-0.5 -mx-0.5 font-mono",
              username
                ? "text-foreground hover:bg-primary/10 hover:text-primary"
                : "text-primary/60 bg-primary/5 border border-dashed border-primary/30 hover:bg-primary/10",
            )}
            title={t("clickToEditUsername")}
          >
            {username || t("yourName")}
          </button>
        ) : (
          <span className="font-mono text-foreground">{username}</span>
        )}

        <span className="text-muted-foreground">/</span>

        {editing === "slug" ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) =>
              setDraft(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
            }
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(null);
            }}
            className="inline-block bg-primary/10 text-primary border-b border-primary/40 outline-none px-0.5 py-0 font-mono text-sm w-auto min-w-[3ch]"
            style={{ width: `${Math.max(3, draft.length)}ch` }}
          />
        ) : (
          <button
            type="button"
            onClick={() => startEdit("slug")}
            className="inline rounded px-0.5 -mx-0.5 font-mono text-foreground hover:bg-primary/10 hover:text-primary"
            title={t("clickToEditSlug")}
          >
            {slug || t("meeting")}
          </button>
        )}
      </div>
    </div>
  );
}
