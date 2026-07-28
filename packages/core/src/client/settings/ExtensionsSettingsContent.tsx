import { IconLoader2 } from "@tabler/icons-react";
import { lazy, Suspense } from "react";

const ExtensionsListPage = lazy(() =>
  import("../extensions/ExtensionsListPage.js").then((module) => ({
    default: module.ExtensionsListPage,
  })),
);

export function ExtensionsSettingsContent() {
  return (
    <div className="mx-auto w-full max-w-5xl">
      <Suspense
        fallback={
          <div className="flex min-h-[28rem] items-center justify-center text-muted-foreground">
            <IconLoader2 className="size-5 animate-spin" aria-label="Loading" />
          </div>
        }
      >
        <ExtensionsListPage embedded />
      </Suspense>
    </div>
  );
}
