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
// fetching it only when the dialog is first opened.
export function McpIntegrationDialogDeferred(props: McpIntegrationDialogProps) {
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (props.open) setOpened(true);
  }, [props.open]);
  if (!opened) return null;
  return (
    <Suspense fallback={null}>
      <McpIntegrationDialogLazy {...props} />
    </Suspense>
  );
}
