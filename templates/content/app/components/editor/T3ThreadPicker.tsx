import { useT } from "@agent-native/core/client/i18n";
import type { CommentAgentMention } from "@shared/comment-mentions";
import { IconCheck, IconChevronDown, IconPlus } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  lastAnsweredThread,
  useT3AgentRequestsContext,
  useT3Threads,
  type T3AgentKind,
} from "@/hooks/use-t3-agents";

import { agentMentionMedia } from "./CommentIdentity";

const NEW_THREAD = "__new__";

export interface T3ThreadChoice {
  threadId: string | null;
  title: string | null;
}

export function T3ThreadPicker({
  mention,
  threadTitle,
  onChange,
  onClose,
}: {
  mention: CommentAgentMention;
  threadTitle: string | null;
  onChange: (choice: T3ThreadChoice) => void;
  onClose: () => void;
}) {
  const t = useT();
  const agent = mention.model as T3AgentKind;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const { requests } = useT3AgentRequestsContext();
  const last = lastAnsweredThread(requests, agent);
  const threads = useT3Threads(agent, query, open);
  const listed = (threads.data?.threads ?? []).filter(
    (thread) => thread.threadId !== last?.threadId,
  );
  const selected = mention.thread ?? NEW_THREAD;
  const currentLabel = mention.thread
    ? (threadTitle ??
      (mention.thread === last?.threadId ? last.title : null) ??
      t("comments.t3PickedThread"))
    : t("comments.t3NewThread");
  const media = agentMentionMedia(mention.model, mention.engine, null);

  const pick = (choice: T3ThreadChoice) => {
    onChange(choice);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setHighlighted(selected);
        else setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-t3-thread-picker
          aria-label={t("comments.t3PickThread", { agent: mention.name })}
          onMouseDown={(event) => event.preventDefault()}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/70 px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {media.type === "image" ? (
            <img src={media.src} alt="" className="size-3.5 shrink-0" />
          ) : null}
          <span className="shrink-0 font-medium text-foreground">
            {mention.name}
          </span>
          <span aria-hidden>·</span>
          <span className="min-w-0 truncate">{currentLabel}</span>
          <IconChevronDown size={12} className="shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 p-0"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onClose();
        }}
      >
        <Command
          shouldFilter={false}
          value={highlighted}
          onValueChange={setHighlighted}
        >
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder={t("comments.t3SearchThreads", { agent: mention.name })}
            aria-label={t("comments.t3SearchThreads", { agent: mention.name })}
          />
          <CommandList className="max-h-72">
            {!search.trim() ? (
              <CommandGroup>
                {last ? (
                  <CommandItem
                    value={last.threadId}
                    onSelect={() => pick(last)}
                    className="gap-2"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">
                        {last.title ?? t("comments.t3PickedThread")}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {t("comments.t3LastAnsweredHere")}
                      </span>
                    </span>
                    {selected === last.threadId ? (
                      <IconCheck size={14} className="shrink-0" />
                    ) : null}
                  </CommandItem>
                ) : null}
                <CommandItem
                  value={NEW_THREAD}
                  onSelect={() => pick({ threadId: null, title: null })}
                  className="gap-2"
                >
                  <IconPlus size={14} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {t("comments.t3NewThread")}
                  </span>
                  {selected === NEW_THREAD ? (
                    <IconCheck size={14} className="shrink-0" />
                  ) : null}
                </CommandItem>
              </CommandGroup>
            ) : null}
            {threads.isError ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                {t("comments.t3ThreadsLoadFailed")}
              </p>
            ) : threads.isSuccess && listed.length === 0 && search.trim() ? (
              <CommandEmpty>{t("comments.t3NoThreads")}</CommandEmpty>
            ) : null}
            {listed.length ? (
              <CommandGroup
                heading={
                  search.trim() ? undefined : t("comments.t3OtherThreads")
                }
              >
                {listed.map((thread) => (
                  <CommandItem
                    key={thread.threadId}
                    value={thread.threadId}
                    onSelect={() =>
                      pick({ threadId: thread.threadId, title: thread.title })
                    }
                    className="gap-2"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {thread.title}
                    </span>
                    {selected === thread.threadId ? (
                      <IconCheck size={14} className="shrink-0" />
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
