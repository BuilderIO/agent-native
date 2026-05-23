import { CodeShell } from "@/components/code/code-shell";

export function meta() {
  return [
    { title: "Workbench — Code" },
    {
      name: "description",
      content:
        "Mini IDE inside Workbench — file tree, diffs, Monaco editor, and PR creation against your local workspace.",
    },
  ];
}

/**
 * Code Room — welcome view. No file is opened; the editor pane shows a
 * placeholder and the user picks one from the Explorer (or via Cmd+P).
 *
 * URL state: `/code?ws=<workspaceId>` selects a specific workspace.
 * When `?ws` is missing we fall back to the user's default workspace
 * (or the first row).
 */
export default function CodeIndex() {
  return <CodeShell filePath={null} isDiff={false} />;
}
