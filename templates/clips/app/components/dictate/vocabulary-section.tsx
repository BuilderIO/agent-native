import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconBook2,
  IconDownload,
  IconPencilCheck,
  IconPlus,
  IconSearch,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface VocabularyEntry {
  id: string;
  term: string;
  replacement: string;
  confidence: number;
  usesCount: number;
}

export interface VocabularyDraft {
  term: string;
  replacement: string;
}

export const MAX_VOCABULARY_IMPORT = 100;
const VOCABULARY_IMPORT_BATCH_SIZE = 5;

const QUERY_KEY = ["action", "list-vocabulary", {}] as const;

export function parseVocabularyEntries(value: string): VocabularyDraft[] {
  const entries = new Map<string, VocabularyDraft>();
  const separators = ["→", "=>", "->", "\t"];
  const lines = value.split(/\r?\n/);
  const firstContentLine = lines.find((line) => line.trim())?.trim();
  const delimiter = firstContentLine?.includes("\t") ? "\t" : ",";
  const fileHeader = firstContentLine
    ? parseDelimitedRow(firstContentLine, delimiter).map((cell) =>
        cell.toLocaleLowerCase(),
      )
    : [];
  const isDelimitedFile =
    fileHeader[0] === "term" &&
    (fileHeader.length === 1 || fileHeader[1] === "replacement");

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (isDelimitedFile) {
      if (line === firstContentLine) continue;
      const [csvTerm = "", csvReplacement = ""] = parseDelimitedRow(
        line,
        delimiter,
      );
      const term = csvTerm.trim();
      const replacement = csvReplacement.trim() || term;
      if (!term) continue;
      entries.set(term.toLocaleLowerCase(), { term, replacement });
      if (entries.size === MAX_VOCABULARY_IMPORT) break;
      continue;
    }
    if (separators.some((separator) => line.startsWith(separator))) continue;

    let term = line;
    let replacement = line;
    for (const separator of separators) {
      const separatorIndex = line.indexOf(separator);
      if (separatorIndex < 1) continue;
      term = line.slice(0, separatorIndex).trim();
      replacement = line.slice(separatorIndex + separator.length).trim();
      break;
    }

    if (!term || !replacement) continue;
    entries.set(term.toLocaleLowerCase(), { term, replacement });
    if (entries.size === MAX_VOCABULARY_IMPORT) break;
  }

  return Array.from(entries.values());
}

function parseDelimitedRow(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += character;
    }
  }

  cells.push(cell);
  return cells;
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function serializeVocabularyEntries(entries: VocabularyDraft[]): string {
  return [
    "term,replacement",
    ...entries.map(
      (entry) => `${csvCell(entry.term)},${csvCell(entry.replacement)}`,
    ),
  ].join("\n");
}

export async function addVocabularyEntries(
  entries: VocabularyDraft[],
  addEntry: (entry: VocabularyDraft) => Promise<unknown>,
): Promise<number> {
  let failedCount = 0;

  for (
    let start = 0;
    start < entries.length;
    start += VOCABULARY_IMPORT_BATCH_SIZE
  ) {
    const batch = entries.slice(start, start + VOCABULARY_IMPORT_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(addEntry));
    failedCount += results.filter(
      (result) => result.status === "rejected",
    ).length;
  }

  return failedCount;
}

