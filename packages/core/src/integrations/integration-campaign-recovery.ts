import {
  getIntegrationCampaign,
  failDisabledIntegrationCampaignTask,
  listDueIntegrationCampaignIds,
} from "./integration-campaigns-store.js";
import {
  dispatchPendingIntegrationTask,
  isIntegrationDurableDispatchEnabledForTask,
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

/**
 * Wake due campaign chunks without claiming or executing them in the sweep.
 * The signed process-task endpoint owns the lease and all mutations.
 */
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
      if (
        !isIntegrationDurableDispatchEnabledForTask({
          platform: task.platform,
          externalThreadId: task.externalThreadId,
          platformContext: task.dispatchScope
            ? { channelId: task.dispatchScope }
            : undefined,
        })
      ) {
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
