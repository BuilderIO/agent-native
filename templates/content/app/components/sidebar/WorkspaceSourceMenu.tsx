import { useT } from "@agent-native/core/client/i18n";
import { IconFolder, IconPlus } from "@tabler/icons-react";
import { useRef, useState, type ReactElement } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useCreateContentSpace } from "@/hooks/use-content-spaces";

export type CreatedWorkspace = {
  spaceId: string;
  filesDatabaseId: string;
  filesDocumentId: string;
  catalogDatabaseId: string;
  catalogItemId: string;
  catalogDocumentId: string;
  name: string;
  kind: "user";
};

export function WorkspaceSourceMenu({
  children,
  align = "start",
  propertyValues,
  onCreated,
}: {
  children: ReactElement;
  align?: "start" | "center" | "end";
  propertyValues?: Record<string, unknown>;
  onCreated?: (
    workspace: CreatedWorkspace,
  ) => boolean | void | Promise<boolean | void>;
}) {
  const t = useT();
  const createContentSpace = useCreateContentSpace();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const requestIdRef = useRef<string | null>(null);

  async function createWorkspace() {
    const workspaceName = name.trim();
    if (!workspaceName) return;
    const requestId = requestIdRef.current ?? crypto.randomUUID();
    requestIdRef.current = requestId;
    try {
      const created = await createContentSpace.mutateAsync({
        name: workspaceName,
        requestId,
        propertyValues,
      });
      const accepted = await onCreated?.(created);
      if (accepted === false) return;
      setDialogOpen(false);
      setName("");
      requestIdRef.current = null;
    } catch (error) {
      toast.error(t("sidebar.failedCreateWorkspace"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="w-52">
          <DropdownMenuItem onSelect={() => setDialogOpen(true)}>
            <IconPlus className="me-2 size-4" />
            {t("sidebar.newWorkspace")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link
              to="/local-files"
              state={{ workspacePropertyValues: propertyValues }}
            >
              <IconFolder className="me-2 size-4" />
              {t("sidebar.localFolder")}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open && !createContentSpace.isPending) {
            setName("");
            requestIdRef.current = null;
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void createWorkspace();
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("sidebar.newWorkspace")}</DialogTitle>
              <DialogDescription>
                {t("sidebar.newWorkspaceDescription")}
              </DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              aria-label={t("sidebar.workspaceName")}
              placeholder={t("sidebar.workspaceName")}
              value={name}
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={createContentSpace.isPending}
                onClick={() => setDialogOpen(false)}
              >
                {t("comments.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={createContentSpace.isPending || !name.trim()}
              >
                {t("sidebar.createWorkspace")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
