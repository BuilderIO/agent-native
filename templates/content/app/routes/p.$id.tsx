import { agentNativePath } from "@agent-native/core/client/api-path";
import { getBrowserTabId, useSession } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { serializeIconValue } from "@agent-native/core/icons";
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
  SSR_MAX_AGE_HEADER,
  SSR_QUERY_CACHE_KEY_HEADER,
  buildResourceSocialMeta,
  safeJsonForHtml,
} from "@agent-native/core/shared";
import { resolveAccess } from "@agent-native/core/sharing";
import { BlockRegistryProvider } from "@agent-native/toolkit/app/blocks";
import type { ContentLinkTarget } from "@shared/api";
import {
  CLIP_EMBED_BLOCK_TYPE,
  clipEmbedRecordingIdFromRaw,
} from "@shared/clip-embed-block";
import { nfmToDoc, type PMNode } from "@shared/nfm";
import { registryBlockSpecByType } from "@shared/nfm-registry";
import { buildPublicDocumentDescription } from "@shared/og-description";
import type { PublicReaderContext } from "@shared/public-reader";
import { IconLock } from "@tabler/icons-react";
import { and, eq, isNull } from "drizzle-orm";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  HeadersArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { data, redirect, useLoaderData } from "react-router";

import { publicContentBlockRegistry } from "@/blocks/publicBlockRegistry";
import { ContentErrorBoundaryBody } from "@/components/ContentErrorBoundary";
import { clipShareUrl } from "@/components/editor/clip-embed/use-clips-links";
import { VisualEditor } from "@/components/editor/VisualEditor";
import { PublicReader } from "@/components/public-reader/PublicReader";
import {
  HIDDEN_WHILE_PRIVATE_LINK_REDIRECTS,
  privateDocumentRedirectHref,
  privateDocumentRedirectScript,
  privateLinkRedirectStarted,
} from "@/lib/private-link-redirect";

import { getDb, schema } from "../../server/db";
import { resolveClipsAppUrl } from "../../server/lib/clips-peer";
import { loadPublicReaderContext } from "../../server/lib/public-reader";
import {
  buildContentDocumentAgentDiscovery,
  contentDocumentMcpInstructionText,
  buildContentPublicDocumentPath,
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
      reader: PublicReaderContext;
      agentAccessToken: string | null;
      basePath: string;
      origin: string;
      clipsAppUrl: string | null;
      unavailable?: undefined;
    }
  | {
      document: null;
      reader?: undefined;
      agentAccessToken: null;
      basePath: string;
      origin: string;
      clipsAppUrl?: undefined;
      unavailable: { reason: "private"; id: string; basePath: string };
    };

// A public page can be edited, made private or moved to Trash at any moment,
// and every answer here is cached for all visitors, so none is kept longer
// than this. Readers see a change within twice this, well under a minute.
export const PUBLIC_DOCUMENT_CACHE_SECONDS = 20;

const PUBLIC_DOCUMENT_HEADERS = {
  [SSR_MAX_AGE_HEADER]: String(PUBLIC_DOCUMENT_CACHE_SECONDS),
};

const PRIVATE_AGENT_DOCUMENT_HEADERS = {
  "Cache-Control": "private, max-age=0, no-store",
  "Referrer-Policy": "no-referrer",
  [SSR_QUERY_CACHE_KEY_HEADER]: "query",
  [SSR_MAX_AGE_HEADER]: "0",
};

function publicDocumentLoaderData(
  payload: PublicDocumentLoaderData,
  privateAgentAccess = false,
) {
  return data(payload, {
    headers: privateAgentAccess
      ? PRIVATE_AGENT_DOCUMENT_HEADERS
      : PUBLIC_DOCUMENT_HEADERS,
  });
}

