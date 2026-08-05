import { useT } from "@agent-native/core/client/i18n";
import {
  IconBrowser,
  IconCamera,
  IconDeviceDesktop,
  IconDeviceScreen,
  IconLink,
  IconPlayerRecord,
  IconUpload,
  IconVideo,
} from "@tabler/icons-react";
import { useState } from "react";

import { trackEvent } from "./TemplateCard";

type RecordingMode = "screen+camera" | "screen" | "camera";
type CaptureSource = "window" | "browser" | "monitor";

export function ClipsQuickStart() {
  const t = useT();
  const [mode, setMode] = useState<RecordingMode>("screen+camera");
  const [surface, setSurface] = useState<CaptureSource>("browser");
  const tq = (key: string) => t(`templateLanding.clips.quickStart.${key}`);
  const recordUrl = new URL("https://clips.agent-native.com/record");
  recordUrl.searchParams.set("mode", mode);
  if (mode !== "camera") recordUrl.searchParams.set("surface", surface);

  const modes = [
    {
      value: "screen+camera" as const,
      label: tq("modeScreenCamera"),
      Icon: IconVideo,
    },
    {
      value: "screen" as const,
      label: tq("modeScreenOnly"),
      Icon: IconDeviceScreen,
    },
    { value: "camera" as const, label: tq("modeCameraOnly"), Icon: IconCamera },
  ];
  const sources = [
    {
      value: "window" as const,
      label: tq("surfaceWindow"),
      Icon: IconDeviceDesktop,
    },
    {
      value: "browser" as const,
      label: tq("surfaceBrowser"),
      Icon: IconBrowser,
    },
    {
      value: "monitor" as const,
      label: tq("surfaceScreen"),
      Icon: IconDeviceScreen,
    },
  ];

  const optionClass = (active: boolean) =>
    `flex min-h-24 flex-col items-start justify-between rounded-xl border p-4 text-start transition ${
      active
        ? "border-[var(--docs-accent)] bg-[var(--bg)] ring-1 ring-[var(--docs-accent)]"
        : "border-[var(--docs-border)] bg-[var(--bg)] hover:border-[var(--fg-secondary)]"
    }`;

  return (
    <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] text-start shadow-sm">
      <div className="p-5 sm:p-6">
        <div className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--fg-secondary)]">
          {tq("recordingMode")}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {modes.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              className={optionClass(mode === value)}
            >
              <span className="mb-4 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--bg-secondary)] text-[var(--fg-secondary)]">
                <Icon size={18} stroke={1.8} />
              </span>
              <span className="text-sm font-medium text-[var(--fg)]">
                {label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {mode !== "camera" && (
        <div className="border-t border-[var(--docs-border)] p-5 sm:p-6">
          <div className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--fg-secondary)]">
            {tq("captureSource")}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {sources.map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                aria-pressed={surface === value}
                onClick={() => setSurface(value)}
                className={optionClass(surface === value)}
              >
                <Icon
                  size={18}
                  stroke={1.8}
                  className="mb-4 text-[var(--fg-secondary)]"
                />
                <span className="text-xs font-medium text-[var(--fg)] sm:text-sm">
                  {label}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-[var(--docs-border)] p-5 sm:p-6">
        <a
          href={recordUrl.toString()}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() =>
            trackEvent("try live demo", {
              template: "clips",
              location: "landing_page_quickstart",
            })
          }
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-black px-6 py-3 text-sm font-medium text-white no-underline transition hover:bg-gray-800 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
        >
          <IconPlayerRecord size={18} stroke={1.8} />
          {tq("startRecording")}
        </a>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm">
          <a
            href="https://clips.agent-native.com/record?autoUpload=1"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[var(--fg-secondary)] no-underline hover:text-[var(--fg)] hover:no-underline"
          >
            <IconUpload size={16} stroke={1.8} />
            {tq("uploadVideo")}
          </a>
          <a
            href="https://clips.agent-native.com/import"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[var(--fg-secondary)] no-underline hover:text-[var(--fg)] hover:no-underline"
          >
            <IconLink size={16} stroke={1.8} />
            {tq("importLoom")}
          </a>
        </div>
      </div>
    </div>
  );
}
