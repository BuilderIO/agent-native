import { lazy, Suspense } from "react";

import { SettingsSkeleton } from "./SettingsSkeleton.js";

const ExtensionsListPage = lazy(() =>
  import("../extensions/ExtensionsListPage.js").then((module) => ({
    default: module.ExtensionsListPage,
  })),
);

export function ExtensionsSettingsContent() {
  return (
    <div className="w-full">
      <Suspense
        fallback={<SettingsSkeleton lines={4} className="min-h-[28rem]" />}
      >
        <ExtensionsListPage embedded />
      </Suspense>
    </div>
  );
}
