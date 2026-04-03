import DocsLayout from "../components/DocsLayout";
import CodeBlock from "../components/CodeBlock";

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "navigation-state", label: "Navigation State" },
  { id: "view-screen-script", label: "The view-screen Script" },
  { id: "navigate-script", label: "The navigate Script" },
  { id: "use-navigation-state", label: "useNavigationState Hook" },
  { id: "jitter-prevention", label: "Jitter Prevention" },
];

export const meta = () => [
  { title: "Context Awareness — Agent-Native" },
  {
    name: "description",
    content:
      "How the agent knows what the user is looking at: navigation state, view-screen, navigate commands, and jitter prevention.",
  },
];

export default function ContextAwarenessDocs() {
  return (
    <DocsLayout toc={TOC}>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">
        Context Awareness
      </h1>
      <p className="mb-4 text-base text-[var(--fg-secondary)]">
        How the agent knows what the user is looking at — and how the agent can
        control what the user sees.
      </p>

      <h2 id="overview">Overview</h2>
      <p>
        Without context awareness, the agent is blind. It asks "which email?"
        when the user is staring at one. It cannot act on the current selection,
        cannot provide relevant suggestions, and cannot modify what the user
        sees.
      </p>
      <p>Three patterns solve this:</p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>
          <strong>Navigation state</strong> — the UI writes a{" "}
          <code>navigation</code> key to application-state on every route change
        </li>
        <li>
          <strong>
            <code>view-screen</code>
          </strong>{" "}
          — a script that reads navigation state, fetches contextual data, and
          returns a snapshot of what the user sees
        </li>
        <li>
          <strong>
            <code>navigate</code>
          </strong>{" "}
          — a one-shot command from the agent that tells the UI where to go
        </li>
      </ol>

      <h2 id="navigation-state">Navigation state</h2>
      <p>
        The UI writes a <code>navigation</code> key to application-state on
        every route change. This tells the agent what view the user is on and
        what item is selected.
      </p>
      <CodeBlock
        code={`// What gets written on each route change
{
  "view": "inbox",
  "threadId": "thread-123",
  "focusedEmailId": "msg-456",
  "search": "budget",
  "label": "important"
}`}
        lang="json"
      />
      <p>What to include in navigation state:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <code>view</code> — the current page/section (e.g., "inbox",
          "form-builder", "dashboard")
        </li>
        <li>
          Item IDs — the selected/open item (e.g., <code>threadId</code>,{" "}
          <code>formId</code>)
        </li>
        <li>Filter state — active search, label, or category filters</li>
        <li>Any selection — focused item, selected text range, active tab</li>
      </ul>
      <p>The agent reads this before acting:</p>
      <CodeBlock
        code={`import { readAppState } from "@agent-native/core/application-state";

const navigation = await readAppState("navigation");
// { view: "inbox", threadId: "thread-123", label: "important" }`}
      />

      <h2 id="view-screen-script">The view-screen script</h2>
      <p>
        Every template should have a <code>view-screen</code> script. It reads
        navigation state, fetches the relevant data, and returns a snapshot of
        what the user sees. This is the agent's eyes.
      </p>
      <CodeBlock
        code={`// scripts/view-screen.ts
import { readAppState } from "@agent-native/core/application-state";

export default async function main() {
  const navigation = await readAppState("navigation");
  const screen: Record<string, unknown> = { navigation };

  // Fetch data based on what the user is viewing
  if (navigation?.view === "inbox") {
    const res = await fetch("http://localhost:3000/api/emails?label=" + navigation.label);
    screen.emailList = await res.json();
  }
  if (navigation?.threadId) {
    const res = await fetch("http://localhost:3000/api/threads/" + navigation.threadId);
    screen.thread = await res.json();
  }

  console.log(JSON.stringify(screen, null, 2));
}`}
      />
      <p>
        The agent should always call <code>pnpm script view-screen</code> before
        acting. This is a hard convention across all templates. When adding new
        features, update <code>view-screen</code> to return data for the new
        view.
      </p>

      <h2 id="navigate-script">The navigate script</h2>
      <p>
        The agent writes a one-shot <code>navigate</code> command to
        application-state. The UI reads it, performs the navigation, and deletes
        the entry.
      </p>
      <CodeBlock
        code={`// Agent side — write a navigate command
import { writeAppState } from "@agent-native/core/application-state";

await writeAppState("navigate", { view: "inbox", threadId: "thread-123" });`}
      />
      <p>The UI polls for this command and navigates when it appears:</p>
      <CodeBlock
        code={`// UI side — poll for navigate commands
const { data: navCommand } = useQuery({
  queryKey: ["navigate-command"],
  queryFn: async () => {
    const res = await fetch("/_agent-native/application-state/navigate");
    if (!res.ok) return null;
    const data = await res.json();
    if (data) {
      // Delete the one-shot command after reading
      fetch("/_agent-native/application-state/navigate", { method: "DELETE" });
      return data;
    }
    return null;
  },
  staleTime: 2_000,
});

useEffect(() => {
  if (navCommand) {
    router.navigate(buildPath(navCommand));
  }
}, [navCommand]);`}
      />
      <p>
        The <code>navigation</code> key belongs to the UI — the agent should
        never write to it directly. Instead, the agent writes to{" "}
        <code>navigate</code>, and the UI performs the actual navigation (which
        then updates <code>navigation</code>).
      </p>

      <h2 id="use-navigation-state">useNavigationState hook</h2>
      <p>
        The <code>use-navigation-state.ts</code> hook syncs routes to
        application-state on every navigation:
      </p>
      <CodeBlock
        code={`// app/hooks/use-navigation-state.ts
import { useEffect } from "react";
import { useLocation } from "react-router";

export function useNavigationState() {
  const location = useLocation();

  useEffect(() => {
    const state = deriveNavigationState(location.pathname);
    fetch("/_agent-native/application-state/navigation", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [location.pathname]);
}`}
      />
      <p>
        The <code>deriveNavigationState()</code> function is template-specific —
        it parses the URL path and extracts the view, item IDs, and filters
        relevant to your app.
      </p>

      <h2 id="jitter-prevention">Jitter prevention</h2>
      <p>
        When the agent writes to application-state, the polling system might
        cause the UI to refetch data it just wrote. This creates jitter. The
        solution is source tagging:
      </p>
      <CodeBlock
        code={`// app/root.tsx
import { TAB_ID } from "@/lib/tab-id";

useFileWatcher({
  queryClient,
  queryKeys: ["app-state", "settings"],
  ignoreSource: TAB_ID,  // ignore events from this tab's own writes
});`}
      />
      <p>How it works:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          Agent writes are tagged with <code>{'requestSource: "agent"'}</code>{" "}
          (the script helpers do this automatically)
        </li>
        <li>
          UI writes include the tab's unique ID via{" "}
          <code>X-Request-Source</code> header
        </li>
        <li>The server stores the source on each event</li>
        <li>
          When polling, the UI filters out events matching its own{" "}
          <code>ignoreSource</code> value — so it doesn't refetch data it just
          wrote
        </li>
        <li>
          Events from agents, other tabs, and scripts still come through
          normally
        </li>
      </ul>
    </DocsLayout>
  );
}
