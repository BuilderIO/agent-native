import { useT } from "@agent-native/core/client/i18n";
import { IconDots } from "@tabler/icons-react";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  OrganizationCatalogForm,
  type CatalogEntry,
} from "./OrganizationCatalogForm";

type Values = {
  name: string;
  color: string;
  description?: string;
  endorsed: boolean;
  inLibrary: boolean;
  enforcesReview: boolean;
};
export function OrganizationCatalogMenu({
  entry,
  isStatus,
  showLibrary,
  isDefault,
  names,
  save,
  remove,
}: {
  entry: CatalogEntry;
  isStatus: boolean;
  showLibrary: boolean;
  isDefault: boolean;
  names: readonly string[];
  save: (values: Values) => Promise<void>;
  remove: () => Promise<void>;
}) {
  const t = useT();
  const label = (key: string, values?: Record<string, string>) =>
    t(`analytics.organizationCatalog.${key}`, values);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label("menuName", { name: entry.name })}
          >
            <IconDots size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => {
            if (editing || deleting) event.preventDefault();
          }}
        >
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            {label("edit")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDeleting(true)}>
            {label("deleteMenu")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>
            {label(isStatus ? "updateStatus" : "updateCategory")}
          </DialogTitle>
          <OrganizationCatalogForm
            entry={entry}
            isStatus={isStatus}
            showLibrary={showLibrary}
            isDefault={isDefault}
            names={names}
            close={() => setEditing(false)}
            save={save}
          />
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{label("confirm")}</AlertDialogTitle>
            <AlertDialogDescription>
              {label(isStatus ? "confirmStatus" : "confirmCategory", {
                name: entry.name,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <span role="alert">{error}</span>}
          <AlertDialogFooter>
            <AlertDialogCancel>{label("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                setError("");
                void remove()
                  .then(() => setDeleting(false))
                  .catch((cause: unknown) =>
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : label("deleteError"),
                    ),
                  );
              }}
            >
              {label("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
