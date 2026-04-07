import DocsLayout from "../components/DocsLayout";
import CodeBlock from "../components/CodeBlock";

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "better-auth", label: "Better Auth (Default)" },
  { id: "local-mode", label: "Local Mode" },
  { id: "social-providers", label: "Social Providers" },
  { id: "organizations", label: "Organizations" },
  { id: "access-tokens", label: "Access Tokens" },
  { id: "byoa", label: "Bring Your Own Auth" },
  { id: "session-api", label: "Session API" },
  { id: "environment-variables", label: "Environment Variables" },
];

export default function AuthenticationDocs() {
  return (
    <DocsLayout toc={TOC}>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">
        Authentication
      </h1>
      <p className="mb-4 text-base text-[var(--fg-secondary)]">
        Agent-native apps use{" "}
        <a
          href="https://better-auth.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          Better Auth
        </a>{" "}
        for authentication with an account-first design. Users create an account
        on first visit and get real identity from day one.
      </p>

      <h2 id="overview">Overview</h2>
      <p>
        Auth is configured automatically via <code>autoMountAuth(app)</code> in
        the auth server plugin. The behavior depends on your environment:
      </p>
      <ul>
        <li>
          <strong>Default:</strong> Better Auth with email/password + social
          providers. Onboarding page shown on first visit.
        </li>
        <li>
          <strong>
            <code>AUTH_MODE=local</code>:
          </strong>{" "}
          No auth. Solo local development with <code>local@localhost</code>{" "}
          identity.
        </li>
        <li>
          <strong>
            <code>ACCESS_TOKEN</code>:
          </strong>{" "}
          Simple shared token for production.
        </li>
        <li>
          <strong>Custom:</strong> Bring your own auth via{" "}
          <code>getSession</code> callback.
        </li>
      </ul>

      <h2 id="better-auth">Better Auth (Default)</h2>
      <p>
        When no <code>ACCESS_TOKEN</code> or <code>AUTH_MODE=local</code> is
        set, Better Auth powers authentication. It provides:
      </p>
      <ul>
        <li>Email/password registration and login</li>
        <li>Social providers (Google, GitHub, and 35+ others)</li>
        <li>Organizations with roles and invitations</li>
        <li>JWT tokens for API and A2A access</li>
        <li>Bearer token support for programmatic clients</li>
      </ul>
      <p>
        Better Auth routes are mounted at <code>/_agent-native/auth/ba/*</code>.
        The framework also provides backward-compatible endpoints:
      </p>
      <ul>
        <li>
          <code>GET /_agent-native/auth/session</code> &mdash; get current
          session
        </li>
        <li>
          <code>POST /_agent-native/auth/login</code> &mdash; email/password or
          token login
        </li>
        <li>
          <code>POST /_agent-native/auth/register</code> &mdash; create account
        </li>
        <li>
          <code>POST /_agent-native/auth/logout</code> &mdash; sign out
        </li>
      </ul>

      <h2 id="local-mode">Local Mode</h2>
      <p>
        For solo local development without auth, set{" "}
        <code>AUTH_MODE=local</code> in your <code>.env</code> file. This
        returns <code>{`{ email: "local@localhost" }`}</code> for all requests.
      </p>
      <p>
        You can also enable local mode from the onboarding page by clicking "Use
        locally without an account". This writes <code>AUTH_MODE=local</code> to
        your <code>.env</code> automatically.
      </p>
      <CodeBlock code={`# .env\nAUTH_MODE=local`} lang="bash" />
      <p>
        Local mode works in any environment (dev or production). To switch back
        to real auth, remove the line from <code>.env</code>.
      </p>

      <h2 id="social-providers">Social Providers</h2>
      <p>
        Set environment variables to enable social login. Better Auth
        auto-detects them:
      </p>
      <CodeBlock
        code={`# Google OAuth\nGOOGLE_CLIENT_ID=your-client-id\nGOOGLE_CLIENT_SECRET=your-client-secret\n\n# GitHub OAuth\nGITHUB_CLIENT_ID=your-client-id\nGITHUB_CLIENT_SECRET=your-client-secret`}
        lang="bash"
      />
      <p>
        Templates that use <code>createGoogleAuthPlugin()</code> show a "Sign in
        with Google" page. The Google OAuth callback handles mobile deep linking
        for native apps automatically.
      </p>

      <h2 id="organizations">Organizations</h2>
      <p>
        Better Auth's organization plugin is built into the framework. Every app
        supports:
      </p>
      <ul>
        <li>Creating organizations</li>
        <li>
          Inviting members with roles (<code>owner</code>, <code>admin</code>,{" "}
          <code>member</code>)
        </li>
        <li>Switching active organization</li>
        <li>
          Per-org data scoping via <code>org_id</code> columns
        </li>
      </ul>
      <p>
        The active organization flows automatically through the system:{" "}
        <code>session.orgId</code> &rarr; <code>AGENT_ORG_ID</code> &rarr; SQL
        scoping. See the{" "}
        <a href="/docs/security">Security &amp; Data Scoping</a> docs for
        details.
      </p>

      <h2 id="access-tokens">Access Tokens</h2>
      <p>
        For simple deployments, set <code>ACCESS_TOKEN</code> (single) or{" "}
        <code>ACCESS_TOKENS</code> (comma-separated) as environment variables:
      </p>
      <CodeBlock
        code={`# Single token\nACCESS_TOKEN=my-secret-token\n\n# Multiple tokens\nACCESS_TOKENS=token1,token2,token3`}
        lang="bash"
      />
      <p>
        When access tokens are configured, users see a token login page.
        Sessions are cookie-based with 30-day expiry.
      </p>

      <h2 id="byoa">Bring Your Own Auth</h2>
      <p>
        Pass a custom <code>getSession</code> callback to use any auth provider
        (Clerk, Auth0, Firebase, etc.):
      </p>
      <CodeBlock
        code={`// server/plugins/auth.ts
import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  getSession: async (event) => {
    // Your custom auth logic here
    const session = await myAuthProvider.verify(event);
    if (!session) return null;
    return { email: session.email };
  },
  publicPaths: ["/api/webhooks"],
});`}
        lang="typescript"
      />

      <h2 id="session-api">Session API</h2>
      <p>
        The session object returned by <code>getSession(event)</code> has this
        shape:
      </p>
      <CodeBlock
        code={`interface AuthSession {
  email: string;      // User's email (primary identifier)
  userId?: string;    // Better Auth user ID
  token?: string;     // Session token
  orgId?: string;     // Active organization ID
  orgRole?: string;   // Role in active org (owner/admin/member)
}`}
        lang="typescript"
      />
      <p>
        On the client, use the <code>useSession()</code> hook:
      </p>
      <CodeBlock
        code={`import { useSession } from "@agent-native/core/client";

function MyComponent() {
  const { session, isLoading } = useSession();
  if (isLoading) return <p>Loading...</p>;
  if (!session) return <p>Not signed in</p>;
  return <p>Hello, {session.email}</p>;
}`}
        lang="typescript"
      />

      <h2 id="environment-variables">Environment Variables</h2>
      <table>
        <thead>
          <tr>
            <th>Variable</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>AUTH_MODE</code>
            </td>
            <td>
              Set to <code>local</code> to disable auth
            </td>
          </tr>
          <tr>
            <td>
              <code>BETTER_AUTH_SECRET</code>
            </td>
            <td>Signing key for Better Auth (auto-generated if not set)</td>
          </tr>
          <tr>
            <td>
              <code>GOOGLE_CLIENT_ID</code>
            </td>
            <td>Enable Google OAuth</td>
          </tr>
          <tr>
            <td>
              <code>GOOGLE_CLIENT_SECRET</code>
            </td>
            <td>Google OAuth secret</td>
          </tr>
          <tr>
            <td>
              <code>GITHUB_CLIENT_ID</code>
            </td>
            <td>Enable GitHub OAuth</td>
          </tr>
          <tr>
            <td>
              <code>GITHUB_CLIENT_SECRET</code>
            </td>
            <td>GitHub OAuth secret</td>
          </tr>
          <tr>
            <td>
              <code>ACCESS_TOKEN</code>
            </td>
            <td>Simple shared token auth</td>
          </tr>
          <tr>
            <td>
              <code>ACCESS_TOKENS</code>
            </td>
            <td>Comma-separated shared tokens</td>
          </tr>
          <tr>
            <td>
              <code>AUTH_DISABLED</code>
            </td>
            <td>
              Set to <code>true</code> to skip auth (infrastructure-level auth)
            </td>
          </tr>
          <tr>
            <td>
              <code>A2A_SECRET</code>
            </td>
            <td>
              Shared secret for JWT-signed A2A cross-app identity verification
            </td>
          </tr>
        </tbody>
      </table>
    </DocsLayout>
  );
}
