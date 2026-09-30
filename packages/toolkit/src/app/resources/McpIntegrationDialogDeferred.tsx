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

export function McpIntegrationDialogDeferred(props: McpIntegrationDialogProps) {
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (props.open) setOpened(true);
  }, [props.open]);
  if (!opened || !props.open) return null;
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
