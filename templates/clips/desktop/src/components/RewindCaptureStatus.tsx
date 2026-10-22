import type { RewindStatusPresentation } from "../lib/rewind-status";
import type { ScreenMemoryStatus } from "../shared/config";

export function RewindCaptureStatus({
  status,
  presentation,
}: {
  status: ScreenMemoryStatus | null;
  presentation: RewindStatusPresentation;
}) {
  if (!status || presentation.kind === "off") return null;
  return (
    <>
      <p className="flex items-center gap-2" role="status">
        {presentation.isLive ? (
          <span className="rec-dot" aria-hidden="true" />
        ) : null}
        {presentation.title}
      </p>
      {presentation.hasError ? (
        <p className="text-xs text-destructive">{presentation.detail}</p>
      ) : null}
    </>
  );
}
