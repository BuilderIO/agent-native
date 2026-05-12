import { useState, useEffect } from "react";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  IconBrandGithub,
  IconGitCommit,
  IconExternalLink,
  IconAlertTriangle,
  IconRefresh,
  IconSettings,
} from "@tabler/icons-react";
import type { SentryIssue } from "./index";

// ---- Types ------------------------------------------------------------------

interface BlameCommit {
  oid: string;
  abbreviatedOid: string;
  message: string;
  committedDate: string;
  url: string;
  author: { name: string; email: string; avatarUrl?: string };
  associatedPullRequests?: {
    nodes: { number: number; title: string; url: string }[];
  };
}

interface BlameRange {
  startingLine: number;
  endingLine: number;
  age: number;
  commit: BlameCommit;
}

interface BlameResult {
  owner: string;
  repo: string;
  path: string;
  ranges: BlameRange[];
  latestCommit: BlameCommit | null;
  hotRange: BlameRange | null;
  error?: string;
}

interface CodeMapping {
  projectSlug: string;
  repoName: string;
  stackRoot: string;
  sourceRoot: string;
}

// ---- Helpers ----------------------------------------------------------------

function parseCulpritPath(issue: SentryIssue): string {
  // Prefer the explicit filename from metadata
  if (issue.metadata.filename) return issue.metadata.filename;
  // Culprit is usually "path/to/file.ts in functionName"
  const culprit = issue.culprit ?? "";
  const inIdx = culprit.indexOf(" in ");
  return inIdx !== -1 ? culprit.slice(0, inIdx).trim() : culprit.trim();
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function getRepoFromStorage(): string {
  return localStorage.getItem("sentry_github_repo") ?? "";
}
function saveRepoToStorage(repo: string) {
  localStorage.setItem("sentry_github_repo", repo);
}

// ---- Main Component ---------------------------------------------------------

interface GitHubBlamePanelProps {
  issue: SentryIssue;
}

export function GitHubBlamePanel({ issue }: GitHubBlamePanelProps) {
  const filePath = parseCulpritPath(issue);
  const [repo, setRepo] = useState(getRepoFromStorage);
  const [repoInput, setRepoInput] = useState(getRepoFromStorage);
  const [editingRepo, setEditingRepo] = useState(!getRepoFromStorage());
  const [result, setResult] = useState<BlameResult | null>(null);
  const [fetched, setFetched] = useState(false);

  const mutation = useActionMutation("github-blame");

  // Auto-detect repo from Sentry code mappings
  const mappingsQuery = useActionQuery("sentry", { mode: "code-mappings" });
  const mappingsData = mappingsQuery.data as {
    mappings?: CodeMapping[];
  } | null;

  useEffect(() => {
    if (repo || !mappingsData?.mappings) return;
    const projectSlug = issue.project.slug;
    // Try to find a mapping for this project, or fall back to the first mapping
    const match =
      mappingsData.mappings.find((m) => m.projectSlug === projectSlug) ??
      mappingsData.mappings[0];
    if (match?.repoName) {
      setRepo(match.repoName);
      setRepoInput(match.repoName);
      saveRepoToStorage(match.repoName);
      setEditingRepo(false);
    }
  }, [mappingsData, issue.project.slug, repo]);

  const dataError =
    result?.error ??
    (mutation.error ? (mutation.error as Error).message : null);

  function runBlame(repoSlug: string) {
    if (!repoSlug || !filePath) return;
    const [owner, repoName] = repoSlug.split("/");
    if (!owner || !repoName) return;
    setFetched(true);
    mutation.mutate(
      { owner, repo: repoName, path: filePath },
      { onSuccess: (data) => setResult(data as BlameResult) },
    );
  }

  function handleSaveRepo() {
    const slug = repoInput.trim();
    setRepo(slug);
    saveRepoToStorage(slug);
    setEditingRepo(false);
    runBlame(slug);
  }

  const latestCommit = result?.latestCommit;
  const pr = latestCommit?.associatedPullRequests?.nodes?.[0];

  // Top-N unique authors weighted by recency
  const authors = result?.ranges
    ? Object.values(
        result.ranges.reduce<
          Record<
            string,
            { name: string; email: string; age: number; lines: number }
          >
        >((acc, r) => {
          const key = r.commit.author.email;
          if (!acc[key]) {
            acc[key] = {
              name: r.commit.author.name,
              email: key,
              age: r.age,
              lines: 0,
            };
          }
          acc[key].lines += r.endingLine - r.startingLine + 1;
          if (r.age < acc[key].age) acc[key].age = r.age;
          return acc;
        }, {}),
      ).sort((a, b) => b.lines - a.lines)
    : [];

  return (
    <div className="pt-3 border-t border-border/50 space-y-2.5">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <IconBrandGithub className="h-3.5 w-3.5 shrink-0" />
          GitHub blame
          {filePath && (
            <span className="font-mono font-normal truncate max-w-[180px]">
              · {filePath.split("/").pop()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {fetched && !editingRepo && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0 shrink-0"
              onClick={() => runBlame(repo)}
              disabled={mutation.isPending}
            >
              <IconRefresh
                className={`h-3.5 w-3.5 ${mutation.isPending ? "animate-spin" : ""}`}
              />
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 shrink-0"
            onClick={() => setEditingRepo((v) => !v)}
          >
            <IconSettings className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Repo config */}
      {editingRepo && (
        <div className="flex gap-1.5">
          <Input
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveRepo();
              if (e.key === "Escape") setEditingRepo(false);
            }}
            placeholder="owner/repo (e.g. acme/backend)"
            className="h-8 text-xs font-mono"
            autoFocus
          />
          <Button
            size="sm"
            className="h-8 px-3 text-xs shrink-0"
            onClick={handleSaveRepo}
            disabled={!repoInput.trim().includes("/")}
          >
            Blame
          </Button>
        </div>
      )}

      {/* No file path */}
      {!filePath && !editingRepo && (
        <p className="text-xs text-muted-foreground">
          No file path found in this issue&apos;s culprit.
        </p>
      )}

      {/* Prompt to configure repo */}
      {!editingRepo && !repo && filePath && (
        <button
          type="button"
          onClick={() => setEditingRepo(true)}
          className="w-full flex items-center gap-2 h-8 px-3 rounded-md border border-dashed border-border/60 hover:border-border hover:bg-muted/40 transition-colors text-left"
        >
          <IconBrandGithub className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs text-muted-foreground">
            {mappingsQuery.isLoading
              ? "Detecting repository from Sentry…"
              : "Set repo to see who last touched "}
            {!mappingsQuery.isLoading && (
              <span className="font-mono">{filePath.split("/").pop()}</span>
            )}
          </span>
        </button>
      )}

      {/* Loading */}
      {mutation.isPending && (
        <div className="space-y-2.5 pt-1">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex gap-2">
              <Skeleton className="h-6 w-6 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-3 w-full" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {!mutation.isPending && dataError && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground py-1">
          <IconAlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-yellow-500" />
          <span>{dataError}</span>
        </div>
      )}

      {/* Results */}
      {!mutation.isPending && !dataError && latestCommit && (
        <div className="space-y-3">
          {/* Latest commit card */}
          <a
            href={pr?.url ?? latestCommit.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-md border border-border/60 bg-muted/20 px-3 py-2.5 hover:bg-muted/40 transition-colors group"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-medium">
                <IconGitCommit className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                {pr ? (
                  <span>
                    PR #{pr.number}{" "}
                    <span className="font-normal text-muted-foreground">
                      · {pr.title}
                    </span>
                  </span>
                ) : (
                  <span className="font-mono">
                    {latestCommit.abbreviatedOid}
                  </span>
                )}
              </div>
              <IconExternalLink className="h-3 w-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {latestCommit.message.split("\n")[0]}
            </p>
            <div className="flex items-center gap-2 mt-1.5 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground/70">
                {latestCommit.author.name}
              </span>
              <span>·</span>
              <span>{timeAgo(latestCommit.committedDate)}</span>
            </div>
          </a>

          {/* Author breakdown */}
          {authors.length > 1 && (
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
                File ownership
              </p>
              {authors.slice(0, 4).map((a) => (
                <div key={a.email} className="flex items-center gap-2 text-xs">
                  <div className="h-5 w-5 rounded-full bg-muted/60 shrink-0 flex items-center justify-center text-[9px] font-bold text-muted-foreground uppercase">
                    {a.name[0]}
                  </div>
                  <span className="flex-1 truncate text-foreground/80">
                    {a.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {a.lines} lines · last {a.age}d ago
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
