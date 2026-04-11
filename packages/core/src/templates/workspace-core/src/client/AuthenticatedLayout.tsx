/**
 * Shared authenticated layout for every app in the @{{APP_NAME}} workspace.
 *
 * Provides the common chrome (brand header, user menu, agent chat sidebar)
 * so individual apps only have to render their own content. Replace this
 * with a real component that pulls in your design system. Every app
 * imports it the same way:
 *
 *   import { AuthenticatedLayout } from "@{{APP_NAME}}/core-module/client";
 *
 *   export default function Home() {
 *     return (
 *       <AuthenticatedLayout>
 *         <h1>My app's screen</h1>
 *       </AuthenticatedLayout>
 *     );
 *   }
 */
import type { ReactNode } from "react";

export interface AuthenticatedLayoutProps {
  children: ReactNode;
}

// Workspace title — replaced at scaffold time by the create-workspace CLI.
const WORKSPACE_TITLE = "{{APP_TITLE}}";

export function AuthenticatedLayout({ children }: AuthenticatedLayoutProps) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b px-6 py-3">
        <strong>{WORKSPACE_TITLE}</strong>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