export function VocabularyManager() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [removeCandidate, setRemoveCandidate] =
    useState<VocabularyEntry | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useActionQuery<{
    vocabulary: VocabularyEntry[];
  }>("list-vocabulary", {}, { enabled: open });
  const entries = data?.vocabulary ?? [];

  const visibleEntries = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    if (!normalizedSearch) return entries;
    return entries.filter(
      (entry) =>
        entry.term.toLocaleLowerCase().includes(normalizedSearch) ||
        entry.replacement.toLocaleLowerCase().includes(normalizedSearch),
    );
  }, [entries, search]);

  const addTerm = useActionMutation("add-vocabulary-term");
  const removeTerm = useActionMutation<unknown, { id: string }>(
    "remove-vocabulary-term",
    {
      method: "DELETE",
      onMutate: async (variables) => {
        await queryClient.cancelQueries({ queryKey: QUERY_KEY });
        const previous = queryClient.getQueryData(QUERY_KEY);
        queryClient.setQueryData(
          QUERY_KEY,
          (current: { vocabulary: VocabularyEntry[] } | undefined) =>
            current
              ? {
                  vocabulary: current.vocabulary.filter(
                    (entry) => entry.id !== variables.id,
                  ),
                }
              : current,
        );
        return { previous };
      },
      onError: (_error, _variables, context: any) => {
        if (context?.previous) {
          queryClient.setQueryData(QUERY_KEY, context.previous);
        }
        toast.error(t("dictateRoute.vocabularyRemoveFailed"));
      },
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      },
    },
  );

  const parsedDraft = useMemo(() => parseVocabularyEntries(draft), [draft]);
  const draftIsInvalid = submitted && parsedDraft.length === 0;

  async function handleAddTerms(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (parsedDraft.length === 0) {
      textareaRef.current?.focus();
      return;
    }

    setIsAdding(true);
    const failedCount = await addVocabularyEntries(parsedDraft, (entry) =>
      addTerm.mutateAsync({ ...entry, confidence: 1 }),
    );
    setIsAdding(false);

    if (failedCount > 0) {
      toast.error(t("dictateRoute.vocabularyAddFailed"));
    }
    if (failedCount === parsedDraft.length) return;

    setDraft("");
    setSubmitted(false);
    setAdding(false);
    void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  }

  function resetAddTerms() {
    setAdding(false);
    setDraft("");
    setSubmitted(false);
  }

  async function handleImportFile(file: File | undefined) {
    if (!file) return;
    try {
      const fileContents = await file.text();
      if (parseVocabularyEntries(fileContents).length === 0) {
        throw new Error("No vocabulary entries found");
      }
      setDraft(fileContents);
      setSubmitted(false);
      setAdding(true);
    } catch {
      toast.error(t("dictateRoute.dictionaryImportFailed"));
    }
  }

  function handleExport() {
    const csv = serializeVocabularyEntries(entries);
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "clips-dictionary.csv";
    link.click();
    URL.revokeObjectURL(url);
    toast.success(t("dictateRoute.dictionaryExported"));
  }

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            resetAddTerms();
            setSearch("");
            setRemoveCandidate(null);
          }
        }}
      >
        <SheetTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="ms-auto shrink-0"
            aria-label={t("dictateRoute.dictionaryTitle")}
          >
            <IconBook2 />
            <span className="hidden sm:inline">
              {t("dictateRoute.dictionaryTitle")}
            </span>
          </Button>
        </SheetTrigger>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
          onInteractOutside={(event) => {
            if (removeCandidate) event.preventDefault();
          }}
        >
          <SheetHeader className="border-b border-border px-4 py-3 text-start">
            <SheetTitle>{t("dictateRoute.dictionaryTitle")}</SheetTitle>
            <SheetDescription className="sr-only">
              {t("dictateRoute.dictionaryDescription")}
            </SheetDescription>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <Item variant="muted" size="sm">
              <ItemMedia variant="icon">
                <IconPencilCheck />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{t("dictateRoute.dictionaryAutoLearn")}</ItemTitle>
              </ItemContent>
            </Item>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
              hidden
              onChange={(event) => {
                void handleImportFile(event.currentTarget.files?.[0]);
                event.currentTarget.value = "";
              }}
            />

            {adding ? (
              <form
                onSubmit={handleAddTerms}
                className="rounded-lg border border-border p-3"
              >
                <Label htmlFor="vocabulary-terms">
                  {t("dictateRoute.dictionaryAddTerms")}
                </Label>
                <Textarea
                  ref={textareaRef}
                  id="vocabulary-terms"
                  autoFocus
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    if (submitted) setSubmitted(false);
                  }}
                  placeholder={t("dictateRoute.dictionaryTermsPlaceholder")}
                  aria-invalid={draftIsInvalid || undefined}
                  aria-describedby={
                    draftIsInvalid ? "vocabulary-terms-error" : undefined
                  }
                  className="mt-2 min-h-32 resize-y text-base sm:text-sm"
                />
                {draftIsInvalid ? (
                  <p
                    id="vocabulary-terms-error"
                    className="mt-1.5 text-xs text-destructive"
                  >
                    {t("dictateRoute.dictionaryTermsRequired")}
                  </p>
                ) : null}
                <div className="mt-3 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isAdding}
                    onClick={resetAddTerms}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button type="submit" size="sm" disabled={isAdding}>
                    {isAdding ? <Spinner /> : <IconPlus />}
                    {t("dictateRoute.dictionaryAddTerms")}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="flex flex-col gap-2">
                <ButtonGroup className="w-full">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setAdding(true)}
                  >
                    <IconPlus />
                    {t("dictateRoute.dictionaryAddTerms")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <IconUpload />
                    {t("dictateRoute.dictionaryImport")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    disabled={entries.length === 0}
                    onClick={handleExport}
                  >
                    <IconDownload />
                    {t("dictateRoute.dictionaryExport")}
                  </Button>
                </ButtonGroup>

                {entries.length > 0 ? (
                  <div className="relative min-w-0 flex-1">
                    <Label htmlFor="vocabulary-search" className="sr-only">
                      {t("dictateRoute.dictionarySearch")}
                    </Label>
                    <IconSearch className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="vocabulary-search"
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder={t("dictateRoute.dictionarySearch")}
                      className="h-9 ps-9 text-base sm:text-sm"
                    />
                  </div>
                ) : null}
              </div>
            )}

            {adding ? null : isLoading ? (
              <div className="flex flex-col gap-2" aria-busy="true">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-14 w-full" />
                ))}
              </div>
            ) : entries.length === 0 ? (
              <Empty className="min-h-64 flex-1">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <IconBook2 />
                  </EmptyMedia>
                  <EmptyTitle>{t("dictateRoute.dictionaryEmpty")}</EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : visibleEntries.length === 0 ? (
              <Empty className="min-h-48 flex-1">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <IconSearch />
                  </EmptyMedia>
                  <EmptyTitle>
                    {t("dictateRoute.dictionaryNoMatches")}
                  </EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : (
              <ItemGroup className="overflow-hidden rounded-lg border border-border">
                {visibleEntries.map((entry, index) => (
                  <div key={entry.id}>
                    {index > 0 ? <ItemSeparator /> : null}
                    <Item size="sm" className="rounded-none">
                      <ItemContent className="min-w-0">
                        <ItemTitle className="min-w-0 max-w-full">
                          <span className="truncate">{entry.term}</span>
                          {entry.replacement !== entry.term ? (
                            <>
                              <span className="shrink-0 text-muted-foreground">
                                →
                              </span>
                              <span className="truncate">
                                {entry.replacement}
                              </span>
                            </>
                          ) : null}
                        </ItemTitle>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {t("dictateRoute.dictionaryUsesCount", {
                            count: entry.usesCount,
                          })}
                        </span>
                      </ItemContent>
                      <ItemActions>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-8 text-muted-foreground hover:text-destructive"
                              aria-label={t("dictateRoute.dictionaryRemove")}
                              onClick={() => setRemoveCandidate(entry)}
                            >
                              <IconTrash />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t("dictateRoute.dictionaryRemove")}
                          </TooltipContent>
                        </Tooltip>
                      </ItemActions>
                    </Item>
                  </div>
                ))}
              </ItemGroup>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={removeCandidate !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setRemoveCandidate(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("dictateRoute.dictionaryRemoveTitle", {
                term: removeCandidate?.replacement ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("dictateRoute.dictionaryRemoveDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeTerm.isPending}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={removeTerm.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                if (!removeCandidate) return;
                removeTerm.mutate(
                  { id: removeCandidate.id },
                  {
                    onSuccess: () => setRemoveCandidate(null),
                  },
                );
              }}
            >
              {t("dictateRoute.dictionaryRemove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
