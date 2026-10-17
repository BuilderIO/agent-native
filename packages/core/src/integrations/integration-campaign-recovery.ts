import { getA2AContinuationTaskOutcome } from "./a2a-continuations-store.js";
import {
  getIntegrationCampaign,
  failDisabledIntegrationCampaignTask,
  listDueIntegrationCampaignIds,
  deferIntegrationCampaignForRuntime,
} from "./integration-campaigns-store.js";
import {
  dispatchPendingIntegrationTask,
  isIntegrationDurableDispatchEnabledForTask,
  isIntegrationDurableDispatchExplicitlyDisabledForTask,
} from "./integration-durable-dispatch.js";
import {
  getNextPendingTaskForThread,
  getPendingTask,
} from "./pending-tasks-store.js";

export interface IntegrationCampaignRecoveryResult {
  selected: number;
  dispatched: number;
  skipped: number;
  failed: number;
}

function hasConfirmedDeliveryReceipt(payload: string): boolean {
  try {
    const parsed = JSON.parse(payload) as {
      kind?: unknown;
      deliveryReceipt?: { status?: unknown };
    };
    return (
      parsed.kind === "response-delivery" &&
      parsed.deliveryReceipt?.status === "delivered"
    );
  } catch {
    return false;
  }
}

export async function recoverDueIntegrationCampaigns(options: {
  limit?: number;
  event?: unknown;
  webhookBaseUrl?: string;
}): Promise<IntegrationCampaignRecoveryResult> {
  const ids = await listDueIntegrationCampaignIds(options.limit ?? 20);
  const result: IntegrationCampaignRecoveryResult = {
    selected: ids.length,
    dispatched: 0,
    skipped: 0,
    failed: 0,
  };

  for (const id of ids) {
    try {
      const campaign = await getIntegrationCampaign(id);
      if (!campaign) {
        result.skipped += 1;
        continue;
      }
      const task = await getPendingTask(campaign.integrationTaskId);
      if (!task || task.status !== "processing") {
        result.skipped += 1;
        continue;
      }
      const durableDispatchEnabled = isIntegrationDurableDispatchEnabledForTask(
        {
          platform: task.platform,
          externalThreadId: task.externalThreadId,
          platformContext: task.dispatchScope
            ? { channelId: task.dispatchScope }
            : undefined,
        },
      );
      const confirmedReceipt =
        hasConfirmedDeliveryReceipt(task.payload) ||
        (await getA2AContinuationTaskOutcome(task.id)) === "terminal-delivered";
      if (!durableDispatchEnabled && !confirmedReceipt) {
        if (
          !isIntegrationDurableDispatchExplicitlyDisabledForTask({
            platform: task.platform,
            externalThreadId: task.externalThreadId,
            platformContext: task.dispatchScope
              ? { channelId: task.dispatchScope }
              : undefined,
          })
        ) {
          await deferIntegrationCampaignForRuntime(campaign.id, 60_000);
          result.skipped += 1;
          continue;
        }
        await failDisabledIntegrationCampaignTask(task.id);
        const nextTask = await getNextPendingTaskForThread(
          task.platform,
          task.externalThreadId,
        );
        if (nextTask) {
          await dispatchPendingIntegrationTask({
            taskId: nextTask.id,
            task: {
              platform: task.platform,
              externalThreadId: task.externalThreadId,
              platformContext: nextTask.dispatchScope
                ? { channelId: nextTask.dispatchScope }
                : undefined,
            },
            event: options.event,
            baseUrl: options.webhookBaseUrl,
          });
        }
        result.skipped += 1;
        continue;
      }
      const outcome = await dispatchPendingIntegrationTask({
        taskId: task.id,
        task: {
          platform: task.platform,
          externalThreadId: task.externalThreadId,
          platformContext: task.dispatchScope
            ? { channelId: task.dispatchScope }
            : undefined,
        },
        event: options.event,
        baseUrl: options.webhookBaseUrl,
        campaignContinuation: true,
        ...(confirmedReceipt && !durableDispatchEnabled
          ? { allowPortableConfirmedReceiptReconciliation: true }
          : {}),
      });
      if (outcome === "failed") result.failed += 1;
      else result.dispatched += 1;
    } catch (error) {
      result.failed += 1;
      console.error(
        `[integrations] Failed to wake integration campaign ${id}:`,
        error,
      );
    }
  }

  return result;
}
