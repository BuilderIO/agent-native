import { requestAgentChatThreadOpen } from "@agent-native/core/client/agent-chat";
import { emailToColor } from "@agent-native/core/client/collab";
import { useAvatarUrl } from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { resolveAgentProviderLogo } from "@agent-native/core/client/resources";
import {
  MentionChip,
  type MentionItemMedia as MentionMedia,
} from "@agent-native/toolkit/composer";
import type { CommentMention } from "@shared/comment-mentions";
import { IconExternalLink } from "@tabler/icons-react";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactElement,
} from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useMentionMembers } from "@/hooks/use-mention-members";

import {
  AgentAvatar,
  agentDisplayName,
  agentLogoEngine,
  modelDisplayName,
} from "./agent-identity";
import { CommentAvatar } from "./CommentAvatar";

/**
 * Who a mention pill, an author avatar, or an author name stands for. An AI
 * author also carries the run that wrote the comment; a mentioned agent has
 * no run.
 */
export type CommentIdentity =
  | { kind: "person"; email: string; name: string }
  | {
      kind: "agent";
      model: string | null;
      engine?: string | null;
      provider?: string | null;
      run?: CommentAgentRun;
    };

export interface CommentAgentRun {
  effort: string | null;
  ranAt: string | null;
  /** The agent conversation that wrote the comment, when it was recorded. */
  threadId: string | null;
  /** Agent conversations are private to the person whose run it was. */
  canOpen: boolean;
}

function initial(label: string) {
  return (label.trim()[0] ?? "?").toUpperCase();
}

/** The avatar a person shows in the composer's mention menu and chips. */
export function personMentionMedia(
  email: string,
  label: string,
  avatarUrl: string | null | undefined,
): MentionMedia {
  return avatarUrl
    ? { type: "image", src: avatarUrl, fit: "cover" }
    : {
        type: "text",
        text: initial(label || email),
        backgroundColor: emailToColor(email),
      };
}

/** The provider logo an agent shows in the composer's mention menu and chips. */
export function agentMentionMedia(
  model: string,
  engine: string | null | undefined,
  provider: string | null | undefined,
): MentionMedia {
  const identity = resolveAgentProviderLogo(
    agentLogoEngine(model, engine),
    provider ?? undefined,
  );
  return identity.logoUrl
    ? { type: "image", src: identity.logoUrl }
    : { type: "text", text: initial(provider || modelDisplayName(model)) };
}

function identityOfMention(mention: CommentMention): CommentIdentity {
  return mention.kind === "agent"
    ? {
        kind: "agent",
        model: mention.model,
        engine: mention.engine,
        provider: mention.provider,
      }
    : { kind: "person", email: mention.email, name: mention.name };
}

/**
 * A sent `@mention`, drawn like the composer chip it was typed as: avatar or
 * provider logo, then the name.
 */
export function CommentMentionPill({ mention }: { mention: CommentMention }) {
  const avatarUrl = useAvatarUrl(
    mention.kind === "person" ? mention.email : null,
  );
  const media =
    mention.kind === "agent"
      ? agentMentionMedia(mention.model, mention.engine, mention.provider)
      : personMentionMedia(mention.email, mention.name, avatarUrl);
  return (
    <CommentIdentityHoverCard identity={identityOfMention(mention)}>
      <MentionChip
        tabIndex={0}
        data-comment-mention={mention.kind}
        className="leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        icon={mention.kind === "agent" ? "agent" : "user"}
        media={media}
        label={
          <>
            <span className="sr-only">@</span>
            {mention.name}
          </>
        }
      />
    </CommentIdentityHoverCard>
  );
}

const REASONING_EFFORT_KEYS: Record<string, string> = {
  auto: "agentChat.composer.reasoningEffort.auto",
  none: "agentChat.composer.reasoningEffort.none",
  minimal: "agentChat.composer.reasoningEffort.minimal",
  low: "agentChat.composer.reasoningEffort.low",
  medium: "agentChat.composer.reasoningEffort.medium",
  high: "agentChat.composer.reasoningEffort.high",
  xhigh: "agentChat.composer.reasoningEffort.xhigh",
  max: "agentChat.composer.reasoningEffort.max",
};

const ROLE_KEYS: Record<string, string> = {
  owner: "comments.identityRoleOwner",
  admin: "comments.identityRoleAdmin",
  member: "comments.identityRoleMember",
};

function IdentityDetail({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-foreground">{value}</dd>
    </>
  );
}

function PersonIdentityCard({ email, name }: { email: string; name: string }) {
  const t = useT();
  const { data: members } = useMentionMembers();
  const member = members?.find(
    (candidate) => candidate.email.toLowerCase() === email.toLowerCase(),
  );
  const roleKey = member?.role ? ROLE_KEYS[member.role] : undefined;
  const displayName = member?.name?.trim() || name || email.split("@")[0];
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <CommentAvatar email={email} name={displayName} className="size-9" />
      <div className="grid min-w-0 gap-0.5">
        <span className="truncate text-sm font-semibold">{displayName}</span>
        <span className="truncate text-xs text-muted-foreground">{email}</span>
        <span className="truncate text-xs text-muted-foreground">
          {t("comments.identityPerson")}
          {roleKey ? ` · ${t(roleKey)}` : ""}
        </span>
      </div>
    </div>
  );
}

