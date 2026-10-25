import type { AgentApprovalRequest } from "@agent-native/agentkit/protocol";
import { IconChevronDown, IconShieldCheck } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { ActionButton, IconButton } from "../../../agentkit.js";
import { Menu } from "../../../design-system/index.js";
import { cn } from "../../../utils.js";
import { ActionCard } from "../../chat/chat/widgets/ActionCard.js";

const SESSION_REPLAY_MASK_PROPS = { "data-an-mask": "" } as const;

export type ApprovalDecision = "approve" | "deny";

// The protocol gives an option no decision of its own, so its id is the only
// signal. Anything other than a refusal is a way of approving ("Allow once",
// "Delete branches").
const DENY_OPTION_IDS = new Set(["deny", "cancel", "reject", "decline", "no"]);

export function approvalOptionDecision(option: {
  id: string;
}): ApprovalDecision {
  return DENY_OPTION_IDS.has(option.id.trim().toLowerCase())
    ? "deny"
    : "approve";
}

/**
 * How a request renders: "approval" is one-click buttons, "choice" is a
 * pick-then-submit list. A kind-less request with options means a choice
 * list, so only the bare approve/deny pair reads as an approval there.
 */
export function approvalRequestKind(
  request: Pick<AgentApprovalRequest, "kind" | "input" | "options">,
): "approval" | "choice" | "input" {
  const optionIds = (request.options ?? []).map((option) => option.id);
  if (request.kind === "approval" || request.kind === "choice") {
    return request.kind;
  }
  if (optionIds.length > 0) {
    return request.kind === undefined &&
      optionIds.length === 2 &&
      optionIds.includes("approve") &&
      optionIds.includes("deny")
      ? "approval"
      : "choice";
  }
  // An input request with nothing to fill in has only approve or deny left.
  return request.input ? "input" : "approval";
}

export interface ApprovalCardAction {
  id: string;
  label: string;
  intent?: "primary" | "neutral" | "danger";
  disabled?: boolean;
  pending?: boolean;
  onPress: () => void;
}

export interface ApprovalCardMenuItem {
  id: string;
  label: string;
  hint?: string;
}

export interface ApprovalCardProps {
  title: string;
  status: string;
  detail?: string | undefined;
  icon?: ReactNode;
  actions: readonly ApprovalCardAction[];
  /** Extra choices split off the primary action. Items are text only. */
  menu?: {
    label: string;
    items: readonly ApprovalCardMenuItem[];
    onAction: (id: string) => void;
  };
  busy?: boolean;
  error?: ReactNode;
  /** Fields or a choice list; actions then move to a footer below them. */
  children?: ReactNode;
  className?: string;
}

export function ApprovalCard({
  title,
  status,
  detail,
  icon,
  actions,
  menu,
  busy = false,
  error,
  children,
  className,
}: ApprovalCardProps) {
  const actionRow = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {actions.map((action) => {
        const button = (
          <ActionButton
            key={action.id}
            size="compact"
            intent={action.intent ?? "neutral"}
            emphasis={
              action.intent === "primary" || action.intent === "danger"
                ? "solid"
                : "outline"
            }
            {...(menu && action.intent === "primary"
              ? { className: "rounded-e-none" }
              : {})}
            disabled={busy || action.disabled === true}
            pending={action.pending === true}
            data-approval-action={action.id}
            onPress={action.onPress}
          >
            {action.label}
          </ActionButton>
        );
        if (!menu || action.intent !== "primary") return button;
        return (
          <div key={action.id} className="inline-flex items-stretch">
            {button}
            <Menu
              align="end"
              onAction={(id) => menu.onAction(String(id))}
              items={menu.items.map((item) => ({
                id: item.id,
                label: <span title={item.hint}>{item.label}</span>,
                disabled: busy,
              }))}
              trigger={
                <IconButton
                  size="compact"
                  intent="primary"
                  emphasis="solid"
                  label={menu.label}
                  disabled={busy}
                  className="rounded-s-none border-s border-primary-foreground/25"
                  icon={
                    <IconChevronDown aria-hidden="true" className="size-4" />
                  }
                />
              }
            />
          </div>
        );
      })}
    </div>
  );
  return (
    <section
      className={cn(
        "agentkit-approval overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-(--agent-kit-control-elevation)",
        className,
      )}
      aria-label={title}
      aria-busy={busy || undefined}
    >
      <ActionCard
        icon={icon ?? <IconShieldCheck aria-hidden="true" className="size-4" />}
        title={title}
        {...(detail === undefined ? {} : { detail })}
        status={status}
        {...(children ? {} : { action: actionRow })}
        // Approval copy is the question being asked; it wraps rather than
        // truncating behind a hover title.
        className="rounded-none border-0 bg-transparent shadow-none [&_p]:whitespace-normal"
      />
      {children ? (
        <>
          <div className="agentkit-approval-body grid gap-3 px-3 pb-3">
            {children}
          </div>
          <div className="agentkit-approval-footer border-t border-border px-3 py-2">
            {actionRow}
          </div>
        </>
      ) : null}
      {error ? (
        <p
          {...SESSION_REPLAY_MASK_PROPS}
          role="alert"
          className="agentkit-command-error m-0 block px-3 pb-3 text-xs"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}
