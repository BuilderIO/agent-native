import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconBolt,
  IconChecklist,
  IconExternalLink,
  IconFilePlus,
  IconPencil,
} from "@tabler/icons-react";
import { useState } from "react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CrmRecordDetail } from "@/lib/types";

export function RecordActions({ record }: { record: CrmRecordDetail }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <EditFieldDialog record={record} />
      <CreateRecordTaskDialog recordId={record.id} />
      <AttachEvidenceDialog recordId={record.id} />
      <CallEvidenceAutomationDialog record={record} />
    </div>
  );
}

function EditFieldDialog({ record }: { record: CrmRecordDetail }) {
  const isNative = record.provider === "native";
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<"local" | "provider">(
    isNative ? "local" : "provider",
  );
  const [field, setField] = useState("");
  const [value, setValue] = useState("");
  const [valueType, setValueType] = useState<"string" | "number" | "boolean">(
    "string",
  );
  const update = useActionMutation<
    { mutationId: string; status?: string },
    {
      recordId: string;
      target: "local" | "provider";
      fields: Record<string, string | number | boolean>;
      expectedRemoteRevision?: string;
    }
  >("update-crm-record" as never);
  const apply = useActionMutation<
    { status?: string; message?: string },
    { proposalId: string }
  >("apply-crm-proposals" as never);

  async function submit() {
    const nextValue =
      valueType === "number"
        ? Number(value)
        : valueType === "boolean"
          ? value === "true"
          : value;
    if (valueType === "number" && !Number.isFinite(nextValue)) {
      toast.error("Enter a valid number.");
      return;
    }
    try {
      const result = await update.mutateAsync({
        recordId: record.id,
        target,
        fields: { [field.trim()]: nextValue },
        ...((isNative || target === "provider") && record.remoteRevision
          ? { expectedRemoteRevision: record.remoteRevision }
          : {}),
      });
      if (target === "provider" && result.status === "pending") {
        const applied = await apply.mutateAsync({
          proposalId: result.mutationId,
        });
        if (applied.status !== "applied") {
          throw new Error(
            applied.message ||
              `Provider update finished as ${applied.status ?? "unknown"}.`,
          );
        }
      }
      setOpen(false);
      setField("");
      setValue("");
      toast.success(
        target === "provider"
          ? "Connected CRM field updated."
          : "Local CRM field updated.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "CRM update failed.",
      );
    }
  }

  function setDialogOpen(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen && isNative) setTarget("local");
  }

  return (
    <Dialog open={open} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <IconPencil className="size-4" /> Edit field
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit CRM field</DialogTitle>
          <DialogDescription>
            {isNative
              ? "Native SQL records are local-authoritative, so changes save directly to this workspace."
              : "Provider edits become reviewable proposals and remain fail-closed unless the connected CRM proves an atomic expected-revision write. Local changes are limited to local-authoritative fields."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          {isNative ? null : (
            <FormField label="Authority" htmlFor="field-target">
              <Select
                value={target}
                onValueChange={(next) =>
                  setTarget(next as "local" | "provider")
                }
              >
                <SelectTrigger id="field-target">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="provider">
                    Connected CRM proposal
                  </SelectItem>
                  <SelectItem value="local">Local CRM field</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          )}
          <FormField label="Field name" htmlFor="field-name">
            <Input
              id="field-name"
              value={field}
              maxLength={120}
              placeholder={
                isNative || target === "local"
                  ? "desiredCadenceDays"
                  : record.provider === "salesforce"
                    ? "StageName"
                    : "lifecyclestage"
              }
              onChange={(event) => setField(event.target.value)}
            />
          </FormField>
          <FormField label="Value type" htmlFor="field-type">
            <Select
              value={valueType}
              onValueChange={(next) => setValueType(next as typeof valueType)}
            >
              <SelectTrigger id="field-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="string">Text</SelectItem>
                <SelectItem value="number">Number</SelectItem>
                <SelectItem value="boolean">Boolean</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="New value" htmlFor="field-value">
            {valueType === "boolean" ? (
              <Select value={value} onValueChange={setValue}>
                <SelectTrigger id="field-value">
                  <SelectValue placeholder="Choose a value" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">True</SelectItem>
                  <SelectItem value="false">False</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Input
                id="field-value"
                type={valueType === "number" ? "number" : "text"}
                value={value}
                maxLength={4_000}
                onChange={(event) => setValue(event.target.value)}
              />
            )}
          </FormField>
        </div>
        <DialogFooter>
          <Button
            disabled={
              !field.trim() || !value || update.isPending || apply.isPending
            }
            onClick={() => void submit()}
          >
            {isNative
              ? "Save field"
              : target === "provider"
                ? `Prepare ${record.provider === "salesforce" ? "Salesforce" : "HubSpot"} change`
                : "Update locally"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateRecordTaskDialog({ recordId }: { recordId: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const create = useActionMutation<
    unknown,
    { recordId: string; title: string; dueAt?: string; status: "open" }
  >("manage-crm-task" as never);

  async function submit() {
    try {
      await create.mutateAsync({
        recordId,
        title: title.trim(),
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        status: "open",
      });
      setOpen(false);
      setTitle("");
      setDueAt("");
      toast.success("Follow-up task created.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Task creation failed.",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <IconChecklist className="size-4" /> Add task
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add record task</DialogTitle>
          <DialogDescription>
            Keep a local follow-up next to this CRM record.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <FormField label="Title" htmlFor="record-task-title">
            <Input
              id="record-task-title"
              value={title}
              maxLength={300}
              onChange={(event) => setTitle(event.target.value)}
            />
          </FormField>
          <FormField label="Due" htmlFor="record-task-due">
            <Input
              id="record-task-due"
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button
            disabled={!title.trim() || create.isPending}
            onClick={() => void submit()}
          >
            Create task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AttachEvidenceDialog({ recordId }: { recordId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [artifactId, setArtifactId] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [quote, setQuote] = useState("");
  const [summary, setSummary] = useState("");
  const attach = useActionMutation<
    unknown,
    {
      recordId: string;
      artifactId: string;
      sourceUrl: string;
      sourceApp: "clips";
      quote?: string;
      summary?: string;
    }
  >("attach-call-evidence" as never);

  async function submit() {
    try {
      await attach.mutateAsync({
        recordId,
        artifactId: artifactId.trim(),
        sourceUrl: sourceUrl.trim(),
        sourceApp: "clips",
        quote: quote.trim() || undefined,
        summary: summary.trim() || undefined,
      });
      setOpen(false);
      setArtifactId("");
      setSourceUrl("");
      setQuote("");
      setSummary("");
      toast.success(t("recordActions.evidenceAttached"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("recordActions.evidenceAttachFailed"),
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <IconFilePlus className="size-4" /> {t("recordActions.addEvidence")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("recordActions.attachEvidenceTitle")}</DialogTitle>
          <DialogDescription>
            {t("recordActions.attachEvidenceDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <FormField
            label={t("recordActions.artifactId")}
            htmlFor="evidence-id"
          >
            <Input
              id="evidence-id"
              value={artifactId}
              maxLength={256}
              onChange={(event) => setArtifactId(event.target.value)}
            />
          </FormField>
          <FormField label={t("recordActions.clipsUrl")} htmlFor="evidence-url">
            <Input
              id="evidence-url"
              type="url"
              value={sourceUrl}
              maxLength={2_048}
              onChange={(event) => setSourceUrl(event.target.value)}
            />
          </FormField>
          <FormField
            label={t("recordActions.summary")}
            htmlFor="evidence-summary"
            className="sm:col-span-2"
          >
            <Input
              id="evidence-summary"
              value={summary}
              maxLength={2_000}
              onChange={(event) => setSummary(event.target.value)}
            />
          </FormField>
          <FormField
            label={t("recordActions.shortExcerpt")}
            htmlFor="evidence-quote"
            className="sm:col-span-2"
          >
            <Textarea
              id="evidence-quote"
              value={quote}
              maxLength={1_200}
              onChange={(event) => setQuote(event.target.value)}
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button
            disabled={
              !artifactId.trim() || !sourceUrl.trim() || attach.isPending
            }
            onClick={() => void submit()}
          >
            {t("recordActions.attachEvidence")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CallEvidenceAutomationDialog({ record }: { record: CrmRecordDetail }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const recipeQuery = useActionQuery<{
    title: string;
    description: string;
    enabledByDefault: false;
    agentContext: string;
  }>("get-crm-automation-recipe" as never, { recordId: record.id } as never, {
    enabled: open,
  });
  const recipe = recipeQuery.data;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <IconBolt className="size-4" /> {t("recordActions.automate")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {recipe?.title ?? t("recordActions.reviewNewClipsCalls")}
          </DialogTitle>
          <DialogDescription>
            {recipe?.description ?? t("recordActions.reviewDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            {t("recordActions.disabledAutomationDescription", {
              name: record.displayName,
            })}
          </p>
          <p>{t("recordActions.handoffDescription", { path: "/r" })}</p>
        </div>
        <DialogFooter className="flex-row flex-wrap justify-end gap-2 sm:justify-end">
          <Button asChild variant="ghost" size="sm" className="gap-1.5">
            <Link to="/agent#jobs" onClick={() => setOpen(false)}>
              <IconExternalLink className="size-4" />{" "}
              {t("recordActions.manageAutomations")}
            </Link>
          </Button>
          <Button
            size="sm"
            disabled={!recipe || recipeQuery.isLoading}
            onClick={() => {
              if (!recipe) return;
              sendToAgentChat({
                message: `Set up the disabled Clips call-evidence review recipe for ${record.displayName}.`,
                context: recipe.agentContext,
                submit: true,
                newTab: true,
              });
              setOpen(false);
            }}
          >
            {t("recordActions.configureWithAgent")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormField({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`grid gap-2 ${className ?? ""}`}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
