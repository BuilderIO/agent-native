import { describe, expect, it } from "vitest";

import disconnectChatGPTSubscription from "../agent/actions/disconnect-chatgpt-subscription.js";
import manageBuilderConnection from "../agent/actions/manage-builder-connection.js";
import manageProviderKeyPolicy from "../agent/actions/manage-provider-key-policy.js";
import manageProviderModels from "../agent/actions/manage-provider-models.js";
import manageServiceProviders from "../agent/actions/manage-service-providers.js";
import selectChatGPTSubscriptionAccount from "../agent/actions/select-chatgpt-subscription-account.js";
import contextEvict from "../agent/context-xray/actions/context-evict.js";
import contextPin from "../agent/context-xray/actions/context-pin.js";
import contextReport from "../agent/context-xray/actions/context-report.js";
import contextRestore from "../agent/context-xray/actions/context-restore.js";
import setFeatureFlag from "../feature-flags/actions/set-feature-flag.js";
import manageFileStorage from "../file-upload/actions/manage-file-storage.js";
import uploadImage from "../file-upload/actions/upload-image.js";
import createResourceVersion from "../history/actions/create-resource-version.js";
import restoreResourceVersion from "../history/actions/restore-resource-version.js";
import manageMessagingChannel from "../integrations/actions/manage-messaging-channel.js";
import setLab from "../labs/actions/set-lab.js";
import setLocalizationPreference from "../localization/actions/set-localization-preference.js";
import consumeReviewFeedback from "../review/actions/consume-review-feedback.js";
import createReviewComment from "../review/actions/create-review-comment.js";
import deleteReviewComment from "../review/actions/delete-review-comment.js";
import reactToReviewComment from "../review/actions/react-to-review-comment.js";
import replyReviewComment from "../review/actions/reply-review-comment.js";
import resolveReviewThread from "../review/actions/resolve-review-thread.js";
import sendReviewThreadToAgent from "../review/actions/send-review-thread-to-agent.js";
import setReviewStatus from "../review/actions/set-review-status.js";
import setReviewThreadMuted from "../review/actions/set-review-thread-muted.js";
import setReviewThreadUnread from "../review/actions/set-review-thread-unread.js";
import setReviewThreadsUnread from "../review/actions/set-review-threads-unread.js";
import updateReviewCommentAnchor from "../review/actions/update-review-comment-anchor.js";
import updateReviewComment from "../review/actions/update-review-comment.js";
import {
  createResourceSuggestion,
  createResourceSuggestionProposal,
  decideResourceSuggestion,
  decideResourceSuggestionProposal,
  updateResourceSuggestion,
} from "../review/suggestions/actions.js";
import deleteApiKey from "../secrets/actions/delete-api-key.js";
import setResourceVisibility from "../sharing/actions/set-resource-visibility.js";
import shareResource from "../sharing/actions/share-resource.js";
import unshareResource from "../sharing/actions/unshare-resource.js";
import manageUsageAlert from "../usage/actions/manage-usage-alert.js";
import bulkUpdateWorkspaceUserGroups from "../workspace-connections/actions/bulk-update-workspace-user-groups.js";
import deleteWorkspaceUserGroup from "../workspace-connections/actions/delete-workspace-user-group.js";
import upsertWorkspaceUserGroup from "../workspace-connections/actions/upsert-workspace-user-group.js";

const reviewedActions = [
  [
    "bulk-update-workspace-user-groups",
    bulkUpdateWorkspaceUserGroups,
    true,
    false,
  ],
  ["consume-review-feedback", consumeReviewFeedback, false, false],
  ["context-evict", contextEvict, false, false],
  ["context-pin", contextPin, false, false],
  ["context-report", contextReport, false, false],
  ["context-restore", contextRestore, false, false],
  ["create-resource-suggestion", createResourceSuggestion, true, true, true],
  [
    "create-resource-suggestion-proposal",
    createResourceSuggestionProposal,
    false,
    true,
    true,
  ],
  ["create-resource-version", createResourceVersion, false, false],
  ["create-review-comment", createReviewComment, false, true],
  ["decide-resource-suggestion", decideResourceSuggestion, true, false, true],
  [
    "decide-resource-suggestion-proposal",
    decideResourceSuggestionProposal,
    true,
    false,
    true,
  ],
  ["delete-api-key", deleteApiKey, true, false],
  ["delete-review-comment", deleteReviewComment, true, false],
  ["delete-workspace-user-group", deleteWorkspaceUserGroup, true, false],
  [
    "disconnect-chatgpt-subscription",
    disconnectChatGPTSubscription,
    true,
    true,
  ],
  ["manage-builder-connection", manageBuilderConnection, true, true],
  ["manage-file-storage", manageFileStorage, true, false],
  ["manage-messaging-channel", manageMessagingChannel, true, true],
  ["manage-provider-key-policy", manageProviderKeyPolicy, false, false],
  ["manage-provider-models", manageProviderModels, false, false],
  ["manage-service-providers", manageServiceProviders, false, false],
  ["manage-usage-alert", manageUsageAlert, false, false],
  ["react-to-review-comment", reactToReviewComment, false, false],
  ["reply-review-comment", replyReviewComment, false, true],
  ["resolve-review-thread", resolveReviewThread, true, false],
  ["restore-resource-version", restoreResourceVersion, true, false],
  [
    "select-chatgpt-subscription-account",
    selectChatGPTSubscriptionAccount,
    false,
    false,
  ],
  ["send-review-thread-to-agent", sendReviewThreadToAgent, false, false],
  ["set-feature-flag", setFeatureFlag, true, false],
  ["set-lab", setLab, false, false],
  ["set-localization-preference", setLocalizationPreference, false, false],
  ["set-resource-visibility", setResourceVisibility, true, true],
  ["set-review-status", setReviewStatus, true, false],
  ["set-review-thread-muted", setReviewThreadMuted, false, false],
  ["set-review-thread-unread", setReviewThreadUnread, false, false],
  ["set-review-threads-unread", setReviewThreadsUnread, false, false],
  ["share-resource", shareResource, true, true],
  ["unshare-resource", unshareResource, true, false],
  ["update-resource-suggestion", updateResourceSuggestion, true, false, true],
  ["update-review-comment", updateReviewComment, true, false],
  ["update-review-comment-anchor", updateReviewCommentAnchor, true, false],
  ["upload-image", uploadImage, true, true],
  ["upsert-workspace-user-group", upsertWorkspaceUserGroup, true, false],
] as const;

describe("shared core action MCP annotations", () => {
  it("declares the reviewed hints for every mutating shared action", () => {
    expect(reviewedActions).toHaveLength(44);
    expect(new Set(reviewedActions.map(([name]) => name)).size).toBe(44);

    for (const reviewedAction of reviewedActions) {
      const [name, action, destructiveHint, openWorldHint] = reviewedAction;
      expect(action.mcpAnnotations, name).toEqual({
        readOnlyHint: false,
        destructiveHint,
        openWorldHint,
        ...(reviewedAction.length === 5 ? { idempotentHint: true } : {}),
      });
    }
  });
});
