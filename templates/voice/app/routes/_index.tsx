import { useEffect, useMemo, useState } from "react";
import {
  IconBolt,
  IconBook,
  IconChartBar,
  IconCheck,
  IconClock,
  IconDeviceFloppy,
  IconMicrophone,
  IconPencil,
  IconPlayerRecord,
  IconPlus,
} from "@tabler/icons-react";
import {
  agentNativePath,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function meta() {
  return [
    { title: "Agent-Native Voice" },
    {
      name: "description",
      content:
        "Speak to type anywhere with context-aware formatting, snippets, and custom vocabulary.",
    },
  ];
}

type TabId = "dictation" | "snippets" | "dictionary" | "styles";

interface Dictation {
  id: string;
  text: string;
  rawText: string;
  appContext?: string | null;
  style?: string | null;
  language: string;
  durationMs: number;
  createdAt: string;
}

interface Snippet {
  id: string;
  trigger: string;
  expansion: string;
  isTeam?: boolean;
}

interface DictionaryTerm {
  id: string;
  term: string;
  correction?: string | null;
  source: "auto" | "manual";
}

interface StyleSetting {
  id?: string;
  category: string;
  preset: string;
  customPrompt?: string | null;
}

const tabs: Array<{ id: TabId; label: string; icon: typeof IconMicrophone }> = [
  { id: "dictation", label: "Dictation", icon: IconMicrophone },
  { id: "snippets", label: "Snippets", icon: IconPencil },
  { id: "dictionary", label: "Dictionary", icon: IconBook },
  { id: "styles", label: "Styles", icon: IconBolt },
];

const styleLabels: Record<string, string> = {
  personal_messages: "Personal messages",
  work_messages: "Work messages",
  email: "Email",
  other: "Other",
};

async function writeAppState(key: string, value: unknown) {
  await fetch(
    agentNativePath(
      `/_agent-native/application-state/${encodeURIComponent(key)}`,
    ),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
      keepalive: true,
    },
  ).catch(() => {});
}

