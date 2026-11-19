import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT, useFormatters } from "@agent-native/core/client/i18n";
import {
  IconArrowRight,
  IconCheck,
  IconEdit,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";

import { LoadingRows, PageHeader } from "@/components/brain/Surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import type { IntelligenceItem } from "../../shared/intelligence";

interface Recipe {
  id: string;
  title: string;
  prompt: string;
  sourceIds: string[];
  projectId: string | null;
  updatedAt: string;
}
interface PersonalMemory {
  id: string;
  content: string;
  updatedAt: string;
}
const tabs = ["actions", "brief", "entities", "recipes", "memory"] as const;
type Tab = (typeof tabs)[number];

function dispatch(message: string, context?: string) {
  sendToAgentChat({
    message,
    ...(context ? { context } : {}),
    submit: true,
    newTab: true,
    openSidebar: true,
  });
}

function Failure({ error }: { error: unknown }) {
  const t = useT();
  return (
    <p
      role="alert"
      className="rounded-md border border-destructive p-4 text-sm text-destructive"
    >
      {actionErrorMessage(error) ?? t("intelligence.failed")}
    </p>
  );
}

function Evidence({ evidence }: { evidence: IntelligenceItem["evidence"] }) {
  const t = useT();
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-muted-foreground">
        {t("intelligence.evidence", { count: evidence.length })}
      </summary>
      <ul className="mt-2 space-y-3">
        {evidence.map((item, index) => (
          <li
            key={`${item.captureId}-${index}`}
            className="border-s border-border ps-3"
          >
            {item.sourceUrl && /^https?:\/\//.test(item.sourceUrl) ? (
              <a
                className="text-primary underline-offset-4 hover:underline"
                href={item.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                {item.captureTitle}
              </a>
            ) : (
              <Link
                className="text-primary underline-offset-4 hover:underline"
                to={`/search?captureId=${encodeURIComponent(item.captureId)}`}
              >
                {item.captureTitle}
              </Link>
            )}
            <blockquote className="mt-1 whitespace-pre-wrap text-muted-foreground">
              {item.quote}
            </blockquote>
          </li>
        ))}
      </ul>
    </details>
  );
}

