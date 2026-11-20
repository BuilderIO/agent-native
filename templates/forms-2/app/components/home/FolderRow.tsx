import { useT } from "@agent-native/core/client/i18n";
import type { Folder } from "@shared/form-contract";
import { IconFolder } from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";

import { paths } from "@/components/shell/paths";

import { FolderMenu } from "./FolderMenu";

/**
 * The form a drop is carrying. A row is a link, so the browser hands us the form's
 * URL as the drag payload; a list that sets the id itself hands us the id. Both mean
 * the same form.
 */
export function formIdFromDrop(payload: string): string | null {
  const text = payload.trim();
  if (!text) return null;
  const fromUrl = text.match(/\/forms\/([A-Za-z0-9_-]+)/);
  if (fromUrl?.[1]) return fromUrl[1];
  return /^[A-Za-z0-9_-]{4,64}$/.test(text) ? text : null;
}

export function FolderRow({
  workspaceId,
  folder,
  onDropForm,
}: {
  workspaceId: string;
  folder: Folder;
  /** Called with the dragged form's id when a row is dropped here. */
  onDropForm?: ((formId: string) => void) | undefined;
}) {
  const t = useT();
  const [over, setOver] = useState(false);
  return (
    <div
      className={
        over
          ? "group relative rounded-[7px] border border-ring bg-accent/40"
          : "group relative rounded-[7px] border border-border"
      }
      data-folder-drop={folder.id}
      onDragOver={(event) => {
        if (!onDropForm) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        if (!onDropForm) return;
        event.preventDefault();
        setOver(false);
        const formId = formIdFromDrop(event.dataTransfer.getData("text/plain"));
        if (formId) onDropForm(formId);
      }}
    >
      <Link
        to={paths.folder(workspaceId, folder.id)}
        className="flex h-[42px] items-center gap-2 px-4 text-sm leading-5 font-medium hover:bg-accent/50"
      >
        <IconFolder className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{folder.name}</span>
        <span className="shrink-0 text-[13px] font-medium text-muted-foreground group-hover:invisible group-focus-within:invisible group-has-[[data-state=open]]:invisible">
          {t("forms.organize.folderFormsCount", { count: folder.formCount })}
        </span>
      </Link>
      <div className="absolute top-1/2 right-2 -translate-y-1/2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 has-[[data-state=open]]:opacity-100">
        <FolderMenu
          folder={folder}
          label={t("forms.organize.folderActions", { name: folder.name })}
          triggerClassName="text-muted-foreground"
        />
      </div>
    </div>
  );
}
