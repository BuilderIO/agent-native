import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { resolveConnectorSecret } from "../server/connectors/credentials.js";
import { getDb } from "../server/db/index.js";
import { triageConfig, triageItems } from "../server/db/schema.js";
import { requireFactoryAutomation } from "../server/lib/require-factory-automation.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { createAiServicesGitReadClient } from "../server/triage/ai-services-git.js";
import { createGitHubClient } from "../server/triage/github-client.js";
import {
  metadataString,
  parseTriageMetadata,
  serializeTriageMetadata,
} from "../server/triage/metadata.js";
import {
  babysitFingerprint,
  DEFAULT_BABYSIT_BOT_AUTHORS,
  reconcileBabysitState,
  shouldBabysitBuilderBotPullRequest,
} from "../server/triage/pr-babysit.js";
import { detectOwnerOwnedArea } from "../server/triage/pr-policy.js";

const QUIET_PERIOD_MS = 20 * 60_000;
const MIN_COMMENT_INTERVAL_MS = 90_000;
const BUILDER_BOT_REQUEST =
  "@builderio-bot look at latest PR feedback and fix anything you agree with. Be skeptical. Reply to every comment (directly on the comment thread of each comment) if you fixed it or not and why. then check back every 2 minutes on a loop and see if any new feedback posted, until at least 20 minutes go by without any new feedback posted we want to address, including making sure CI passes too and no merge conflicts (make sure code is mergeable)";

function requiredAiServicesEnv(
  name: "BUILDER_AI_SERVICES_URL" | "BUILDER_PROJECT_ID",
): string {
  const value =
    name === "BUILDER_AI_SERVICES_URL"
      ? process.env.BUILDER_AI_SERVICES_URL // guard:allow-env-credential - non-secret deployment endpoint
      : process.env.BUILDER_PROJECT_ID; // guard:allow-env-credential - non-secret deployment project id
  if (!value) throw new Error(`${name} is required for PR babysitting.`);
  return value;
}

function parseTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function repositoryRef(value: string): { owner: string; repo: string } {
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(value.trim());
  if (!match)
    throw new Error("Repository must use the owner/repository format.");
  return { owner: match[1], repo: match[2] };
}

async function updateBabysitMetadata(
  itemId: string,
  orgId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  const item = (
    await db
      .select({ metadataJson: triageItems.metadataJson })
      .from(triageItems)
      .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)))
      .limit(1)
  )[0];
  if (!item) throw new Error("Factory item disappeared during PR babysitting.");
  const metadata = parseTriageMetadata(item.metadataJson);
  Object.assign(metadata, patch);
  await db
    .update(triageItems)
    .set({
      metadataJson: serializeTriageMetadata(metadata),
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)));
}