function IntelligenceRow({ item }: { item: IntelligenceItem }) {
  const t = useT();
  const format = useFormatters();
  const write = useActionMutation("write-intelligence");
  const verify = useActionMutation("verify-knowledge");
  return (
    <li className="border-b border-border py-5 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium break-words">{item.title}</h3>
            <Badge variant="outline">
              {t(`intelligence.kind.${item.kind}`)}
            </Badge>
            {item.status !== "open" && (
              <Badge variant="secondary">
                {t(`intelligence.status.${item.status}`)}
              </Badge>
            )}
            {item.verification.state !== "unverified" && (
              <Badge variant="outline">
                {t(`intelligence.verification.${item.verification.state}`)}
              </Badge>
            )}
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
            {item.body}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {item.owner ?? t("intelligence.unassigned")}
            {item.dueDate
              ? ` · ${format.formatDate(new Date(`${item.dueDate}T12:00:00`), { dateStyle: "medium" })}`
              : ""}
          </p>
          {item.verification.state === "verified" &&
            item.verification.verifiedBy && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("intelligence.verifiedBy", {
                  name: item.verification.verifiedBy,
                })}
                {item.verification.verifiedAt
                  ? ` · ${format.formatDate(item.verification.verifiedAt, { dateStyle: "medium" })}`
                  : ""}
              </p>
            )}
        </div>
        <div className="flex flex-wrap gap-2">
          {item.kind === "action" && item.status === "open" && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  dispatch(
                    [item.title, item.body].filter(Boolean).join("\n\n"),
                    JSON.stringify({
                      instructions: t("intelligence.startPrompt"),
                      intelligenceId: item.id,
                      title: item.title,
                    }),
                  )
                }
              >
                {t("intelligence.start")}
                <IconArrowRight className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={write.isPending}
                onClick={() =>
                  write.mutate({
                    ...item,
                    status: "completed",
                    expectedRevision: item.revision,
                    owner: item.owner ?? undefined,
                    dueDate: item.dueDate ?? undefined,
                  })
                }
              >
                <IconCheck className="size-4" />
                {t("intelligence.complete")}
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              dispatch(
                t("intelligence.edit"),
                JSON.stringify({
                  instructions: t("intelligence.editPrompt"),
                  intelligenceId: item.id,
                }),
              )
            }
          >
            {t("intelligence.edit")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={write.isPending}
            onClick={() =>
              write.mutate({
                ...item,
                expectedRevision: item.revision,
                status: item.status === "open" ? "dismissed" : "open",
                owner: item.owner ?? undefined,
                dueDate: item.dueDate ?? undefined,
              })
            }
          >
            {t(
              item.status === "open"
                ? "intelligence.dismiss"
                : "intelligence.reopen",
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={verify.isPending}
            onClick={() =>
              verify.mutate({
                knowledgeId: item.id,
                state: "deprecated",
                attested: true,
                expectedRevision: item.revision,
              })
            }
          >
            {t("intelligence.deprecate")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={verify.isPending}
            onClick={() =>
              verify.mutate({
                knowledgeId: item.id,
                state:
                  item.verification.state === "verified"
                    ? "unverified"
                    : "verified",
                attested: true,
                expectedRevision: item.revision,
              })
            }
          >
            {t(
              item.verification.state === "verified"
                ? "intelligence.unverify"
                : "intelligence.verify",
            )}
          </Button>
        </div>
      </div>
      <Evidence evidence={item.evidence} />
      {write.isError && <Failure error={write.error} />}
      {verify.isError && <Failure error={verify.error} />}
    </li>
  );
}

function ActionItems() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const status =
    params.get("status") === "completed"
      ? "completed"
      : params.get("status") === "dismissed"
        ? "dismissed"
        : "open";
  const rows = useActionQuery("list-intelligence", {
    id: params.get("intelligenceId") ?? undefined,
    query: query || undefined,
    status: params.get("intelligenceId") ? undefined : status,
    limit: 50,
  });
  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next, { replace: true });
  }
  return (
    <div>
      <div className="flex flex-wrap gap-3">
        <Input
          aria-label={t("intelligence.search")}
          placeholder={t("intelligence.search")}
          className="min-w-40 flex-1"
          value={query}
          onChange={(event) => update("q", event.target.value)}
        />
        <Select
          value={status}
          onValueChange={(value) => update("status", value)}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">
              {t("intelligence.status.open")}
            </SelectItem>
            <SelectItem value="completed">
              {t("intelligence.status.completed")}
            </SelectItem>
            <SelectItem value="dismissed">
              {t("intelligence.status.dismissed")}
            </SelectItem>
          </SelectContent>
        </Select>
        <Button
          onClick={() =>
            dispatch(
              t("intelligence.extract"),
              JSON.stringify({ instructions: t("intelligence.extractPrompt") }),
            )
          }
        >
          {t("intelligence.extract")}
        </Button>
      </div>
      {rows.isLoading ? (
        <LoadingRows />
      ) : rows.isError ? (
        <Failure error={rows.error} />
      ) : rows.data?.records.length ? (
        <ul>
          {rows.data.records.map((item: IntelligenceItem) => (
            <IntelligenceRow key={item.id} item={item} />
          ))}
        </ul>
      ) : (
        <p className="py-10 text-sm text-muted-foreground">
          {t("intelligence.emptyActions")}
        </p>
      )}
      {rows.data?.hasMore && (
        <p className="py-3 text-sm text-muted-foreground">
          {t("intelligence.narrowSearch")}
        </p>
      )}
    </div>
  );
}

