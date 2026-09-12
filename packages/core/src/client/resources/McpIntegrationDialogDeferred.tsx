import { CubeLoader } from "@agent-native/toolkit/ui/cube-loader";
import {
  lazy,
  Suspense,
  useEffect,
  useState,
  type ComponentProps,
} from "react";

const McpIntegrationDialogLazy = lazy(() =>
  import("./McpIntegrationDialog.js").then((m) => ({
    default: m.McpIntegrationDialog,
  })),
);

type McpIntegrationDialogProps = ComponentProps<
  typeof McpIntegrationDialogLazy
>;

// The MCP integration dialog bundle is heavy; keep it out of first-load by
// fetching it only when the dialog is first opened. The fallback mirrors the
// dialog's overlay geometry so the first uncached open never reads as a
// swallowed click while the chunk fetches.
export function McpIntegrationDialogDeferred(props: McpIntegrationDialogProps) {
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (props.open) setOpened(true);
  }, [props.open]);
  if (!opened) return null;
  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 z-[270] grid place-items-center bg-background/45 backdrop-blur-[1px]">
          <CubeLoader className="size-6" />
        </div>
      }
    >
      <McpIntegrationDialogLazy {...props} />
    </Suspense>
  );
}
