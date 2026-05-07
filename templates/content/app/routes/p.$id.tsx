import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../../server/db";
import { useEffect, useState } from "react";
import { IconMessageCircle } from "@tabler/icons-react";
import { agentNativePath } from "@agent-native/core/client";
import { getRequestUserEmail } from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import { VisualEditor } from "@/components/editor/VisualEditor";
import { buildPublicDocumentDescription } from "@shared/og-description";

export async function loader({ params }: LoaderFunctionArgs) {
  const id = params.id;
  if (!id) throw new Response("Not found", { status: 404 });

  if (getRequestUserEmail()) {
    const access = await resolveAccess("document", id);
    if (access) throw redirect(`/page/${id}`);
  }

  const [doc] = await getDb()
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      content: schema.documents.content,
      updatedAt: schema.documents.updatedAt,
    })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, id),
        eq(schema.documents.visibility, "public"),
      ),
    )
    .limit(1);

  if (!doc) throw new Response("Not found", { status: 404 });
  return { document: doc };
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const title = data?.document?.title ?? "Public document";
  const description = buildPublicDocumentDescription({
    title,
    content: data?.document?.content,
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
}: {
  document: {
    id: string;
    title: string;
    content: string;
    updatedAt: string;
  };
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
        publicUrl: `/p/${document.id}`,
      }),
    }).catch(() => {});
  }, [document.id, document.title]);

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

export default function PublicDocumentPage() {
  const { document } = useLoaderData<typeof loader>();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <PublicDocumentContextSync document={document} />
      <div className="mx-auto flex max-w-3xl justify-end px-6 pt-5 sm:px-8">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("agent-panel:toggle"))}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground shadow-sm hover:bg-accent"
        >
          <IconMessageCircle size={16} />
          Chat
        </button>
      </div>
      <article className="mx-auto max-w-3xl px-6 pb-16 pt-8 sm:px-8 lg:pb-24">
        <p className="text-sm text-muted-foreground">
          Updated {formatUpdatedAt(document.updatedAt)}
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
