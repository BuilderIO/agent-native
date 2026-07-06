import { agentNativePath, useT } from "@agent-native/core/client";
import {
  AGENT_ACCESS_PARAM,
  verifyScopedAgentAccessToken,
} from "@agent-native/core/server";
import {
  getConfiguredAppBasePath,
  getRequestUserEmail,
} from "@agent-native/core/server";
import {
  AGENT_READABLE_RESOURCE_SCRIPT_TYPE,
  safeJsonForHtml,
} from "@agent-native/core/shared";
import { resolveAccess } from "@agent-native/core/sharing";
import { buildPublicDocumentDescription } from "@shared/og-description";
import { IconLock, IconMessageCircle } from "@tabler/icons-react";
import { eq } from "drizzle-orm";
import { useEffect, useState } from "react";
import type {
  HeadersArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { data, redirect, useLoaderData } from "react-router";

import { VisualEditor } from "@/components/editor/VisualEditor";

import { getDb, schema } from "../../server/db";
import {
  buildContentDocumentAgentDiscovery,
  buildContentPublicDocumentUrl,
  DOCUMENT_AGENT_RESOURCE_KIND,
} from "../../shared/agent-readable";

type PublicDocumentLoaderData =
  | {
      document: {
        id: string;
        title: string;
        content: string;
        updatedAt: string;
        visibility: string;
      };
      agentAccessToken: string | null;
      basePath: string;
      unavailable?: undefined;
    }
  | {
      document: null;
      agentAccessToken: null;
      basePath: string;
      unavailable: { reason: "private"; id: string; basePath: string };
    };

const PRIVATE_AGENT_DOCUMENT_HEADERS = {
  "Cache-Control": "private, max-age=0, no-store",
  "Referrer-Policy": "no-referrer",
};

function publicDocumentLoaderData(
  payload: PublicDocumentLoaderData,
  privateAgentAccess = false,
) {
  if (!privateAgentAccess) return payload;
  return data(payload, {
    headers: PRIVATE_AGENT_DOCUMENT_HEADERS,
  });
}

export function headers({ loaderHeaders }: HeadersArgs) {
  return loaderHeaders;
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  const id = params.id;
  if (!id) throw new Response("Not found", { status: 404 });
  const agentAccessToken = new URL(request.url).searchParams.get(
    AGENT_ACCESS_PARAM,
  );

  // This is a server loader; use the server-side base-path helper
  // (reads APP_BASE_PATH / VITE_APP_BASE_PATH at request time)
  // instead of the client `appPath()` which relies on
  // `import.meta.env` and is meant for browser code.
  const basePath = getConfiguredAppBasePath();
  const withBase = (path: string) => `${basePath}${path}`;

  const userEmail = getRequestUserEmail();
  if (userEmail) {
    const access = await resolveAccess("document", id);
    if (access) throw redirect(withBase(`/page/${id}`));
  }

  const [doc] = await getDb()
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      content: schema.documents.content,
      updatedAt: schema.documents.updatedAt,
      visibility: schema.documents.visibility,
    })
    .from(schema.documents)
    .where(eq(schema.documents.id, id))
    .limit(1);

  if (!doc) throw new Response("Not found", { status: 404 });
  const tokenAccess = agentAccessToken
    ? verifyScopedAgentAccessToken(agentAccessToken, {
        resourceKind: DOCUMENT_AGENT_RESOURCE_KIND,
        resourceId: id,
      }).ok
    : false;
  if (doc.visibility === "public" || tokenAccess) {
    return publicDocumentLoaderData(
      {
        document: doc,
        agentAccessToken: tokenAccess ? agentAccessToken : null,
        basePath,
      },
      tokenAccess,
    );
  }

  // Doc exists but isn't public. SSR renders impersonally (no session is read
  // server-side, so the page can be CDN-cached for everyone), which means we
  // must NOT redirect to sign-in from here: a signed-in viewer would loop
  // (sign-in sees their valid session and bounces back to /p/<id>, which
  // re-runs this anonymous loader and redirects again). Instead return the
  // private placeholder and resolve access on the client — PrivateDocumentNotice
  // routes the viewer to the auth-guarded `/page/<id>` editor, where the real
  // per-user access check runs (signed-in-with-access sees the doc; everyone
  // else gets the standard sign-in / no-access handling).
  return publicDocumentLoaderData({
    document: null,
    agentAccessToken: null,
    basePath,
    unavailable: { reason: "private" as const, id, basePath },
  });
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  const title = loaderData?.document?.title ?? "Public document";
  const description = buildPublicDocumentDescription({
    title,
    content: loaderData?.document?.content,
  });
  return [
    { title },
    {
      name: "description",
      content: description,
    },
    {
      property: "og:title",
      content: title,
    },
    {
      property: "og:description",
      content: description,
    },
    {
      name: "twitter:title",
      content: title,
    },
    {
      name: "twitter:description",
      content: description,
    },
  ];
};

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
    fetch(agentNativePath("/_agent-native/application-state/navigation"), {
      method: "PUT",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        view: "public-document",
        documentId: document.id,
        title: document.title,
        publicUrl: buildContentPublicDocumentUrl(document.id, { basePath }),
      }),
    }).catch(() => {});
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
  const data = useLoaderData<typeof loader>();
  const document = data.document;

  if (!document) {
    return (
      <PrivateDocumentNotice
        id={data.unavailable?.id}
        basePath={data.unavailable?.basePath}
      />
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <PublicDocumentContextSync document={document} basePath={data.basePath} />
      <AgentReadableDocumentDiscovery
        document={document}
        token={data.agentAccessToken}
        basePath={data.basePath}
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
