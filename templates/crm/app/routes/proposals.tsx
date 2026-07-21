import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
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
} from "@agent-native/toolkit/ui/alert-dialog";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import { IconExternalLink, IconShieldCheck } from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import {
  LoadingRows,
  PageHeader,
  SetupEmptyState,
} from "@/components/crm/Surface";

interface ProposalPreview {
  id: string;
  recordId?: string;
  recordName?: string;
  operation: string;
  status: string;
  risk?: string;
  createdAt?: string;
  fields?: Array<{ name: string; before?: unknown; after?: unknown }>;
}

export default function ProposalsRoute() {
  const query = useActionQuery<unknown>(
    "list-crm-proposals" as never,
    { limit: 100 } as never,
  );
  const apply = useActionMutation<
    { status?: string; message?: string },
    { proposalId: string }
  >("apply-crm-proposals" as never);
  const proposals = normalizeProposals(query.data);
  const [pendingProposalIds, setPendingProposalIds] = useState<Set<string>>(
    new Set(),
  );

  async function applyProposal(proposalId: string) {
    setPendingProposalIds((current) => new Set(current).add(proposalId));
    try {
      const result = await apply.mutateAsync({ proposalId });
      toast.info(
        result.message ||
          "Proposal reviewed. Complete the approved change in HubSpot.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Proposal failed.");
    } finally {
      setPendingProposalIds((current) => {
        const next = new Set(current);
        next.delete(proposalId);
        return next;
      });
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Review"
        title="Proposals"
        description="Review the exact record and field scope before completing HubSpot changes upstream."
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
                      {proposal.recordName || "CRM record"}
                    </p>
                    <Badge
                      variant="secondary"
                      className="font-normal capitalize"
                    >
                      {proposal.status}
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
                        Record <IconExternalLink className="size-3.5" />
                      </Link>
                    </Button>
                  ) : null}
                  {proposal.status === "pending" ? (
                    <ApprovalButton
                      proposal={proposal}
                      pending={pendingProposalIds.has(proposal.id)}
                      onApprove={() => void applyProposal(proposal.id)}
                    />
                  ) : null}
                </div>
              </div>
              <ProposalFields fields={proposal.fields} />
            </section>
          ))}
        </div>
      ) : (
        <SetupEmptyState
          title="No CRM proposals"
          description="Agent-initiated provider edits appear here before anything changes upstream."
        />
      )}
    </>
  );
}

function ApprovalButton({
  proposal,
  pending,
  onApprove,
}: {
  proposal: ProposalPreview;
  pending: boolean;
  onApprove: () => void;
}) {
  const fieldNames = proposal.fields?.map((field) => field.name).join(", ");
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" className="gap-1.5" disabled={pending}>
          <IconShieldCheck className="size-4" /> Review upstream change
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Review this provider change</AlertDialogTitle>
          <AlertDialogDescription>
            HubSpot cannot apply this expected revision atomically. Review
            {proposal.recordName ? ` ${proposal.recordName}` : " this record"}
            {fieldNames ? ` in ${fieldNames}` : ""}, then make the change in
            HubSpot.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ProposalFields fields={proposal.fields} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onApprove}>Acknowledge</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ProposalFields({ fields }: { fields?: ProposalPreview["fields"] }) {
  if (!fields?.length) {
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        The field preview is unavailable. Approval remains scoped to this single
        record.
      </p>
    );
  }
  return (
    <dl className="mt-4 divide-y divide-border/70 rounded-md border border-border/70">
      {fields.slice(0, 20).map((field) => (
        <div
          key={field.name}
          className="grid grid-cols-[8rem_1fr_1fr] gap-3 px-3 py-2 text-sm"
        >
          <dt className="truncate text-muted-foreground">{field.name}</dt>
          <dd className="break-words">{displayValue(field.before)}</dd>
          <dd className="break-words font-medium">
            {displayValue(field.after)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function normalizeProposals(data: unknown): ProposalPreview[] {
  const rows =
    isObject(data) && Array.isArray(data.proposals) ? data.proposals : [];
  return rows.flatMap((row) => {
    if (!isObject(row) || typeof row.id !== "string") return [];
    const fields = Array.isArray(row.fields)
      ? row.fields.flatMap((field) =>
          isObject(field) && typeof field.name === "string"
            ? [{ name: field.name, before: field.before, after: field.after }]
            : [],
        )
      : undefined;
    return [
      {
        id: row.id,
        recordId: typeof row.recordId === "string" ? row.recordId : undefined,
        recordName:
          typeof row.recordName === "string" ? row.recordName : undefined,
        operation: typeof row.operation === "string" ? row.operation : "update",
        status: typeof row.status === "string" ? row.status : "pending",
        risk: typeof row.risk === "string" ? row.risk : undefined,
        createdAt:
          typeof row.createdAt === "string" ? row.createdAt : undefined,
        fields,
      },
    ];
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return "Structured value";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}