// Every answer keeps the short window, including a thrown not-found, which
// arrives here as errorHeaders; an answer that asked for less keeps its own.
export function headers({ loaderHeaders, errorHeaders }: HeadersArgs) {
  const answer = new Headers(errorHeaders ?? loaderHeaders);
  if (!answer.has(SSR_MAX_AGE_HEADER)) {
    answer.set(SSR_MAX_AGE_HEADER, String(PUBLIC_DOCUMENT_CACHE_SECONDS));
  }
  return answer;
}

// React Router calls only the catching route's headers for a thrown answer,
// so this route catches its own not-found to keep the short cache window.
export function ErrorBoundary() {
  return <ContentErrorBoundaryBody />;
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  const id = params.id;
  if (!id) throw new Response("Not found", { status: 404 });
  const agentAccessToken = new URL(request.url).searchParams.get(
    AGENT_ACCESS_PARAM,
  );
  const origin = new URL(request.url).origin;

  const basePath = getConfiguredAppBasePath();
  const withBase = (path: string) => `${basePath}${path}`;

  const userEmail = getRequestUserEmail();
  if (userEmail) {
    const access = await resolveAccess("document", id);
    if (access) throw redirect(withBase(`/page/${encodeURIComponent(id)}`));
  }

  const [doc] = await getDb()
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      content: schema.documents.content,
      updatedAt: schema.documents.updatedAt,
      visibility: schema.documents.visibility,
      parentId: schema.documents.parentId,
      icon: schema.documents.icon,
      ownerEmail: schema.documents.ownerEmail,
    })
    .from(schema.documents)
    .where(and(eq(schema.documents.id, id), isNull(schema.documents.trashedAt)))
    .limit(1);

  if (!doc) throw new Response("Not found", { status: 404 });
  const tokenAccess = agentAccessToken
    ? verifyScopedAgentAccessToken(agentAccessToken, {
        resourceKind: DOCUMENT_AGENT_RESOURCE_KIND,
        resourceId: id,
      }).ok
    : false;
  if (doc.visibility === "public" || tokenAccess) {
    const { parentId, icon, ownerEmail, ...page } = doc;
    return publicDocumentLoaderData(
      {
        document: page,
        reader: await loadPublicReaderContext({
          id: doc.id,
          parentId,
          icon,
          content: doc.content,
          ownerEmail,
        }),
        agentAccessToken: tokenAccess ? agentAccessToken : null,
        basePath,
        origin,
        clipsAppUrl: resolveClipsAppUrl(),
      },
      tokenAccess,
    );
  }

  return publicDocumentLoaderData({
    document: null,
    agentAccessToken: null,
    basePath,
    origin,
    unavailable: { reason: "private" as const, id, basePath },
  });
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  const title = loaderData?.document?.title ?? "Public document";
  const description = buildPublicDocumentDescription({
    title,
    content: loaderData?.document?.content,
  });
  const documentId = loaderData?.document?.id ?? loaderData?.unavailable?.id;
  const discovery = documentId
    ? buildContentDocumentAgentDiscovery({
        document: {
          id: documentId,
          title: loaderData?.document?.title,
        },
        token: loaderData?.agentAccessToken,
        basePath: loaderData?.basePath,
        origin: loaderData?.origin,
        accessState: loaderData?.unavailable
          ? "authentication-required"
          : loaderData?.document?.visibility === "public"
            ? "public"
            : "authorized",
      })
    : null;
  const socialMeta =
    loaderData?.document?.visibility === "public"
      ? buildResourceSocialMeta({
          title,
          description,
          origin: loaderData.origin,
          basePath: loaderData.basePath,
        })
      : [
          { name: "description", content: description },
          { property: "og:title", content: title },
          { property: "og:description", content: description },
          { name: "twitter:title", content: title },
          { name: "twitter:description", content: description },
        ];
  return [
    { title },
    ...socialMeta,
    ...(discovery
      ? [
          {
            tagName: "link" as const,
            rel: "alternate",
            type: "application/agent-native+json",
            href: discovery.contextUrl,
            title: "Agent-readable Content document", // i18n-ignore -- machine-readable alternate-link metadata, not UI copy.
          },
        ]
      : []),
  ];
};

