import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../../server/db";

export async function loader({ params }: LoaderFunctionArgs) {
  const id = params.id;
  if (!id) throw new Response("Not found", { status: 404 });

  const [doc] = await getDb()
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      content: schema.documents.content,
      updatedAt: schema.documents.updatedAt,
    })
    .from(schema.documents)
    .where(
      and(eq(schema.documents.id, id), eq(schema.documents.visibility, "public")),
    )
    .limit(1);

  if (!doc) throw new Response("Not found", { status: 404 });
  return { document: doc };
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const title = data?.document?.title ?? "Public document";
  return [
    { title },
    {
      name: "description",
      content: data?.document?.content?.slice(0, 160) ?? "",
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
        <h2 key={index} className="mt-8 text-xl font-semibold text-zinc-950">
          {trimmed.slice(3)}
        </h2>
      );
    }
    if (trimmed.startsWith("- ")) {
      return (
        <ul
          key={index}
          className="mt-4 list-disc space-y-2 pl-6 text-base leading-7 text-zinc-700"
        >
          {trimmed.split("\n").map((item) => (
            <li key={item}>{item.replace(/^- /, "")}</li>
          ))}
        </ul>
      );
    }
    return (
      <p key={index} className="mt-4 whitespace-pre-wrap text-base leading-7 text-zinc-700">
        {trimmed}
      </p>
    );
  });
}

export default function PublicDocumentPage() {
  const { document } = useLoaderData<typeof loader>();

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <article className="mx-auto max-w-3xl px-6 py-14 sm:px-8 lg:py-20">
        <p className="text-sm text-zinc-500">
          Updated {formatUpdatedAt(document.updatedAt)}
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-normal text-zinc-950 sm:text-5xl">
          {document.title}
        </h1>
        <div className="mt-8 border-t border-zinc-200 pt-4">
          {renderMarkdownBlocks(document.content)}
        </div>
      </article>
    </main>
  );
}
