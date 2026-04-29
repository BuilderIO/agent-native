import { Layout } from "./Layout";

/**
 * Backwards-compatible alias. The canonical layout is now `Layout` —
 * AppLayout re-exports it so older imports keep working.
 */
export function AppLayout({ children }: { children: React.ReactNode }) {
  return <Layout>{children}</Layout>;
}