function formatDuration(ms: number) {
  if (!ms) return "0s";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export default function Index() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>("dictation");
  const [recording, setRecording] = useState(false);
  const [rawText, setRawText] = useState("");
  const [polishedText, setPolishedText] = useState("");
  const [appContext, setAppContext] = useState("Notes app");
  const [style, setStyle] = useState("work_messages");
  const [snippetTrigger, setSnippetTrigger] = useState("@@sig");
  const [snippetExpansion, setSnippetExpansion] = useState(
    "Best regards,\nSteve",
  );
  const [dictionaryTerm, setDictionaryTerm] = useState("Agent Native");
  const [dictionaryCorrection, setDictionaryCorrection] =
    useState("Agent Native");
  const [styleCategory, setStyleCategory] = useState("work_messages");
  const [stylePreset, setStylePreset] = useState("formal");
  const [customPrompt, setCustomPrompt] = useState(
    "Use concise bullets when the content sounds like meeting notes.",
  );

  const dictationsQuery = useActionQuery(
    "list-dictations" as any,
    { limit: 8 } as any,
  );
  const snippetsQuery = useActionQuery("list-snippets" as any, {} as any);
  const dictionaryQuery = useActionQuery("list-dictionary" as any, {} as any);
  const stylesQuery = useActionQuery("get-style-settings" as any, {} as any);
  const statsQuery = useActionQuery(
    "get-dictation-stats" as any,
    { days: 14 } as any,
  );

  const dictations: Dictation[] = useMemo(
    () => ((dictationsQuery.data as any)?.dictations ?? []) as Dictation[],
    [dictationsQuery.data],
  );
  const snippets: Snippet[] = useMemo(
    () => ((snippetsQuery.data as any)?.snippets ?? []) as Snippet[],
    [snippetsQuery.data],
  );
  const dictionary: DictionaryTerm[] = useMemo(
    () => ((dictionaryQuery.data as any)?.terms ?? []) as DictionaryTerm[],
    [dictionaryQuery.data],
  );
  const styles: StyleSetting[] = useMemo(
    () => ((stylesQuery.data as any)?.styles ?? []) as StyleSetting[],
    [stylesQuery.data],
  );
  const stats = useMemo(
    () => (statsQuery.data as any) ?? {},
    [statsQuery.data],
  );

  useEffect(() => {
    void writeAppState("navigation", {
      view: activeTab,
      path: "/",
    });
  }, [activeTab]);

  const invalidateVoiceData = () => {
    void queryClient.invalidateQueries({ queryKey: ["action"] });
  };

  const createDictation = useActionMutation("create-dictation" as any, {
    onSuccess: () => {
      toast.success("Dictation saved");
      setRawText("");
      setPolishedText("");
      invalidateVoiceData();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const createSnippet = useActionMutation("create-snippet" as any, {
    onSuccess: () => {
      toast.success("Snippet added");
      invalidateVoiceData();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const addDictionaryTerm = useActionMutation("add-dictionary-term" as any, {
    onSuccess: () => {
      toast.success("Dictionary term added");
      invalidateVoiceData();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateStyle = useActionMutation("update-style-settings" as any, {
    onSuccess: () => {
      toast.success("Style updated");
      invalidateVoiceData();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const polished = polishedText.trim() || rawText.trim();
  const totalWords = dictations.reduce(
    (sum, item) => sum + item.text.split(/\s+/).filter(Boolean).length,
    0,
  );

  const toggleRecording = () => {
    const next = !recording;
    setRecording(next);
    void writeAppState("dictation-state", {
      status: next ? "recording" : "idle",
      startedAt: next ? new Date().toISOString() : null,
    });
  };

  const saveDictation = () => {
    if (!polished) return;
    createDictation.mutate({
      text: polished,
      rawText: rawText.trim() || polished,
      appContext,
      style,
      language: "en",
      durationMs: Math.max(1200, polished.split(/\s+/).length * 520),
    } as any);
  };

  return (
    <div className="min-h-full bg-background">
      <div className="border-b border-border bg-card/30">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 lg:px-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Voice workspace
              </p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
                Dictation control room
              </h2>
            </div>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <Metric
                icon={IconClock}
                label="Sessions"
                value={String(dictations.length)}
              />
              <Metric
                icon={IconPencil}
                label="Words"
                value={String(totalWords)}
              />
              <Metric
                icon={IconChartBar}
                label="Streak"
                value={`${stats.currentStreak ?? 0}d`}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition",
                    activeTab === tab.id
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-6">
        <section className="min-w-0">
          {activeTab === "dictation" && (
            <Panel title="Capture a local dictation" icon={IconMicrophone}>
              <div className="grid gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleRecording}
                    className={cn(
                      "inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-medium transition",
                      recording
                        ? "bg-red-500 text-white hover:bg-red-400"
                        : "bg-foreground text-background hover:bg-foreground/90",
                    )}
                  >
                    <IconPlayerRecord className="h-4 w-4" />
                    {recording
                      ? "Stop placeholder capture"
                      : "Start placeholder capture"}
                  </button>
                  <span className="text-sm text-muted-foreground">
                    {recording
                      ? "Recording state is visible to the agent."
                      : "No microphone call is made in this local QA flow."}
                  </span>
                </div>
                <Field label="Raw transcript">
                  <textarea
                    value={rawText}
                    onChange={(event) => setRawText(event.target.value)}
                    placeholder="Paste or type a local transcript..."
                    className="min-h-32 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring"
                  />
                </Field>
                <Field label="Polished output">
                  <textarea
                    value={polishedText}
                    onChange={(event) => setPolishedText(event.target.value)}
                    placeholder="Optionally edit the polished text before saving..."
                    className="min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring"
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="App context">
                    <input
                      value={appContext}
                      onChange={(event) => setAppContext(event.target.value)}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                    />
                  </Field>
                  <Field label="Style">
                    <select
                      value={style}
                      onChange={(event) => setStyle(event.target.value)}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                    >
                      {Object.entries(styleLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <button
                  type="button"
                  onClick={saveDictation}
                  disabled={!polished || createDictation.isPending}
                  className="inline-flex h-10 w-fit items-center gap-2 rounded-md bg-foreground px-4 text-sm font-medium text-background transition hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <IconDeviceFloppy className="h-4 w-4" />
                  {createDictation.isPending ? "Saving" : "Save dictation"}
                </button>
              </div>
            </Panel>
          )}

          {activeTab === "snippets" && (
            <Panel title="Create a snippet" icon={IconPencil}>
              <div className="grid gap-4">
                <Field label="Trigger">
                  <input
                    value={snippetTrigger}
                    onChange={(event) => setSnippetTrigger(event.target.value)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </Field>
                <Field label="Expansion">
                  <textarea
                    value={snippetExpansion}
                    onChange={(event) =>
                      setSnippetExpansion(event.target.value)
                    }
                    className="min-h-28 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </Field>
                <button
                  type="button"
                  onClick={() =>
                    createSnippet.mutate({
                      trigger: snippetTrigger,
                      expansion: snippetExpansion,
                      isTeam: false,
                    } as any)
                  }
                  disabled={
                    !snippetTrigger.trim() ||
                    !snippetExpansion.trim() ||
                    createSnippet.isPending
                  }
                  className="inline-flex h-10 w-fit items-center gap-2 rounded-md bg-foreground px-4 text-sm font-medium text-background transition hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <IconPlus className="h-4 w-4" />
                  Add snippet
                </button>
              </div>
            </Panel>
          )}

          {activeTab === "dictionary" && (
            <Panel title="Teach custom vocabulary" icon={IconBook}>
              <div className="grid gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Term">
                    <input
                      value={dictionaryTerm}
                      onChange={(event) =>
                        setDictionaryTerm(event.target.value)
                      }
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                    />
                  </Field>
                  <Field label="Correction">
                    <input
                      value={dictionaryCorrection}
                      onChange={(event) =>
                        setDictionaryCorrection(event.target.value)
                      }
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                    />
                  </Field>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    addDictionaryTerm.mutate({
                      term: dictionaryTerm,
                      correction: dictionaryCorrection,
                    } as any)
                  }
                  disabled={
                    !dictionaryTerm.trim() || addDictionaryTerm.isPending
                  }
                  className="inline-flex h-10 w-fit items-center gap-2 rounded-md bg-foreground px-4 text-sm font-medium text-background transition hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <IconPlus className="h-4 w-4" />
                  Add term
                </button>
              </div>
            </Panel>
          )}

          {activeTab === "styles" && (
            <Panel title="Tune style presets" icon={IconBolt}>
              <div className="grid gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Category">
                    <select
                      value={styleCategory}
                      onChange={(event) => setStyleCategory(event.target.value)}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                    >
                      {Object.entries(styleLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Preset">
                    <select
                      value={stylePreset}
                      onChange={(event) => setStylePreset(event.target.value)}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="formal">Formal</option>
                      <option value="casual">Casual</option>
                      <option value="very_casual">Very casual</option>
                      <option value="excited">Excited</option>
                    </select>
                  </Field>
                </div>
                <Field label="Custom prompt">
                  <textarea
                    value={customPrompt}
                    onChange={(event) => setCustomPrompt(event.target.value)}
                    className="min-h-28 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </Field>
                <button
                  type="button"
                  onClick={() =>
                    updateStyle.mutate({
                      category: styleCategory,
                      preset: stylePreset,
                      customPrompt,
                    } as any)
                  }
                  disabled={updateStyle.isPending}
                  className="inline-flex h-10 w-fit items-center gap-2 rounded-md bg-foreground px-4 text-sm font-medium text-background transition hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <IconCheck className="h-4 w-4" />
                  Update style
                </button>
              </div>
            </Panel>
          )}
        </section>

        <aside className="grid gap-4">
          <Panel title="Recent dictations" icon={IconClock}>
            <div className="grid gap-3">
              {dictations.length ? (
                dictations.map((dictation) => (
                  <div
                    key={dictation.id}
                    className="rounded-md border border-border bg-background/70 p-3"
                  >
                    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span>{formatDate(dictation.createdAt)}</span>
                      <span>{formatDuration(dictation.durationMs)}</span>
                    </div>
                    <p className="mt-2 line-clamp-3 text-sm text-foreground">
                      {dictation.text}
                    </p>
                  </div>
                ))
              ) : (
                <EmptyState text="Saved dictations will appear here." />
              )}
            </div>
          </Panel>

          <Panel title="Library" icon={IconBook}>
            <div className="grid gap-4">
              <SummaryList
                label="Snippets"
                empty="No snippets yet"
                rows={snippets.map((snippet) => ({
                  id: snippet.id,
                  title: snippet.trigger,
                  body: snippet.expansion,
                }))}
              />
              <SummaryList
                label="Dictionary"
                empty="No dictionary terms yet"
                rows={dictionary.map((term) => ({
                  id: term.id,
                  title: term.term,
                  body: term.correction || term.source,
                }))}
              />
              <SummaryList
                label="Styles"
                empty="No style rows yet"
                rows={styles.map((item) => ({
                  id: item.category,
                  title: styleLabels[item.category] ?? item.category,
                  body: `${item.preset}${item.customPrompt ? ` — ${item.customPrompt}` : ""}`,
                }))}
              />
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof IconClock;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-24 rounded-md border border-border bg-background px-3 py-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">
        {value}
      </div>
    </div>
  );
}

function Panel({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof IconClock;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function SummaryList({
  label,
  rows,
  empty,
}: {
  label: string;
  rows: Array<{ id: string; title: string; body: string }>;
  empty: string;
}) {
  return (
    <div>
      <div className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="grid gap-2">
        {rows.length ? (
          rows.slice(0, 3).map((row) => (
            <div
              key={row.id}
              className="rounded-md border border-border bg-background/70 px-3 py-2"
            >
              <div className="truncate text-sm font-medium text-foreground">
                {row.title}
              </div>
              <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {row.body}
              </div>
            </div>
          ))
        ) : (
          <EmptyState text={empty} />
        )}
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
      {text}
    </div>
  );
}