function textOf(node: PMNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map(textOf).join("");
}

function savedText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * A registry block before the editor mounts. This HTML is the one public
 * shell every visitor gets, so it is named from the block's saved source and
 * deployment config only, never from a call to Clips or anything a reader's
 * session decides.
 */
function RegistryBlockFallback({
  node,
  clipsAppUrl,
}: {
  node: PMNode;
  clipsAppUrl: string | null;
}) {
  const t = useT();
  const blockType = String(node.attrs?.blockType ?? "");
  const title = savedText(node.attrs?.title);
  const summary = savedText(node.attrs?.summary);
  const recordingId =
    blockType === CLIP_EMBED_BLOCK_TYPE
      ? clipEmbedRecordingIdFromRaw(node.attrs?.__raw)
      : null;
  const name = title ?? registryBlockSpecByType(blockType)?.label ?? blockType;
  return (
    <div className="mt-4 rounded-md border border-border px-3 py-2 text-base leading-7 text-muted-foreground">
      {recordingId && clipsAppUrl ? (
        <a
          href={clipShareUrl(clipsAppUrl, recordingId)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground underline underline-offset-4"
        >
          {title ?? t("clipEmbed.openInClips")}
        </a>
      ) : (
        <span>{name}</span>
      )}
      {summary ? <p className="text-sm leading-6">{summary}</p> : null}
    </div>
  );
}

/**
 * The page as plain elements, for the server and the first client render.
 * The editor's own static body draws into the DOM, so it has nothing to send.
 */
function ServerRenderedBody({
  content,
  clipsAppUrl,
}: {
  content: string;
  clipsAppUrl: string | null;
}) {
  return nfmToDoc(content).content.map((node, index) => {
    switch (node.type) {
      case "registryBlock":
        return (
          <RegistryBlockFallback
            key={index}
            node={node}
            clipsAppUrl={clipsAppUrl}
          />
        );
      case "heading":
        return (
          <h2
            key={index}
            className="mt-8 text-xl font-semibold text-foreground"
          >
            {textOf(node)}
          </h2>
        );
      case "bulletList":
      case "orderedList":
      case "taskList": {
        const List = node.type === "orderedList" ? "ol" : "ul";
        return (
          <List
            key={index}
            className={`mt-4 ${node.type === "orderedList" ? "list-decimal" : "list-disc"} space-y-2 pl-6 text-base leading-7 text-muted-foreground`}
          >
            {(node.content ?? []).map((item, itemIndex) => (
              <li key={itemIndex}>{textOf(item)}</li>
            ))}
          </List>
        );
      }
      default: {
        const text = textOf(node);
        if (!text.trim()) return null;
        return (
          <p
            key={index}
            className="mt-4 whitespace-pre-wrap text-base leading-7 text-muted-foreground"
          >
            {text}
          </p>
        );
      }
    }
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
    fetch(
      agentNativePath(
        `/_agent-native/application-state/navigation:${getBrowserTabId()}`,
      ),
      {
        method: "PUT",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          view: "public-document",
          documentId: document.id,
          title: document.title,
          publicUrl: buildContentPublicDocumentUrl(document.id, { basePath }),
        }),
      },
    ).catch(() => {});
  }, [basePath, document.id, document.title]);

  return null;
}

