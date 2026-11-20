import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { DomainRow } from "@shared/domain-contract";
import { IconPlus } from "@tabler/icons-react";
import { useState } from "react";

import { ConfirmDeleteDialog } from "@/components/form-menu/ConfirmDeleteDialog";
import { errorCodeOf } from "@/components/forms/form-data";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function AddDomainDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const [host, setHost] = useState("");
  const add = useActionMutation("add-domain");
  const trimmed = host.trim();
  const code = errorCodeOf(add.error);

  function submit() {
    if (!trimmed || add.isPending) return;
    add.mutate(
      { host: trimmed },
      {
        onSuccess: () => {
          setHost("");
          onOpenChange(false);
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) add.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("forms.domains.addTitle")}</DialogTitle>
          <DialogDescription>
            {t("forms.domains.addDescription")}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="flex flex-col gap-4"
        >
          <Input
            autoFocus
            aria-label={t("forms.domains.domainLabel")}
            placeholder="forms.example.com"
            value={host}
            maxLength={300}
            onChange={(event) => setHost(event.target.value)}
          />
          {add.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {code === "conflict"
                ? t("forms.domains.alreadyAdded")
                : code === "invalid_input"
                  ? t("forms.domains.invalidHost")
                  : t("forms.domains.addFailed")}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              {t("forms.common.cancel")}
            </Button>
            <Button type="submit" disabled={!trimmed || add.isPending}>
              {t("forms.domains.continue")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RecordsTable({ domain }: { domain: DomainRow }) {
  const t = useT();
  return (
    <table className="mt-4 w-full border-collapse text-left text-sm">
      <thead>
        <tr className="border-b border-b-border text-muted-foreground">
          <th className="w-24 py-2 pr-4 font-medium">
            {t("forms.domains.recordType")}
          </th>
          <th className="py-2 pr-4 font-medium">
            {t("forms.domains.recordName")}
          </th>
          <th className="py-2 font-medium">{t("forms.domains.recordValue")}</th>
        </tr>
      </thead>
      <tbody>
        {domain.records.map((record) => (
          <tr key={record.type} className="border-b border-b-border">
            <td className="py-2.5 pr-4 font-medium">{record.type}</td>
            <td className="py-2.5 pr-4 font-mono text-[13px] break-all">
              {record.name}
            </td>
            <td className="py-2.5 font-mono text-[13px] break-all">
              {record.value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ServedForms({ domain }: { domain: DomainRow }) {
  const t = useT();
  const { data } = useActionQuery("list-forms", { limit: 500, offset: 0 });
  const map = useActionMutation("map-domain-form");
  const unmap = useActionMutation("unmap-domain-form");
  const [formId, setFormId] = useState("");
  const [slug, setSlug] = useState("");
  const mapped = new Set(domain.forms.map((entry) => entry.formId));
  const choices = (data?.forms ?? []).filter(
    (form) => form.status === "published" && !mapped.has(form.id),
  );
  const code = errorCodeOf(map.error);

  return (
    <div className="mt-6">
      <h3 className="mb-2 text-sm font-bold">
        {t("forms.domains.servedForms")}
      </h3>
      {domain.forms.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("forms.domains.servedEmpty")}
        </p>
      ) : (
        <ul className="mb-3 divide-y divide-border rounded-lg border border-border">
          {domain.forms.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <span className="min-w-0 truncate">
                <span className="font-medium">{entry.formName}</span>
                <span className="ml-2 font-mono text-[13px] text-muted-foreground">
                  {domain.host}/{entry.slug}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => unmap.mutate({ id: entry.id })}
              >
                {t("forms.domains.removeForm")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!formId || !slug || map.isPending) return;
          map.mutate(
            { domainId: domain.id, formId, slug },
            {
              onSuccess: () => {
                setFormId("");
                setSlug("");
              },
            },
          );
        }}
      >
        <Select value={formId} onValueChange={setFormId}>
          <SelectTrigger
            aria-label={t("forms.domains.formLabel")}
            className="w-[220px]"
          >
            <SelectValue placeholder={t("forms.domains.formPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {choices.map((form) => (
              <SelectItem key={form.id} value={form.id}>
                {form.name || t("forms.insights.untitled")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          aria-label={t("forms.domains.pathLabel")}
          placeholder={t("forms.domains.pathPlaceholder")}
          className="w-[180px]"
          value={slug}
          maxLength={64}
          onChange={(event) => setSlug(event.target.value.toLowerCase())}
        />
        <Button
          type="submit"
          variant="outline"
          disabled={!formId || !slug || map.isPending}
        >
          {t("forms.domains.addForm")}
        </Button>
      </form>
      {map.isError ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {code === "conflict"
            ? t("forms.domains.pathTaken")
            : code === "invalid_input"
              ? t("forms.domains.pathInvalid")
              : t("forms.domains.mapFailed")}
        </p>
      ) : null}
    </div>
  );
}

function DomainCard({
  domain,
  onDelete,
}: {
  domain: DomainRow;
  onDelete: () => void;
}) {
  const t = useT();
  const verify = useActionMutation("verify-domain");
  const verified = domain.status === "verified";
  const check = verify.data?.check;

  return (
    <section className="rounded-xl border border-border p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <h2 className="truncate text-base font-bold">{domain.host}</h2>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-semibold",
              verified
                ? "bg-[hsl(var(--forms-badge))] text-foreground"
                : "bg-muted text-muted-foreground",
            )}
          >
            {verified
              ? t("forms.domains.statusVerified")
              : t("forms.domains.statusPending")}
          </span>
        </div>
        <div className="flex gap-2">
          {verified ? null : (
            <Button
              variant="outline"
              size="sm"
              disabled={verify.isPending}
              onClick={() => verify.mutate({ id: domain.id })}
            >
              {t("forms.domains.verify")}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onDelete}>
            {t("forms.common.delete")}
          </Button>
        </div>
      </div>
      {verified ? null : (
        <>
          <p className="mt-3 text-sm text-muted-foreground">
            {t("forms.domains.recordsHelp")}
          </p>
          <RecordsTable domain={domain} />
          {check === "no_record" ? (
            <p role="status" className="mt-3 text-sm text-muted-foreground">
              {t("forms.domains.checkNoRecord")}
            </p>
          ) : null}
          {check === "lookup_failed" || verify.isError ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {t("forms.domains.checkFailed")}
            </p>
          ) : null}
        </>
      )}
      {verified ? <ServedForms domain={domain} /> : null}
    </section>
  );
}

export function DomainsSettings() {
  const t = useT();
  const { data, error, refetch } = useActionQuery("list-domains", {});
  const remove = useActionMutation("delete-domain");
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<DomainRow | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const domains = (data?.domains ?? []).filter(
    (domain) => !hidden.has(domain.id),
  );

  function confirmDelete(domain: DomainRow) {
    setHidden((previous) => new Set(previous).add(domain.id));
    remove.mutate(
      { id: domain.id },
      {
        onError: () =>
          setHidden((previous) => {
            const next = new Set(previous);
            next.delete(domain.id);
            return next;
          }),
      },
    );
  }

  return (
    <div className="max-w-[760px]">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg leading-[22px] font-bold">
            {t("forms.domains.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("forms.domains.description")}
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <IconPlus />
          {t("forms.domains.add")}
        </Button>
      </div>
      {error ? (
        <div role="alert" className="text-sm text-destructive">
          {t("forms.domains.loadFailed")}{" "}
          <Button variant="ghost" size="sm" onClick={() => void refetch()}>
            {t("forms.respond.retry")}
          </Button>
        </div>
      ) : !data ? (
        <Skeleton className="h-28 w-full rounded-xl" />
      ) : domains.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-5 py-10 text-center text-sm text-muted-foreground">
          {t("forms.domains.empty")}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {domains.map((domain) => (
            <DomainCard
              key={domain.id}
              domain={domain}
              onDelete={() => setDeleting(domain)}
            />
          ))}
        </div>
      )}
      <AddDomainDialog open={adding} onOpenChange={setAdding} />
      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={t("forms.domains.deleteTitle", { host: deleting?.host ?? "" })}
        description={t("forms.domains.deleteDescription")}
        onConfirm={() => deleting && confirmDelete(deleting)}
      />
    </div>
  );
}
