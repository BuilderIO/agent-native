import { useActionMutation } from "@agent-native/core/client/hooks";
import { IconPlus } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CrmKind } from "@/lib/types";

import type { CrmValue } from "../../../shared/crm-contract";

const recordCopy: Record<
  CrmKind,
  {
    noun: string;
    fieldName: string;
    fieldLabel: string;
    fieldPlaceholder: string;
  }
> = {
  account: {
    noun: "account",
    fieldName: "domain",
    fieldLabel: "Website",
    fieldPlaceholder: "example.com",
  },
  person: {
    noun: "person",
    fieldName: "email",
    fieldLabel: "Email",
    fieldPlaceholder: "name@example.com",
  },
  opportunity: {
    noun: "opportunity",
    fieldName: "stage",
    fieldLabel: "Stage",
    fieldPlaceholder: "Discovery",
  },
};

export function CreateCrmRecordDialog({ kind }: { kind: CrmKind }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const copy = recordCopy[kind];
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [fieldValue, setFieldValue] = useState("");
  const create = useActionMutation<
    { recordId: string },
    {
      connectionId?: string;
      kind: CrmKind;
      displayName: string;
      fields?: Record<string, CrmValue>;
      idempotencyKey?: string;
    }
  >("create-crm-record" as never);

  function reset() {
    setDisplayName("");
    setFieldValue("");
  }

  function setDialogOpen(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) reset();
  }

  async function submit() {
    const fields = fieldValue.trim()
      ? { [copy.fieldName]: fieldValue.trim() }
      : undefined;
    try {
      const result = await create.mutateAsync({
        kind,
        displayName: displayName.trim(),
        fields,
      });
      setDialogOpen(false);
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-crm-records"],
      });
      toast.success(`Native ${copy.noun} created.`);
      navigate(`/records/${encodeURIComponent(result.recordId)}`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : `Could not create ${copy.noun}.`,
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <IconPlus className="size-4" /> New {copy.noun}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create {copy.noun}</DialogTitle>
          <DialogDescription>
            This record lives in the local-authoritative Native SQL CRM. You can
            connect or mirror another CRM separately.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor={`new-${kind}-name`}>Name</Label>
            <Input
              id={`new-${kind}-name`}
              value={displayName}
              maxLength={300}
              autoFocus
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`new-${kind}-${copy.fieldName}`}>
              {copy.fieldLabel}{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id={`new-${kind}-${copy.fieldName}`}
              value={fieldValue}
              maxLength={500}
              placeholder={copy.fieldPlaceholder}
              type={copy.fieldName === "email" ? "email" : "text"}
              onChange={(event) => setFieldValue(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!displayName.trim() || create.isPending}
            onClick={() => void submit()}
          >
            {create.isPending ? "Creating…" : `Create ${copy.noun}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
