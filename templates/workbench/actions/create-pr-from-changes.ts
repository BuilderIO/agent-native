import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";
import { getCodeWorkspace } from "../server/lib/code-workspace.js";
import {
  checkoutBranch,
  commitAllChanges,
  getGitStatus,
  getOriginOwnerRepo,
  pushCurrentBranch,
} from "../server/lib/git-ops.js";
import { getGitHubConnection } from "../server/lib/github-connection.js";
import { getDispatchIntegrationsUrl } from "../server/lib/dispatch-url.js";

/**
 * One-shot "commit current changes + push + open PR" flow from the Code
 * Room's Source Control panel.
 *
 * Steps (each step is short-circuited with a friendly error if the
 * precondition fails):
 *
 *   1. Workspace must be a git repo with dirty changes.
 *   2. `origin` must point at a GitHub repo (`owner/repo` parseable).
 *   3. GitHub must be connected via the shared workspace integration.
 *      No GitHub connection => `{ ok: false, connected: false }` so the
 *      UI can render the same "connect via Dispatch" CTA the rest of
 *      Workbench uses.
 *   4. If `branchName` is provided AND differs from the current branch,
 *      create + checkout that branch before committing.
 *   5. Stage all changes + commit with `title` as the message.
 *   6. `git push --set-upstream origin <branch>`.
 *   7. `POST /repos/{owner}/{repo}/pulls` with `title`, `body`, `head`,
 *      `base`. Returns the PR URL + number.
 *
 * IMPORTANT: Workbench's GitHub integration is read by user/org from
 * the shared Dispatch integration — we never expose a token to the
 * client and we never write GitHub credentials of our own.
 */
export default defineAction({
  description:
    "Commit all dirty changes in a Code Room workspace, push to GitHub, " +
    "and open a pull request. Uses the shared Workbench GitHub integration.",
  schema: z.object({
    workspaceId: z.string().min(1),
    title: z.string().min(1).max(256),
    body: z.string().optional(),
    baseBranch: z.string().min(1).default("main"),
    branchName: z.string().optional(),
  }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      throw new Error("Sign in to create a PR.");
    }
    const orgId = getRequestOrgId() ?? "";
    const workspace = await getCodeWorkspace(
      args.workspaceId,
      ownerEmail,
      orgId,
    );

    // Step 1: dirty git repo?
    const status = await getGitStatus(workspace.path);
    if (!status.isRepo) {
      throw new Error(
        "This workspace isn't a git repository. Run `git init` " +
          "and add a `origin` remote before creating a PR.",
      );
    }
    const dirty =
      status.staged.length + status.unstaged.length + status.untracked.length;
    if (dirty === 0) {
      throw new Error("No changes to commit.");
    }

    // Step 2: parseable GitHub origin?
    const slug = await getOriginOwnerRepo(workspace.path);
    if (!slug) {
      throw new Error(
        "Workspace `origin` doesn't point at a GitHub repo (e.g. " +
          "`git@github.com:owner/repo.git`). Add a GitHub origin first.",
      );
    }

    // Step 3: GitHub connected?
    const octokit = await getGitHubConnection(ownerEmail, orgId);
    if (!octokit) {
      return {
        ok: false,
        connected: false,
        message:
          "Connect GitHub via Dispatch first — Workbench needs the " +
          "shared workspace GitHub integration to open a PR.",
        connectUrl: getDispatchIntegrationsUrl({
          provider: "github",
          appId: "workbench",
        }),
      };
    }

    // Step 4: optional branch switch.
    const finalBranch =
      args.branchName?.trim() || status.branch || "workbench-changes";
    if (finalBranch !== status.branch) {
      await checkoutBranch(workspace.path, finalBranch, { create: true });
    }

    // Step 5: stage + commit.
    const commit = await commitAllChanges(workspace.path, args.title);

    // Step 6: push.
    try {
      await pushCurrentBranch(workspace.path, finalBranch);
    } catch (err) {
      throw new Error(
        `Pushed failed: ${
          err instanceof Error ? err.message : String(err)
        }. The commit (${commit.hash.slice(0, 7)}) is local — push manually then open the PR.`,
      );
    }

    // Step 7: open PR via the shared GitHub integration.
    try {
      const { data } = await octokit.pulls.create({
        owner: slug.owner,
        repo: slug.repo,
        title: args.title,
        body: args.body || `Created from Workbench Code Room — ${commit.hash}`,
        head: finalBranch,
        base: args.baseBranch,
      });
      return {
        ok: true,
        connected: true,
        prUrl: data.html_url,
        prNumber: data.number,
        commitHash: commit.hash,
        branch: finalBranch,
        owner: slug.owner,
        repo: slug.repo,
      };
    } catch (err: unknown) {
      const status =
        typeof err === "object" && err && "status" in err
          ? (err as { status?: number }).status
          : undefined;
      if (status === 422) {
        throw new Error(
          `GitHub rejected the PR — branch '${finalBranch}' may already have an open PR against '${args.baseBranch}'. The commit (${commit.hash.slice(0, 7)}) was pushed successfully.`,
        );
      }
      throw new Error(
        `Couldn't open PR: ${
          err instanceof Error ? err.message : String(err)
        }. The commit (${commit.hash.slice(0, 7)}) was pushed — open the PR manually on GitHub.`,
      );
    }
  },
});