export default defineAction({
  description:
    "Watch one builder-io-bot pull request, post the bounded feedback-fix request when CI, mergeability, or review feedback needs work, and stop after 20 quiet minutes. The action never merges or approves.",
  schema: z.object({
    itemId: z.string().min(1),
  }),
  http: false,
  run: async ({ itemId }, context) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    await requireFactoryAutomation(context, { userEmail, orgId }, "prBabysit");

    const db = getDb();
    const item = (
      await db
        .select()
        .from(triageItems)
        .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)))
        .limit(1)
    )[0];
    if (!item) throw new Error("Factory item not found for PR babysitting.");
    if (
      item.source !== "github" ||
      !item.repository ||
      !item.pullRequestNumber
    ) {
      return {
        ok: true,
        action: "skipped",
        reason: "Item is not a pull request.",
      };
    }

    const configuredRepository = (
      await db
        .select({ repository: triageConfig.repository })
        .from(triageConfig)
        .where(and(eq(triageConfig.id, orgId), eq(triageConfig.orgId, orgId)))
        .limit(1)
    )[0]?.repository;
    if (
      !configuredRepository ||
      configuredRepository.trim() !== item.repository.trim()
    ) {
      throw new Error(
        "PR babysitting is restricted to the configured Factory repository.",
      );
    }

    const repository = repositoryRef(item.repository);
    const github = createGitHubClient({ ownerEmail: userEmail, orgId });
    const pullRequest = await github.getPullRequestSummary(
      repository,
      item.pullRequestNumber,
    );
    if (pullRequest.state !== "open" || pullRequest.draft) {
      await updateBabysitMetadata(itemId, orgId, {
        prBabysitState: "closed-or-draft",
        prBabysitLastCheckedAt: new Date().toISOString(),
      });
      return { ok: true, action: "skipped", reason: "PR is closed or draft." };
    }

    const ownerOwnedArea = detectOwnerOwnedArea([
      item.repository,
      pullRequest.title,
      pullRequest.body,
    ]);
    if (ownerOwnedArea) {
      await updateBabysitMetadata(itemId, orgId, {
        prBabysitState: "owner-managed",
        prBabysitOwnerArea: ownerOwnedArea,
        prBabysitLastCheckedAt: new Date().toISOString(),
      });
      return {
        ok: true,
        action: "skipped",
        reason: `${ownerOwnedArea} is owner-managed.`,
      };
    }

    const privateKey = await resolveConnectorSecret(
      "BUILDER_PRIVATE_KEY",
      userEmail,
      { orgId },
    );
    if (!privateKey) {
      throw new Error(
        "BUILDER_PRIVATE_KEY is required to read PR feedback for babysitting.",
      );
    }
    const snapshot = await createAiServicesGitReadClient({
      baseUrl: requiredAiServicesEnv("BUILDER_AI_SERVICES_URL"),
      authorization: `Bearer ${privateKey.startsWith("bpk-") ? privateKey : `bpk-${privateKey}`}`,
    }).fetchPullRequest({
      projectId: requiredAiServicesEnv("BUILDER_PROJECT_ID"),
      repo: item.repository,
      pullRequestNumber: item.pullRequestNumber,
    });
    if (snapshot.headSha !== pullRequest.headSha) {
      throw new Error(
        `PR evidence is stale: GitHub reports ${pullRequest.headSha}, ai-services reports ${snapshot.headSha}.`,
      );
    }

    const proposal = reconcileBabysitState({
      comments: snapshot.comments,
      checks: snapshot.checks,
      commentsTruncated: snapshot.commentsTruncated,
      botAuthors: [...DEFAULT_BABYSIT_BOT_AUTHORS],
    });
    const unresolvedReviewState = snapshot.reviews.some(
      (review) =>
        review.state === "changes_requested" || review.state === "pending",
    );
    const signal = {
      ...proposal,
      isClean: proposal.isClean && !unresolvedReviewState,
    };
    const needsBabysit = shouldBabysitBuilderBotPullRequest({
      author: pullRequest.userLogin,
      mergeable: pullRequest.mergeable,
      mergeableState: pullRequest.mergeableState,
      snapshot: signal,
    });
    const now = new Date();
    const nowIso = now.toISOString();
    const metadata = parseTriageMetadata(item.metadataJson);
    const fingerprint = babysitFingerprint({
      headSha: snapshot.headSha,
      mergeable: pullRequest.mergeable,
      mergeableState: pullRequest.mergeableState,
      snapshot: signal,
      reviewStates: snapshot.reviews.map((review) => review.state),
    });
    const previousFingerprint = metadataString(
      metadata,
      "prBabysitFingerprint",
    );
    const previousState = metadataString(metadata, "prBabysitState");
    if (!needsBabysit) {
      await updateBabysitMetadata(itemId, orgId, {
        prBabysitState: "clean",
        prBabysitLastCheckedAt: nowIso,
        prBabysitFingerprint: fingerprint,
      });
      return { ok: true, action: "clean" };
    }

    const quietSince =
      previousFingerprint === fingerprint && previousState !== "clean"
        ? (parseTimestamp(metadataString(metadata, "prBabysitQuietSinceAt")) ??
          now.getTime())
        : now.getTime();
    const lastCommentAt = parseTimestamp(
      metadataString(metadata, "prBabysitLastCommentAt"),
    );
    const quietForMs = now.getTime() - quietSince;
    const shouldPost =
      previousFingerprint !== fingerprint &&
      (lastCommentAt === null ||
        now.getTime() - lastCommentAt >= MIN_COMMENT_INTERVAL_MS);
    if (!shouldPost || quietForMs >= QUIET_PERIOD_MS) {
      await updateBabysitMetadata(itemId, orgId, {
        prBabysitState: quietForMs >= QUIET_PERIOD_MS ? "quiet" : "waiting",
        prBabysitFingerprint: fingerprint,
        prBabysitQuietSinceAt: new Date(quietSince).toISOString(),
        prBabysitLastCheckedAt: nowIso,
      });
      return {
        ok: true,
        action: quietForMs >= QUIET_PERIOD_MS ? "quiet" : "waiting",
        quietForMinutes: Math.floor(Math.max(0, quietForMs) / 60_000),
      };
    }

    const comment = await github.createIssueComment(
      repository,
      item.pullRequestNumber,
      BUILDER_BOT_REQUEST,
    );
    await updateBabysitMetadata(itemId, orgId, {
      prBabysitState: "active",
      prBabysitFingerprint: fingerprint,
      prBabysitQuietSinceAt: new Date(quietSince).toISOString(),
      prBabysitLastCheckedAt: nowIso,
      prBabysitLastCommentAt: nowIso,
      prBabysitLastCommentUrl: comment.htmlUrl,
    });
    return {
      ok: true,
      action: "commented",
      commentUrl: comment.htmlUrl,
      quietForMinutes: Math.floor(Math.max(0, quietForMs) / 60_000),
    };
  },
});
