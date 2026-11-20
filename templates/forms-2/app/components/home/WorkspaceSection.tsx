import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { Folder, FormSummary } from "@shared/form-contract";
import { IconPlus } from "@tabler/icons-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";

import { paths } from "@/components/shell/paths";
import { Button } from "@/components/ui/button";
import { sonnerToast } from "@/components/ui/sonner";

import { FolderRow } from "./FolderRow";
import { FormRow } from "./FormRow";

export function WorkspaceSection({
  id,
  name,
  formCount,
  folders,
  forms,
  seeAll,
  onNewForm,
  heading,
}: {
  id: string;
  name: string;
  formCount: number;
  folders: Folder[];
  forms: FormSummary[];
  seeAll: boolean;
  onNewForm: () => void;
  /** Replaces the linked name, e.g. with a name plus a menu. */
  heading?: ReactNode;
}) {
  const t = useT();
  const move = useActionMutation("move-form");
  const [dragging, setDragging] = useState<string | null>(null);
  // Dropping a row on a folder is the same move the item's own menu performs.
  const dropInto = (folderId: string) => (formId: string) => {
    setDragging(null);
    if (!formId) return;
    move.mutate(
      { id: formId, workspaceId: id, folderId },
      {
        onSuccess: () => sonnerToast.success(t("forms.home.movedToFolder")),
        onError: () => sonnerToast.error(t("forms.home.moveFailed")),
      },
    );
  };
  return (
    <section aria-label={name} className="mb-10">
      <div className="mb-3 flex h-[30px] items-center gap-6 rounded-[7px]">
        <div className="flex h-[21px] flex-1 items-center gap-2">
          {heading ?? (
            <Link
              to={paths.workspace(id)}
              className="-my-[4.5px] truncate py-[4.5px] text-lg leading-[20.7px] font-bold text-[color:var(--forms-ink-heading)]"
            >
              {name}
            </Link>
          )}
          <span className="text-[13px] font-semibold text-muted-foreground">
            {formCount}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label={t("forms.home.newFormIn", { name })}
          onClick={onNewForm}
        >
          <IconPlus className="size-[17px]" />
        </Button>
      </div>
      <div className="rounded-[7px] [&>*+*]:mt-[5px]">
        {folders.map((folder) => (
          <FolderRow
            key={folder.id}
            workspaceId={id}
            folder={folder}
            onDropForm={dropInto(folder.id)}
          />
        ))}
        {forms.length === 0 && folders.length === 0 ? (
          <div className="flex h-11 items-center rounded-[7px] border border-border px-4 text-[13px] text-muted-foreground">
            {t("forms.common.noFormsYet")}
          </div>
        ) : (
          forms.map((form) => (
            <FormRow
              key={form.id}
              form={form}
              onDragStartForm={setDragging}
              onDragEndForm={() => setDragging(null)}
            />
          ))
        )}
      </div>
      {dragging ? (
        <p className="mt-2 px-1 text-[13px] font-medium text-muted-foreground">
          {t("forms.home.dropHint")}
        </p>
      ) : null}
      {seeAll ? (
        <Link
          to={paths.workspace(id)}
          className="mt-2 inline-block px-1 text-[13px] font-semibold text-muted-foreground hover:text-foreground"
        >
          {t("forms.home.seeAll")}
        </Link>
      ) : null}
    </section>
  );
}
