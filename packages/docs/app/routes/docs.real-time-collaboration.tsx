import DocsLayout from "../components/DocsLayout";
import CodeBlock from "../components/CodeBlock";

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "how-it-works", label: "How It Works" },
  { id: "agent-human-collab", label: "Agent + Human Collaboration" },
  { id: "enabling-collab", label: "Enabling Collaboration" },
  { id: "live-cursors", label: "Live Cursors & Presence" },
  { id: "comments", label: "Comments" },
  { id: "collab-routes", label: "Collab Routes" },
  { id: "edit-document", label: "Agent Edit Action" },
  { id: "pitfalls", label: "Common Pitfalls" },
];

export const meta = () => [
  { title: "Real-Time Collaboration — Agent-Native" },
  {
    name: "description",
    content:
      "Multi-user collaborative editing with Yjs CRDT, live cursors, and AI agent real-time edits.",
  },
];

export default function RealTimeCollaborationDocs() {
  return (
    <DocsLayout toc={TOC}>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">
        Real-Time Collaboration
      </h1>
      <p className="mb-4 text-base text-[var(--fg-secondary)]">
        Multi-user collaborative editing where the AI agent and human users are
        equal participants — like Google Docs, but with an AI collaborator.
      </p>

      <h2 id="overview">Overview</h2>
      <p>
        The framework provides a Yjs-based collaborative editing system in{" "}
        <code>@agent-native/core/collab</code>. Multiple users can edit the same
        document simultaneously with live cursor positions, and the AI agent can
        make surgical edits that appear in real-time without disrupting the
        user's cursor, selection, or undo history.
      </p>
      <p>
        This is built on three battle-tested technologies: <strong>Yjs</strong>{" "}
        (CRDT for conflict-free merging), <strong>TipTap</strong> (rich text
        editor), and <strong>polling-based sync</strong> (works in all
        deployment environments including serverless and edge).
      </p>

      <h2 id="how-it-works">How it works</h2>
      <p>The collaboration system has three layers:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>Yjs Y.Doc</strong> — stores the document as a{" "}
          <code>Y.XmlFragment</code> (ProseMirror node tree). This is the CRDT
          that enables conflict-free merging of concurrent edits.
        </li>
        <li>
          <strong>TipTap Collaboration extension</strong> — binds the editor to
          the Y.XmlFragment via <code>ySyncPlugin</code>. Remote changes are
          applied as minimal ProseMirror transactions that preserve cursor
          position.
        </li>
        <li>
          <strong>Polling sync</strong> — clients poll{" "}
          <code>/_agent-native/poll</code> every 2 seconds for Yjs updates.
          Awareness state (cursor positions, user info) is synced via a separate{" "}
          <code>/_agent-native/collab/:docId/awareness</code> endpoint.
        </li>
      </ul>
      <p>
        The Yjs state is persisted in a <code>_collab_docs</code> SQL table as
        base64-encoded binary, compatible with both SQLite and Postgres.
      </p>

      <h2 id="agent-human-collab">Agent + human collaboration</h2>
      <p>
        The agent and human users are equal participants in collaborative
        editing. The key insight is that both produce Yjs operations that merge
        cleanly:
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>Human edits</strong> flow through TipTap → ySyncPlugin →
          Y.XmlFragment → server via HTTP
        </li>
        <li>
          <strong>Agent edits</strong> flow through the{" "}
          <code>edit-document</code> action → server search-replace endpoint →
          Y.XmlFragment mutation → poll update → all clients
        </li>
      </ul>
      <p>
        The agent's <code>edit-document</code> action uses surgical
        search-and-replace on Y.XmlText nodes within the Y.XmlFragment tree.
        This produces the smallest possible Yjs update — only the changed text
        is modified, not the entire document. The result: the user sees the
        agent's change appear in their editor without losing their place.
      </p>
      <CodeBlock
        code={`# Agent makes a surgical edit — user sees it appear live
pnpm action edit-document --id doc123 --find "Big Projects" --replace "Proyectos Grandes"

# The action:
# 1. Updates SQL content column (for search/API compat)
# 2. Calls POST /_agent-native/collab/doc123/search-replace
# 3. Server walks Y.XmlFragment, finds text, modifies Y.XmlText node
# 4. Minimal Yjs update emitted via poll system
# 5. Client receives update → ySyncPlugin applies targeted PM transaction
# 6. User's cursor stays in place ✓`}
        lang="bash"
      />

      <h2 id="enabling-collab">Enabling collaboration</h2>
      <p>Templates opt into collaboration with five steps:</p>

      <h3>1. Install dependencies</h3>
      <CodeBlock
        code={`pnpm add @tiptap/extension-collaboration @tiptap/extension-collaboration-caret @tiptap/y-tiptap @tiptap/core`}
        lang="bash"
      />

      <h3>2. Add Vite optimizeDeps</h3>
      <p>
        Prevents Vite from re-bundling TipTap in incompatible ways during dev:
      </p>
      <CodeBlock
        code={`// vite.config.ts
export default defineConfig({
  plugins: [reactRouter()],
  optimizeDeps: {
    include: [
      "yjs", "y-protocols/awareness",
      "@tiptap/core", "@tiptap/extension-collaboration",
      "@tiptap/extension-collaboration-caret", "@tiptap/y-tiptap",
    ],
  },
});`}
        lang="typescript"
      />

      <h3>3. Add the collab server plugin</h3>
      <CodeBlock
        code={`// server/plugins/collab.ts
import { createCollabPlugin } from "@agent-native/core/server";

export default createCollabPlugin({
  table: "documents",
  contentColumn: "content",
  idColumn: "id",
  autoSeed: false, // Client-side seeding on first load
});`}
        lang="typescript"
      />

      <h3>4. Use the client hook</h3>
      <CodeBlock
        code={`import { useCollaborativeDoc, generateTabId } from "@agent-native/core/client";

const TAB_ID = generateTabId();

const { ydoc, awareness, isLoading, activeUsers } = useCollaborativeDoc({
  docId: documentId,
  requestSource: TAB_ID,
  user: { name: "Steve", email: "steve@example.com", color: "#60a5fa" },
});`}
        lang="typescript"
      />

      <h3>5. Add TipTap extensions</h3>
      <CodeBlock
        code={`import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { Awareness } from "y-protocols/awareness";

// Create awareness for cursor sync
const awareness = new Awareness(ydoc);
awareness.setLocalStateField("user", { name, color });

const editor = useEditor({
  extensions: [
    StarterKit.configure({ history: false }), // Yjs handles undo
    Collaboration.configure({ document: ydoc }),
    CollaborationCaret.configure({
      provider: { awareness },
      user: { name, color },
    }),
  ],
  content: initialContent,
});`}
        lang="typescript"
      />

      <h2 id="live-cursors">Live cursors & presence</h2>
      <p>
        The <code>CollaborationCaret</code> extension renders colored cursor
        lines with user name labels for each connected user. The{" "}
        <code>useCollaborativeDoc</code> hook provides an{" "}
        <code>activeUsers</code> array that can be used to render a presence bar
        with user avatars.
      </p>
      <p>
        User identity is derived from the session email. The framework provides{" "}
        <code>emailToColor()</code> and <code>emailToName()</code> helpers to
        generate consistent cursor colors and display names from email
        addresses.
      </p>

      <h2 id="comments">Comments</h2>
      <p>
        Templates can add a comments system with threaded discussions on
        documents. The content template includes a full implementation with:
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <code>document_comments</code> SQL table (threads, replies, resolved
          status)
        </li>
        <li>
          CRUD API routes at <code>/api/comments</code>
        </li>
        <li>Comments sidebar with threaded view and reply UI</li>
        <li>Resolve/unresolve threads</li>
        <li>
          <strong>Send to AI</strong> button — sends the comment thread context
          to the agent chat via <code>sendToAgentChat()</code>
        </li>
        <li>
          Agent actions: <code>list-comments</code>, <code>add-comment</code>
        </li>
        <li>
          Notion comment sync: <code>sync-notion-comments</code> action for
          bidirectional pull/push
        </li>
      </ul>

      <h2 id="collab-routes">Collab routes</h2>
      <p>
        All collab routes are auto-mounted under{" "}
        <code>/_agent-native/collab/</code> by the collab plugin:
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Route</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>GET /:docId/state</code>
              </td>
              <td>Fetch full Y.Doc state (base64)</td>
            </tr>
            <tr>
              <td>
                <code>POST /:docId/update</code>
              </td>
              <td>Apply client Yjs update</td>
            </tr>
            <tr>
              <td>
                <code>POST /:docId/text</code>
              </td>
              <td>Apply full text replacement (diff-based)</td>
            </tr>
            <tr>
              <td>
                <code>POST /:docId/search-replace</code>
              </td>
              <td>Surgical find/replace in Y.XmlFragment</td>
            </tr>
            <tr>
              <td>
                <code>POST /:docId/awareness</code>
              </td>
              <td>Sync cursor/presence state</td>
            </tr>
            <tr>
              <td>
                <code>GET /:docId/users</code>
              </td>
              <td>List active users on a document</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 id="edit-document">Agent edit action</h2>
      <p>
        The <code>edit-document</code> action is the primary way agents make
        changes to documents in collaborative mode:
      </p>
      <CodeBlock
        code={`# Single edit
pnpm action edit-document --id doc123 --find "old text" --replace "new text"

# Batch edits
pnpm action edit-document --id doc123 --edits '[{"find":"old","replace":"new"}]'

# Delete text
pnpm action edit-document --id doc123 --find "delete me" --replace ""`}
        lang="bash"
      />
      <p>
        When collab state exists for the document, the action calls the server's{" "}
        <code>search-replace</code> endpoint via HTTP (not the collab module
        directly, since actions run in a separate process). The server walks the
        Y.XmlFragment tree, finds the text in Y.XmlText nodes, and applies
        minimal delete/insert operations. The resulting Yjs update is broadcast
        to all connected clients via the poll system.
      </p>

      <h2 id="pitfalls">Common pitfalls</h2>
      <ul className="list-disc space-y-2 pl-5">
        <li>
          <strong>TipTap version mismatch</strong> — All <code>@tiptap/*</code>{" "}
          packages must be the same version. The Collaboration extension
          requires <code>editor.utils</code> which was added in v3.22.2. Add{" "}
          <code>@tiptap/core</code> as an explicit dependency.
        </li>
        <li>
          <strong>Empty editor on first load</strong> — The Collaboration
          extension does NOT auto-seed from the <code>content</code> prop. Seed
          manually with <code>editor.commands.setContent()</code> when the
          Y.XmlFragment is empty.
        </li>
        <li>
          <strong>Data loss from empty saves</strong> — Guard against saving
          empty content in the <code>onUpdate</code> handler when the editor is
          in collab mode but hasn't been seeded yet.
        </li>
        <li>
          <strong>Vite dep optimization</strong> — Always add Yjs-related
          packages to <code>optimizeDeps.include</code> to prevent Vite from
          re-bundling TipTap in incompatible ways.
        </li>
        <li>
          <strong>Separate process for actions</strong> — Actions run via{" "}
          <code>pnpm action</code> in a new Node.js process. Use the server's
          HTTP endpoints (not the collab module directly) so updates reach the
          poll system.
        </li>
      </ul>
    </DocsLayout>
  );
}
