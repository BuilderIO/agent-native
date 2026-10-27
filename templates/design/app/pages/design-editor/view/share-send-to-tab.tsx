import { IconClipboard, IconTerminal2 } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

export function ShareSendToTab({
  codingHandoffPreviewText,
  exportsUnavailable,
  codingHandoffLoading,
  onCopyCodingHandoff,
}: {
  codingHandoffPreviewText: string;
  exportsUnavailable: boolean;
  codingHandoffLoading: boolean;
  onCopyCodingHandoff: () => void | Promise<void>;
}) {
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-md border border-neutral-800 bg-neutral-950 shadow-sm">
        <div className="flex h-8 items-center border-b border-neutral-800 px-3">
          <div className="flex items-center gap-2">
            {/* guard:allow-raw-color — the terminal illustration's window controls are fixed colors */}
            <span className="size-2.5 rounded-full bg-red-500" />
            <span className="size-2.5 rounded-full bg-yellow-400" />
            {/* guard:allow-raw-color — the terminal illustration's window controls are fixed colors */}
            <span className="size-2.5 rounded-full bg-green-500" />
          </div>
          <div className="min-w-0 flex-1 truncate text-center text-[12px] font-medium text-neutral-400">
            {"Your agent" /* i18n-ignore terminal title */}
          </div>
          <IconTerminal2 className="size-3.5 text-neutral-500" />
        </div>
        <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words px-3 py-3 font-mono text-[12px] leading-5 text-neutral-100">
          {`> ${codingHandoffPreviewText}`}
        </pre>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={() => void onCopyCodingHandoff()}
          disabled={exportsUnavailable || codingHandoffLoading}
          className="h-8 gap-1.5 rounded-md px-3 text-[12px]"
        >
          <IconClipboard className="size-3.5" />
          {"Copy agent prompt" /* i18n-ignore share send action */}
        </Button>
      </div>
    </div>
  );
}
