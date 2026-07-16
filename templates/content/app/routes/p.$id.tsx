import {
  setClientAppState,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
import { getConfiguredAppBasePath } from "@agent-native/core/server";
import {
  AGENT_READABLE_RESOURCE_SCRIPT_TYPE,
  safeJsonForHtml,
} from "@agent-native/core/shared";
import { IconLock, IconMessageCircle } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

import { VisualEditor } from "@/components/editor/VisualEditor";

import {
  buildContentDocumentAgentDiscovery,
  buildContentPublicDocumentUrl,
} from "../../shared/agent-readable";

type PublicDocumentLoaderData = { id: string; basePath: string };

export async function loader({ params }: LoaderFunctionArgs) {
  const id = params.id;
  if (!id) throw new Response("Not found", { status: 404 });
  // SSR and .data must remain an impersonal, content-free cacheable shell.
  // The browser calls the no-store public-document action after hydration.
  return {
    id,
    basePath: getConfiguredAppBasePath(),
  } satisfies PublicDocumentLoaderData;
}

export const meta: MetaFunction<typeof loader> = () => [
  { title: "Public document" },
];

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function renderMarkdownBlocks(content: string) {
  return content.split(/\n{2,}/).map((block, index) => {
    const trimmed = block.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("## ")) {
      return (
        <h2 key={index} className="mt-8 text-xl font-semibold text-foreground">
          {trimmed.slice(3)}
        </h2>
      );
    }
    if (trimmed.startsWith("- ")) {
      return (
        <ul
          key={index}
          className="mt-4 list-disc space-y-2 pl-6 text-base leading-7 text-muted-foreground"
        >
          {trimmed.split("\n").map((item) => (
            <li key={item}>{item.replace(/^- /, "")}</li>
          ))}
        </ul>
      );
    }
    return (
      <p
        key={index}
        className="mt-4 whitespace-pre-wrap text-base leading-7 text-muted-foreground"
      >
        {trimmed}
      </p>
    );
  });
}

function PublicDocumentContextSync({
  document,
  basePath,
}: {
  document: {
    id: string;
    title: string;
    content: string;
    updatedAt: string;
  };
  basePath?: string;
}) {
  useEffect(() => {
    void setClientAppState(
      "navigation",
      {
        view: "public-document",
        documentId: document.id,
        title: document.title,
        publicUrl: buildContentPublicDocumentUrl(document.id, { basePath }),
      },
      { keepalive: true },
    ).catch(() => {});
  }, [basePath, document.id, document.title]);

  return null;
}

function ReadOnlyMarkdownContent({ content }: { content: string }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="notion-editor">{renderMarkdownBlocks(content)}</div>;
  }

  return (
    <VisualEditor content={content} onChange={() => {}} editable={false} />
  );
}

function AgentReadableDocumentDiscovery({
  document,
  token,
  basePath,
}: {
  document: { id: string; title: string };
  token?: string | null;
  basePath?: string;
}) {
  const discovery = buildContentDocumentAgentDiscovery({
    document,
    token,
    basePath,
  });
  return (
    <script
      type={AGENT_READABLE_RESOURCE_SCRIPT_TYPE}
      dangerouslySetInnerHTML={{ __html: safeJsonForHtml(discovery) }}
    />
  );
}

function PrivateDocumentNotice({
  id,
  basePath,
}: {
  id?: string;
  basePath?: string;
}) {
  const t = useT();
  useEffect(() => {
    if (!id) return;
    // The SSR loader can't see the viewer's session (SSR is impersonal so the
    // page stays CDN-cacheable). Resolve access on the client by sending the
    // viewer to the auth-guarded `/page/<id>` editor: a signed-in viewer with
    // access lands on the document, and everyone else gets the standard
    // sign-in / no-access handling there. This never loops back here because
    // `/page/<id>` is guard-protected and does not redirect to `/p/<id>`.
    window.location.replace(`${basePath ?? ""}/page/${id}`);
  }, [id, basePath]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground">
          <IconLock size={22} />
        </div>
        <h1 className="text-2xl font-semibold tracking-normal">
          {t("publicDocument.privateTitle")}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {t("publicDocument.privateDescription")}
        </p>
      </section>
    </main>
  );
}

export default function PublicDocumentPage() {
  const t = useT();
  const { id, basePath } = useLoaderData<typeof loader>();
  const [token, setToken] = useState<string | undefined>();
  const [tokenReady, setTokenReady] = useState(false);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setToken(query.get("agent_access") ?? undefined);
    setTokenReady(true);
  }, []);

  const documentQuery = useActionQuery(
    "get-public-document",
    tokenReady ? { id, agent_access: token } : undefined,
    { enabled: tokenReady, retry: false },
  );
  const document = documentQuery.data;

  if (tokenReady && documentQuery.isError) {
    return <PrivateDocumentNotice id={id} basePath={basePath} />;
  }

  if (!document) return null;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <PublicDocumentContextSync document={document} basePath={basePath} />
      <AgentReadableDocumentDiscovery
        document={document}
        token={token}
        basePath={basePath}
      />
      <div className="mx-auto flex max-w-3xl justify-end px-6 pt-5 sm:px-8">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("agent-panel:toggle"))}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground shadow-sm hover:bg-accent"
        >
          <IconMessageCircle size={16} />
          {t("publicDocument.chat")}
        </button>
      </div>
      <article className="mx-auto max-w-3xl px-6 pb-16 pt-8 sm:px-8 lg:pb-24">
        <p className="text-sm text-muted-foreground">
          {t("publicDocument.updated", {
            date: formatUpdatedAt(document.updatedAt),
          })}
        </p>
        <h1 className="mt-3 break-words text-4xl font-semibold tracking-normal text-foreground sm:text-5xl">
          {document.title}
        </h1>
        <div className="mt-8 border-t border-border pt-4">
          <ReadOnlyMarkdownContent content={document.content} />
        </div>
      </article>
    </main>
  );
}
