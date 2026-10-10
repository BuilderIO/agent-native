import { IconDownload } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

import type { RetainedNativeExport } from "./use-retained-native-export";

export function RetainedNativeExportLink({
  result,
  label,
}: {
  result: RetainedNativeExport;
  label: string;
}) {
  return (
    <Button
      asChild
      variant="outline"
      size="sm"
      className="h-8 max-w-full justify-start gap-1.5"
    >
      <a
        data-native-export-download-result
        data-native-export-local-evidence={result.localEvidence?.status}
        data-native-export-local-artifact-id={result.localEvidence?.artifactId}
        data-native-export-local-error={result.localEvidence?.errorCode}
        href={result.href}
        download={result.filename}
      >
        <IconDownload className="size-3.5 shrink-0" />
        <span>{label}</span>
        <span className="min-w-0 truncate text-muted-foreground">
          {result.filename}
        </span>
      </a>
    </Button>
  );
}