function AgentIdentityCard({
  identity,
}: {
  identity: Extract<CommentIdentity, { kind: "agent" }>;
}) {
  const t = useT();
  const formatters = useFormatters();
  const { run } = identity;
  const name = run
    ? agentDisplayName(identity.model)
    : modelDisplayName(identity.model);
  const ranAt = run?.ranAt ? new Date(run.ranAt) : null;
  const effortKey = run?.effort ? REASONING_EFFORT_KEYS[run.effort] : undefined;
  return (
    <div className="grid gap-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <AgentAvatar
          model={identity.model}
          engine={identity.engine}
          className="size-9"
        />
        <div className="grid min-w-0 gap-0.5">
          <span className="truncate text-sm font-semibold">{name}</span>
          <span className="truncate text-xs text-muted-foreground">
            {t("comments.agentBadge")}
            {identity.provider ? ` · ${identity.provider}` : ""}
          </span>
        </div>
      </div>
      {run ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          <IdentityDetail
            label={t("comments.identityModel")}
            value={modelDisplayName(identity.model)}
          />
          <IdentityDetail
            label={t("comments.identityEffort")}
            value={
              run.effort
                ? effortKey
                  ? t(effortKey, { defaultValue: run.effort })
                  : run.effort
                : t("comments.identityNotRecorded")
            }
          />
          <IdentityDetail
            label={t("comments.identityRan")}
            value={
              ranAt && !Number.isNaN(ranAt.getTime())
                ? formatters.formatDate(ranAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })
                : t("comments.identityNotRecorded")
            }
          />
        </dl>
      ) : null}
      {run?.threadId && run.canOpen ? (
        <button
          type="button"
          data-comment-identity-open-run
          onClick={() =>
            requestAgentChatThreadOpen({ threadId: run.threadId! })
          }
          className="inline-flex h-7 items-center gap-1.5 justify-self-start rounded-md px-2 text-xs font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <IconExternalLink size={14} />
          {t("comments.identityOpenRun")}
        </button>
      ) : null}
    </div>
  );
}

const HOVER_OPEN_DELAY_MS = 300;
const HOVER_CLOSE_DELAY_MS = 150;

/**
 * The one card behind every person or agent in a comment: mention pills,
 * author avatars, and author names all open it. Hovering shows it at a
 * glance; a click or Enter opens it with focus inside. It is a popover, not a
 * Radix hover card, because a hover card takes its links out of the tab order
 * and keyboard users could never reach "Open run".
 */
export function CommentIdentityHoverCard({
  identity,
  children,
}: {
  identity: CommentIdentity;
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  // A hover-opened card must not take focus, or give it back to its trigger
  // when it closes: the pointer passing over a pill would pull focus out of
  // the comment being typed.
  const openedByHover = useRef(false);
  const hoverTimer = useRef<number | undefined>(undefined);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const hover = (entering: boolean) => (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse") return;
    window.clearTimeout(hoverTimer.current);
    if (entering ? open : !open || !openedByHover.current) return;
    hoverTimer.current = window.setTimeout(
      () => {
        if (entering) openedByHover.current = true;
        setOpen(entering);
      },
      entering ? HOVER_OPEN_DELAY_MS : HOVER_CLOSE_DELAY_MS,
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        ref={triggerRef}
        asChild
        role="button"
        onPointerEnter={hover(true)}
        onPointerLeave={hover(false)}
        onClick={(event) => {
          // The comment row's click would focus its reply box, and focus
          // leaving the card closes it.
          event.stopPropagation();
          window.clearTimeout(hoverTimer.current);
          // Clicking a card the pointer already opened keeps it open, with
          // focus inside as if the click had opened it; Radix only moves
          // focus in when the card mounts.
          if (open && openedByHover.current) {
            event.preventDefault();
            const card = cardRef.current;
            (card?.querySelector<HTMLElement>("button") ?? card)?.focus();
          }
          openedByHover.current = false;
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.currentTarget.click();
        }}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent
        ref={cardRef}
        side="top"
        align="start"
        sideOffset={6}
        className="w-64 p-3"
        data-comment-identity-card={identity.kind}
        onPointerEnter={hover(true)}
        onPointerLeave={hover(false)}
        onOpenAutoFocus={(event) => {
          if (openedByHover.current) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          if (openedByHover.current) event.preventDefault();
        }}
        // Radix counts focus moving onto the trigger as leaving the card, and
        // then leaves focus on the page instead of the trigger when it closes.
        onFocusOutside={(event) => {
          if (triggerRef.current?.contains(event.target as Node)) {
            event.preventDefault();
          }
        }}
        // The card is portaled but still bubbles through React to the
        // comment row, whose click selects the thread.
        onClick={(event) => event.stopPropagation()}
      >
        {identity.kind === "person" ? (
          <PersonIdentityCard email={identity.email} name={identity.name} />
        ) : (
          <AgentIdentityCard identity={identity} />
        )}
      </PopoverContent>
    </Popover>
  );
}
