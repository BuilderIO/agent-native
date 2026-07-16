import {
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
import {
  IconBook2,
  IconChevronDown,
  IconChevronRight,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";

interface VocabularyEntry {
  id: string;
  term: string;
  replacement: string;
  confidence: number;
  usesCount: number;
}

const QUERY_KEY = ["action", "list-vocabulary", {}] as const;

/**
 * Dictionary section for the /dictate page. Lists learned personal-vocabulary
 * entries (auto-learned from post-paste corrections, see
 * `personal-vocabulary.ts` on desktop) and lets the user manually add or
 * remove terms. Biases speech recognition toward preferred spellings —
 * explained in one line, not a full settings page.
 */
export function VocabularySection() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [replacement, setReplacement] = useState("");
  const queryClient = useQueryClient();

  const { data, isLoading } = useActionQuery<{
    vocabulary: VocabularyEntry[];
  }>("list-vocabulary", {}, { enabled: open });

  const entries = data?.vocabulary ?? [];

  const addTerm = useActionMutation("add-vocabulary-term", {
    onSuccess: () => {
      setTerm("");
      setReplacement("");
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: () => {
      toast.error(t("dictateRoute.vocabularyAddFailed"));
    },
  });

  const removeTerm = useActionMutation<unknown, { id: string }>(
    "remove-vocabulary-term",
    {
      method: "DELETE",
      onMutate: async (vars) => {
        await queryClient.cancelQueries({ queryKey: QUERY_KEY });
        const prev = queryClient.getQueryData(QUERY_KEY);
        queryClient.setQueryData(
          QUERY_KEY,
          (old: { vocabulary: VocabularyEntry[] } | undefined) =>
            old
              ? {
                  vocabulary: old.vocabulary.filter((v) => v.id !== vars.id),
                }
              : old,
        );
        return { prev };
      },
      onError: (_err, _vars, ctx: any) => {
        if (ctx?.prev) queryClient.setQueryData(QUERY_KEY, ctx.prev);
        toast.error(t("dictateRoute.vocabularyRemoveFailed"));
      },
    },
  );

  function handleAdd() {
    const trimmedTerm = term.trim();
    const trimmedReplacement = replacement.trim() || trimmedTerm;
    if (!trimmedTerm || addTerm.isPending) return;
    addTerm.mutate({
      term: trimmedTerm,
      replacement: trimmedReplacement,
      confidence: 1,
    });
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="mb-6 rounded-lg border border-border bg-accent/20"
    >
      <CollapsibleTrigger className="w-full flex items-center justify-between px-4 py-3 cursor-pointer">
        <div className="flex items-center gap-2">
          <IconBook2 className="h-4 w-4 text-foreground" />
          <span className="text-sm font-medium">
            {t("dictateRoute.dictionaryTitle")}
          </span>
        </div>
        {open ? (
          <IconChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <IconChevronRight className="h-4 w-4 text-muted-foreground rtl:-scale-x-100" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-4 pb-4">
          <p className="mb-3 text-xs text-muted-foreground leading-relaxed">
            {t("dictateRoute.dictionaryDescription")}
          </p>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder={t("dictateRoute.dictionaryTermPlaceholder")}
              className="h-8 w-40 text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
            />
            <Input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder={t("dictateRoute.dictionaryReplacementPlaceholder")}
              className="h-8 w-48 text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-8 gap-1.5"
              disabled={!term.trim() || addTerm.isPending}
              onClick={handleAdd}
            >
              <IconPlus className="h-3.5 w-3.5" />
              {t("dictateRoute.dictionaryAdd")}
            </Button>
          </div>

          {isLoading ? (
            <div className="text-xs text-muted-foreground">
              {t("dictateRoute.dictionaryLoading")}
            </div>
          ) : entries.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-background px-3 py-4 text-center text-xs text-muted-foreground">
              {t("dictateRoute.dictionaryEmpty")}
            </div>
          ) : (
            <div className="rounded-md border border-border bg-background overflow-hidden">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                      <span className="truncate">{entry.term}</span>
                      {entry.replacement !== entry.term ? (
                        <>
                          <span className="text-muted-foreground">→</span>
                          <span className="truncate">{entry.replacement}</span>
                        </>
                      ) : null}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {t("dictateRoute.dictionaryUsesCount", {
                        count: entry.usesCount,
                      })}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 cursor-pointer text-muted-foreground hover:text-destructive"
                    aria-label={t("dictateRoute.dictionaryRemove")}
                    title={t("dictateRoute.dictionaryRemove")}
                    onClick={() => removeTerm.mutate({ id: entry.id })}
                  >
                    <IconTrash className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