export function ReadOnlyMarkdownContent({
  documentId,
  content,
  clipsAppUrl,
  pageLinks,
  basePath,
}: {
  documentId: string;
  content: string;
  clipsAppUrl: string | null;
  pageLinks: PublicReaderContext["pageLinks"];
  basePath: string;
}) {
  const [mounted, setMounted] = useState(false);
  const blockContext = useMemo(
    () => ({ dialect: "nfm" as const, documentId, canEdit: false }),
    [documentId],
  );
  // Page blocks open the public copy of their page, from the targets the
  // page loaded with; a reader without an account can't look them up.
  const resolvePageLink = useMemo(() => {
    const targets = new Map(Object.entries(pageLinks));
    return (id: string): ContentLinkTarget | null => {
      const page = targets.get(id);
      return page
        ? {
            documentId: page.id,
            title: page.title,
            icon: serializeIconValue(page.icon),
          }
        : null;
    };
  }, [pageLinks]);
  const openPageLink = useCallback(
    (id: string) => {
      window.location.assign(
        `${basePath}${buildContentPublicDocumentPath(id)}`,
      );
    },
    [basePath],
  );

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div className="content-editor">
        <ServerRenderedBody content={content} clipsAppUrl={clipsAppUrl} />
      </div>
    );
  }

  return (
    <BlockRegistryProvider
      registry={publicContentBlockRegistry}
      ctx={blockContext}
    >
      <VisualEditor
        content={content}
        onChange={() => {}}
        editable={false}
        onOpenNotionPageLink={openPageLink}
        resolveNotionPageLink={resolvePageLink}
      />
    </BlockRegistryProvider>
  );
}

export function AgentReadableDocumentDiscovery({
  document,
  token,
  basePath,
  origin,
  accessState,
}: {
  document: { id: string; title?: string };
  token?: string | null;
  basePath?: string;
  origin?: string;
  accessState: "public" | "authorized" | "authentication-required";
}) {
  const discovery = buildContentDocumentAgentDiscovery({
    document,
    token,
    basePath,
    origin,
    accessState,
  });
  return (
    <>
      <script
        type={AGENT_READABLE_RESOURCE_SCRIPT_TYPE}
        dangerouslySetInnerHTML={{ __html: safeJsonForHtml(discovery) }}
      />
      <div className="hidden" aria-hidden="true">
        {contentDocumentMcpInstructionText(document.id, {
          basePath,
          origin,
          accessState,
        })}
      </div>
    </>
  );
}

function PrivateDocumentNotice({
  id,
  basePath,
  origin,
}: {
  id?: string;
  basePath?: string;
  origin?: string;
}) {
  const t = useT();
  const pageHref = id
    ? `${basePath ?? ""}/page/${encodeURIComponent(id)}`
    : null;
  useEffect(() => {
    if (!pageHref || privateLinkRedirectStarted()) return;
    window.location.replace(
      privateDocumentRedirectHref(pageHref, basePath ?? ""),
    );
  }, [pageHref, basePath]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      {pageHref ? (
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: privateDocumentRedirectScript(pageHref, basePath ?? ""),
          }}
        />
      ) : null}
      {id ? (
        <AgentReadableDocumentDiscovery
          document={{ id }}
          basePath={basePath}
          origin={origin}
          accessState="authentication-required"
        />
      ) : null}
      <section
        className={`mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center ${HIDDEN_WHILE_PRIVATE_LINK_REDIRECTS}`}
      >
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
  const data = useLoaderData<typeof loader>();
  const { status } = useSession();
  const document = data.document;
  // Chat and the agent's view of this page are for signed-in readers: a
  // visitor without an account has no model to chat with.
  const signedIn = status === "authenticated";

  if (!document) {
    return (
      <PrivateDocumentNotice
        id={data.unavailable?.id}
        basePath={data.unavailable?.basePath}
        origin={data.origin}
      />
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      {signedIn ? (
        <PublicDocumentContextSync
          document={document}
          basePath={data.basePath}
        />
      ) : null}
      <AgentReadableDocumentDiscovery
        document={document}
        token={data.agentAccessToken}
        basePath={data.basePath}
        origin={data.origin}
        accessState={document.visibility === "public" ? "public" : "authorized"}
      />
      <PublicReader
        document={document}
        reader={data.reader}
        basePath={data.basePath}
        signedIn={signedIn}
      >
        <ReadOnlyMarkdownContent
          documentId={document.id}
          content={document.content}
          clipsAppUrl={data.clipsAppUrl ?? null}
          pageLinks={data.reader.pageLinks}
          basePath={data.basePath}
        />
      </PublicReader>
    </main>
  );
}
