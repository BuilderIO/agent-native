import type { ActionRunContext } from "@agent-native/core/action";

const DEFAULT_TOOL_ACTIVITY_INTERVAL_MS = 8_000;

type ToolActivityOptions = {
  label: string;
  ongoingLabel?: string;
  intervalMs?: number;
  tool?: string;
};

function canEmitToolActivity(
  context: ActionRunContext | undefined,
): context is ActionRunContext & Required<Pick<ActionRunContext, "send">> {
  return context?.caller === "tool" && typeof context.send === "function";
}

export async function withToolActivity<T>(
  context: ActionRunContext | undefined,
  options: ToolActivityOptions,
  work: () => Promise<T>,
): Promise<T> {
  if (!canEmitToolActivity(context)) return work();

  const tool = options.tool ?? context.actionName;
  const sendActivity = (label: string) => {
    context.send({
      type: "activity",
      label,
      ...(tool ? { tool } : {}),
    });
  };

  sendActivity(options.label);
  const interval = setInterval(
    () => sendActivity(options.ongoingLabel ?? options.label),
    options.intervalMs ?? DEFAULT_TOOL_ACTIVITY_INTERVAL_MS,
  );
  interval.unref?.();

  try {
    return await work();
  } finally {
    clearInterval(interval);
  }
}
