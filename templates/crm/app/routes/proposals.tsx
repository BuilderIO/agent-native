import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconExternalLink, IconShieldCheck } from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import {
  LoadingRows,
  PageHeader,
  SetupEmptyState,
} from "@/components/crm/Surface";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface ProposalField {
  name: string;
  before?: unknown;
  after?: unknown;
  beforeKnown?: boolean;
}

interface ProposalPreview {
  id: string;
  recordId?: string;
  recordName?: string;
  provider?: string;
  operation: string;
  status: string;
  risk?: string;
  createdAt?: string;
  appliedAt?: string;
  recordUrl?: string;
  recordUrlUnavailableReason?: string;
  fields?: ProposalField[];
}

interface PreparedHandoff {
  proposalId: string;
  providerLabel: string;
  recordUrl: string | null;
  recordUrlUnavailableReason: string | null;
  fields: Array<{
    name: string;
    beforeKnown: boolean;
    before: unknown;
    after: unknown;
  }>;
}

export default function ProposalsRoute() {
  const t = useT();
  const query = useActionQuery<unknown>(
    "list-crm-proposals" as never,
    { limit: 100 } as never,
  );
  const prepare = useActionMutation<PreparedHandoff, { proposalId: string }>(
    "apply-crm-proposals" as never,
  );
  const proposals = normalizeProposals(query.data);
  const [preparingIds, setPreparingIds] = useState<Set<string>>(new Set());

  async function prepareHandoff(proposal: ProposalPreview) {
    setPreparingIds((current) => new Set(current).add(proposal.id));
    try {
      const handoff = await prepare.mutateAsync({ proposalId: proposal.id });
      await query.refetch();
      // Never phrased as a completed upstream write, and never as a failure.
      toast.info(
        t("proposals.preparedToast", { provider: handoff.providerLabel }),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("proposals.prepareFailedToast"),
      );
    } finally {
      setPreparingIds((current) => {
        const next = new Set(current);
        next.delete(proposal.id);
        return next;
      });
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={t("proposals.eyebrow")}
        title={t("proposals.title")}
        description={t("proposals.description")}
      />
      {query.isLoading ? (
        <LoadingRows rows={6} />
      ) : proposals.length ? (
        <div className="grid gap-3 p-5 sm:p-7">
          {proposals.map((proposal) => (
            <section
              key={proposal.id}
              className="rounded-lg border border-border/70 bg-card p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">
                      {proposal.recordName || t("proposals.untitledRecord")}
                    </p>
                    <Badge variant="secondary" className="font-normal">
                      {t(`proposals.status.${statusKey(proposal)}`)}
                    </Badge>
                    {proposal.risk ? (
                      <Badge
                        variant="outline"
                        className="font-normal capitalize"
                      >
                        {proposal.risk}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {proposal.operation}
                    {proposal.createdAt
                      ? ` · ${formatDate(proposal.createdAt)}`
                      : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {proposal.recordId ? (
                    <Button
                      asChild
                      variant="ghost"
                      size="sm"
                      className="gap-1.5"
                    >
                      <Link
                        to={`/records/${encodeURIComponent(proposal.recordId)}`}
                      >
                        {t("proposals.openRecord")}
                        <IconExternalLink className="size-3.5" />
                      </Link>
                    </Button>
                  ) : null}
                  {proposal.status === "pending" ? (
                    <PrepareButton
                      proposal={proposal}
                      pending={preparingIds.has(proposal.id)}
                      onPrepare={() => void prepareHandoff(proposal)}
                    />
                  ) : proposal.recordUrl ? (
                    <Button asChild size="sm" className="gap-1.5">
                      <a
                        href={proposal.recordUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t("proposals.completeUpstream", {
                          provider: providerLabel(proposal.provider),
                        })}
                        <IconExternalLink className="size-3.5" />
                      </a>
                    </Button>
                  ) : null}
                </div>
              </div>
              {proposal.status === "approved" && !proposal.appliedAt ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  {t("proposals.handedOffNote", {
                    provider: providerLabel(proposal.provider),
                  })}
                </p>
              ) : null}
              {proposal.recordUrl ||
              proposal.status === "pending" ||
              !proposal.recordUrlUnavailableReason ? null : (
                <p className="mt-3 text-xs text-muted-foreground">
                  {t("proposals.recordLinkUnavailable", {
                    provider: providerLabel(proposal.provider),
                    reason: proposal.recordUrlUnavailableReason,
                  })}
                </p>
              )}
              <ProposalFields fields={proposal.fields} />
            </section>
          ))}
        </div>
      ) : (
        <SetupEmptyState
          title={t("proposals.emptyTitle")}
          description={t("proposals.emptyDescription")}
        />
      )}
    </>
  );
}

function PrepareButton({
  proposal,
  pending,
  onPrepare,
}: {
  proposal: ProposalPreview;
  pending: boolean;
  onPrepare: () => void;
}) {
  const t = useT();
  const provider = providerLabel(proposal.provider);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" className="gap-1.5" disabled={pending}>
          <IconShieldCheck className="size-4" />{" "}
          {t("proposals.prepareChange", { provider })}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("proposals.prepareTitle", { provider })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("proposals.prepareDescription", {
              provider,
              record: proposal.recordName || t("proposals.untitledRecord"),
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ProposalFields fields={proposal.fields} />
        {proposal.recordUrl || !proposal.recordUrlUnavailableReason ? null : (
          <p className="text-sm text-muted-foreground">
            {t("proposals.recordLinkUnavailable", {
              provider,
              reason: proposal.recordUrlUnavailableReason,
            })}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{t("proposals.cancel")}</AlertDialogCancel>
          {/* The upstream tab has to open from the click itself — opening it
              after the prepare round-trip trips popup blockers. */}
          {proposal.recordUrl ? (
            <AlertDialogAction asChild>
              <a
                href={proposal.recordUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onPrepare}
              >
                {t("proposals.prepareAndOpen", { provider })}
              </a>
            </AlertDialogAction>
          ) : (
            <AlertDialogAction onClick={onPrepare}>
              {t("proposals.prepareWithoutLink")}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ProposalFields({ fields }: { fields?: ProposalField[] }) {
  const t = useT();
  if (!fields?.length) {
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        {t("proposals.fieldPreviewUnavailable")}
      </p>
    );
  }
  return (
    <dl className="mt-4 divide-y divide-border/70 overflow-x-auto rounded-md border border-border/70">
      {fields.slice(0, 20).map((field) => (
        <div
          key={field.name}
          className="grid grid-cols-[8rem_1fr_1fr] gap-3 px-3 py-2 text-sm"
        >
          <dt className="truncate text-muted-foreground">{field.name}</dt>
          <dd className="break-words text-muted-foreground">
            {field.beforeKnown === false
              ? t("proposals.notMirrored")
              : displayValue(field.before, t)}
          </dd>
          <dd className="break-words font-medium">
            {displayValue(field.after, t)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * `approved` without `appliedAt` is a prepared handoff, not an upstream write.
 * Labelling it "Approved" would read as done.
 */
function statusKey(proposal: ProposalPreview) {
  if (proposal.status === "approved" && !proposal.appliedAt) return "prepared";
  return proposal.status;
}

function providerLabel(provider?: string) {
  return provider === "salesforce" ? "Salesforce" : "HubSpot";
}

function normalizeProposals(data: unknown): ProposalPreview[] {
  const rows =
    isObject(data) && Array.isArray(data.proposals) ? data.proposals : [];
  return rows.flatMap((row) => {
    if (!isObject(row) || typeof row.id !== "string") return [];
    const fields = Array.isArray(row.fields)
      ? row.fields.flatMap((field) =>
          isObject(field) && typeof field.name === "string"
            ? [
                {
                  name: field.name,
                  before: field.before,
                  after: field.after,
                  ...(typeof field.beforeKnown === "boolean"
                    ? { beforeKnown: field.beforeKnown }
                    : {}),
                },
              ]
            : [],
        )
      : undefined;
    return [
      {
        id: row.id,
        recordId: typeof row.recordId === "string" ? row.recordId : undefined,
        recordName:
          typeof row.recordName === "string" ? row.recordName : undefined,
        provider: typeof row.provider === "string" ? row.provider : undefined,
        operation: typeof row.operation === "string" ? row.operation : "update",
        status: typeof row.status === "string" ? row.status : "pending",
        risk: typeof row.risk === "string" ? row.risk : undefined,
        createdAt:
          typeof row.createdAt === "string" ? row.createdAt : undefined,
        appliedAt:
          typeof row.appliedAt === "string" ? row.appliedAt : undefined,
        recordUrl:
          typeof row.recordUrl === "string" ? row.recordUrl : undefined,
        recordUrlUnavailableReason:
          typeof row.recordUrlUnavailableReason === "string"
            ? row.recordUrlUnavailableReason
            : undefined,
        fields,
      },
    ];
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function displayValue(
  value: unknown,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (value === null || value === undefined || value === "")
    return t("proposals.emptyValue");
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (typeof value === "boolean")
    return value ? t("proposals.booleanTrue") : t("proposals.booleanFalse");
  return t("proposals.structuredValue");
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}