function Priorities() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const period = params.get("period") === "weekly" ? "weekly" : "daily";
  const owner = params.get("owner") ?? "";
  const data = useActionQuery("read-priorities", {
    period,
    owner: owner || undefined,
    limit: 50,
  });
  return (
    <div>
      <div className="flex flex-wrap justify-between gap-3">
        <Select
          value={period}
          onValueChange={(value) => {
            const next = new URLSearchParams(params);
            next.set("period", value);
            setParams(next, { replace: true });
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="daily">{t("intelligence.daily")}</SelectItem>
            <SelectItem value="weekly">{t("intelligence.weekly")}</SelectItem>
          </SelectContent>
        </Select>
        <Input
          className="min-w-40 flex-1"
          aria-label={t("intelligence.ownerFilter")}
          placeholder={t("intelligence.ownerFilter")}
          value={owner}
          onChange={(event) => {
            const next = new URLSearchParams(params);
            next.set("owner", event.target.value);
            setParams(next, { replace: true });
          }}
        />
        <Button
          variant="outline"
          onClick={() =>
            dispatch(
              t("intelligence.generateBrief"),
              JSON.stringify({
                instructions: t("intelligence.briefPrompt", { period }),
                owner: owner || undefined,
              }),
            )
          }
        >
          {t("intelligence.generateBrief")}
        </Button>
      </div>
      {data.isLoading ? (
        <LoadingRows />
      ) : data.isError ? (
        <Failure error={data.error} />
      ) : data.data ? (
        <div className="divide-y divide-border">
          {(
            [
              "highConfidence",
              "ambiguous",
              "decisions",
              "customerRequests",
            ] as const
          ).map((group) => (
            <section className="py-5" key={group}>
              <h2 className="text-lg font-medium">
                {t(`intelligence.${group}`)}
              </h2>
              {data.data[group].length ? (
                <ul>
                  {data.data[group].map((item: IntelligenceItem) => (
                    <IntelligenceRow key={item.id} item={item} />
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  {t("intelligence.noItems")}
                </p>
              )}
            </section>
          ))}
        </div>
      ) : null}
      {data.data?.hasMore && (
        <p className="py-3 text-sm text-muted-foreground">
          {t("intelligence.narrowSearch")}
        </p>
      )}
    </div>
  );
}

function Entities() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const data = useActionQuery("get-entity-graph", {
    query: query || undefined,
    limit: 50,
  });
  return (
    <div>
      <Input
        aria-label={t("intelligence.searchEntities")}
        placeholder={t("intelligence.searchEntities")}
        value={query}
        onChange={(event) => {
          const next = new URLSearchParams(params);
          next.set("q", event.target.value);
          setParams(next, { replace: true });
        }}
      />
      {data.isLoading ? (
        <LoadingRows />
      ) : data.isError ? (
        <Failure error={data.error} />
      ) : data.data?.entities.length ? (
        <ul className="divide-y divide-border">
          {data.data.entities.map((entity) => (
            <li key={entity.id} className="py-5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-medium">{entity.name}</h2>
                <Badge variant="outline">{entity.type}</Badge>
              </div>
              <Evidence evidence={entity.evidence} />
              <ul className="mt-3 space-y-2">
                {data.data.edges
                  .filter((edge) => edge.source === entity.id)
                  .map((edge) => (
                    <li key={edge.id}>
                      <Link
                        className="text-sm text-primary hover:underline"
                        to={
                          edge.structured
                            ? `/intelligence?tab=actions&intelligenceId=${encodeURIComponent(edge.knowledgeId)}`
                            : `/knowledge?q=${encodeURIComponent(edge.title)}`
                        }
                      >
                        {t(
                          edge.relation === "owns"
                            ? "intelligence.owns"
                            : "intelligence.mentionedIn",
                        )}{" "}
                        {edge.title}
                      </Link>
                    </li>
                  ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-10 text-sm text-muted-foreground">
          {t("intelligence.emptyEntities")}
        </p>
      )}
      {data.data?.hasMore && (
        <p className="py-3 text-sm text-muted-foreground">
          {t("intelligence.narrowSearch")}
        </p>
      )}
    </div>
  );
}

function Memory() {
  const t = useT();
  const data = useActionQuery("list-personal-memory", {});
  const write = useActionMutation("manage-personal-memory");
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string>();
  const [expectedRevision, setExpectedRevision] = useState<string>();
  function edit(memory: PersonalMemory) {
    setEditingId(memory.id);
    setExpectedRevision(memory.updatedAt);
    setDraft(memory.content);
  }
  return (
    <div className="max-w-3xl">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          write.mutate(
            {
              operation: "save",
              id: editingId,
              expectedRevision,
              content: draft,
            },
            {
              onSuccess: () => {
                setDraft("");
                setEditingId(undefined);
              },
            },
          );
        }}
      >
        <Label htmlFor="personal-memory">{t("intelligence.memoryLabel")}</Label>
        <Textarea
          id="personal-memory"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={2000}
          required
          placeholder={t("intelligence.memoryPlaceholder")}
        />
        <div className="flex gap-2">
          <Button disabled={write.isPending || !draft.trim()} type="submit">
            <IconPlus className="size-4" />
            {t(editingId ? "intelligence.save" : "intelligence.addMemory")}
          </Button>
          {editingId && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setEditingId(undefined);
                setDraft("");
              }}
            >
              {t("intelligence.cancel")}
            </Button>
          )}
        </div>
      </form>
      {write.isError && <Failure error={write.error} />}
      {data.isLoading ? (
        <LoadingRows />
      ) : data.isError ? (
        <Failure error={data.error} />
      ) : data.data?.memories.length ? (
        <ul className="mt-5 divide-y divide-border">
          {data.data.memories.map((memory: PersonalMemory) => (
            <li key={memory.id} className="flex items-start gap-3 py-4">
              <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm">
                {memory.content}
              </p>
              <Button
                aria-label={t("intelligence.edit")}
                size="icon"
                variant="ghost"
                onClick={() => edit(memory)}
              >
                <IconEdit className="size-4" />
              </Button>
              <Button
                aria-label={t("intelligence.delete")}
                size="icon"
                variant="ghost"
                disabled={write.isPending}
                onClick={() =>
                  write.mutate({
                    operation: "delete",
                    id: memory.id,
                    expectedRevision: memory.updatedAt,
                  })
                }
              >
                <IconTrash className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-10 text-sm text-muted-foreground">
          {t("intelligence.emptyMemory")}
        </p>
      )}
    </div>
  );
}

function Recipes() {
  const t = useT();
  const recipes = useActionQuery("list-recipes", {});
  const sources = useActionQuery("list-sources", {});
  const projects = useActionQuery("list-projects", {});
  const write = useActionMutation("manage-recipe");
  const prepare = useActionMutation("prepare-recipe");
  const [editingId, setEditingId] = useState<string>();
  const [expectedRevision, setExpectedRevision] = useState<string>();
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [projectId, setProjectId] = useState("all");
  const [open, setOpen] = useState(false);
  function reset() {
    setEditingId(undefined);
    setTitle("");
    setPrompt("");
    setSourceIds([]);
    setProjectId("all");
    setOpen(false);
  }
  function edit(recipe: Recipe) {
    setEditingId(recipe.id);
    setExpectedRevision(recipe.updatedAt);
    setTitle(recipe.title);
    setPrompt(recipe.prompt);
    setSourceIds(recipe.sourceIds);
    setProjectId(recipe.projectId ?? "all");
    setOpen(true);
  }
  async function run(recipe: Recipe, schedule: boolean) {
    const result = await prepare.mutateAsync({ id: recipe.id });
    dispatch(
      t(schedule ? "intelligence.schedule" : "intelligence.run"),
      JSON.stringify({
        instructions: t(
          schedule
            ? "intelligence.schedulePrompt"
            : "intelligence.recipeRunPrompt",
        ),
        recipeId: result.recipe.id,
        scope: result.scope,
      }),
    );
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            reset();
            setOpen(true);
          }}
        >
          <IconPlus className="size-4" />
          {t("intelligence.newRecipe")}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            reset();
            setTitle(t("intelligence.deepResearch"));
            setPrompt(t("intelligence.deepResearchPrompt"));
            setOpen(true);
          }}
        >
          {t("intelligence.deepResearch")}
        </Button>
      </div>
      {open && (
        <form
          className="my-5 max-w-3xl space-y-4 rounded-md border border-border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            write.mutate(
              {
                operation: "save",
                id: editingId,
                expectedRevision,
                title,
                prompt,
                sourceIds,
                projectId: projectId === "all" ? null : projectId,
              },
              { onSuccess: reset },
            );
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="recipe-title">
              {t("intelligence.recipeTitle")}
            </Label>
            <Input
              id="recipe-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              maxLength={120}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="recipe-prompt">
              {t("intelligence.recipePrompt")}
            </Label>
            <Textarea
              id="recipe-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              required
              maxLength={6000}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="recipe-project">{t("intelligence.project")}</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="recipe-project">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("intelligence.allProjects")}
                </SelectItem>
                {projects.data?.projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {sources.isLoading ? (
            <LoadingRows rows={2} />
          ) : sources.isError ? (
            <Failure error={sources.error} />
          ) : (
            <fieldset className="space-y-3">
              <legend className="mb-2 text-sm font-medium">
                {t("intelligence.sources")}
              </legend>
              {sources.data?.sources.map((source) => (
                <label
                  className="flex items-center gap-2 text-sm"
                  key={source.id}
                >
                  <Checkbox
                    checked={sourceIds.includes(source.id)}
                    onCheckedChange={(checked) =>
                      setSourceIds((current) =>
                        checked
                          ? [...current, source.id]
                          : current.filter((id) => id !== source.id),
                      )
                    }
                  />
                  {source.title}
                </label>
              ))}
            </fieldset>
          )}
          <p className="text-sm text-muted-foreground">
            {t("intelligence.sourceScopeHint")}
          </p>
          {projects.isError && <Failure error={projects.error} />}
          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={
                write.isPending ||
                !title.trim() ||
                !prompt.trim() ||
                sources.isError ||
                projects.isError
              }
            >
              {t("intelligence.save")}
            </Button>
            <Button type="button" variant="ghost" onClick={reset}>
              {t("intelligence.cancel")}
            </Button>
          </div>
        </form>
      )}
      {write.isError && <Failure error={write.error} />}
      {prepare.isError && <Failure error={prepare.error} />}
      {recipes.isLoading ? (
        <LoadingRows />
      ) : recipes.isError ? (
        <Failure error={recipes.error} />
      ) : recipes.data?.recipes.length ? (
        <ul className="mt-4 divide-y divide-border">
          {recipes.data.recipes.map((recipe: Recipe) => (
            <li key={recipe.id} className="py-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="font-medium">{recipe.title}</h2>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                    {recipe.prompt}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={prepare.isPending}
                    onClick={() => void run(recipe, false)}
                  >
                    {t("intelligence.run")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={prepare.isPending}
                    onClick={() => void run(recipe, true)}
                  >
                    {t("intelligence.schedule")}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("intelligence.edit")}
                    onClick={() => edit(recipe)}
                  >
                    <IconEdit className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("intelligence.delete")}
                    disabled={write.isPending}
                    onClick={() =>
                      write.mutate({
                        operation: "delete",
                        id: recipe.id,
                        expectedRevision: recipe.updatedAt,
                      })
                    }
                  >
                    <IconTrash className="size-4" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-10 text-sm text-muted-foreground">
          {t("intelligence.emptyRecipes")}
        </p>
      )}
    </div>
  );
}

export default function IntelligenceRoute() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const tab = tabs.find((item) => item === params.get("tab")) ?? "actions";
  return (
    <div className="min-h-full bg-background">
      <PageHeader title={t("intelligence.title")} />
      <div className="p-4 sm:p-5 lg:p-7">
        <Tabs
          value={tab}
          onValueChange={(value) => {
            const next = new URLSearchParams();
            next.set("tab", value);
            setParams(next);
          }}
        >
          <TabsList className="mb-6 flex h-auto w-fit max-w-full flex-wrap">
            {tabs.map((item: Tab) => (
              <TabsTrigger key={item} value={item}>
                {t(`intelligence.tabs.${item}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="actions">
            <ActionItems />
          </TabsContent>
          <TabsContent value="brief">
            <Priorities />
          </TabsContent>
          <TabsContent value="entities">
            <Entities />
          </TabsContent>
          <TabsContent value="recipes">
            <Recipes />
          </TabsContent>
          <TabsContent value="memory">
            <Memory />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
