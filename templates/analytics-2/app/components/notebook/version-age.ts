import type { useT } from "@agent-native/core/client/i18n";

import type { ProjectVersion } from "@/lib/model/project-version-contracts";

export type VersionAge = {
  unit: "seconds" | "minutes" | "hours" | "days";
  count: number;
};

export function versionAge(
  value: string,
  now: number = Date.now(),
): VersionAge | null {
  const at = new Date(value).getTime();
  if (Number.isNaN(at)) return null;
  const seconds = Math.floor(Math.max(0, now - at) / 1000);
  if (seconds < 60) return { unit: "seconds", count: Math.max(1, seconds) };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { unit: "minutes", count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: "hours", count: hours };
  const days = Math.floor(hours / 24);
  return days < 30 ? { unit: "days", count: days } : null;
}

export function versionWhen(
  value: string,
  t: ReturnType<typeof useT>,
  absolute: (value: string) => string,
) {
  const age = versionAge(value);
  return age
    ? t(`notebook.history.ago.${age.unit}`, { count: age.count })
    : absolute(value);
}

export function projectVersionLabel(
  version: ProjectVersion,
  t: ReturnType<typeof useT>,
) {
  return (
    version.name?.trim() ||
    t("notebook.history.versionNumber", { number: version.number })
  );
}
