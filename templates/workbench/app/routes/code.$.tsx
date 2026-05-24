import { useParams } from "react-router";
import { CodeShell } from "@/components/code/code-shell";

export function meta() {
  return [{ title: "Workbench — Code" }];
}

/**
 * Code Room catch-all route — handles:
 *   - `/code/src/auth/refresh.ts`      → edit `src/auth/refresh.ts`
 *   - `/code/diff/src/auth/refresh.ts` → diff `src/auth/refresh.ts`
 *
 * The catch-all `$` parameter captures everything after `/code/`. We
 * detect the optional `diff/` prefix and strip it before passing to the
 * shell — that way the same component renders both edit and diff
 * surfaces with one route.
 */
export default function CodeFile() {
  const params = useParams<{ "*"?: string }>();
  const rest = params["*"] ?? "";
  const isDiff = rest.startsWith("diff/");
  const filePath = isDiff ? rest.slice("diff/".length) : rest;
  const decoded = filePath
    ? filePath.split("/").map(decodeURIComponent).join("/")
    : null;
  return <CodeShell filePath={decoded || null} isDiff={isDiff} />;
}
