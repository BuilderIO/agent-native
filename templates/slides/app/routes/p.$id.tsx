import SharedPresentation from "@/pages/SharedPresentation";
import { Spinner } from "@/components/ui/spinner";
import type { SharedDeckResponse } from "@shared/api";
import { and, eq } from "drizzle-orm";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getRequestUserEmail } from "@agent-native/core/server";
import { accessFilter } from "@agent-native/core/sharing";
import { getDb, schema } from "../../server/db";

type LoaderData =
  | { deck: SharedDeckResponse; error?: undefined }
  | { deck: null; error: string };

type DeckData = {
  title?: string;
  slides?: Array<{
    id?: string;
    content?: string;
    notes?: string;
    layout?: string;
    background?: string;
  }>;
  aspectRatio?: SharedDeckResponse["aspectRatio"];
};

function toSharedDeck(row: {
  title: string | null;
  data: string;
}): SharedDeckResponse {
  const data = JSON.parse(row.data) as DeckData;
  return {
    title: row.title || data.title || "Untitled",
    slides: Array.isArray(data.slides)
      ? data.slides.map((slide, index) => ({
          id: slide.id || `slide-${index + 1}`,
          content: slide.content || "",
          notes: "",
          layout: slide.layout || "content",
          background: slide.background,
        }))
      : [],
    aspectRatio: data.aspectRatio,
  };
}

export async function loader({
  params,
}: LoaderFunctionArgs): Promise<LoaderData> {
  const id = params.id;
  if (!id) throw new Response("Not found", { status: 404 });

  const db = getDb();
  if (getRequestUserEmail()) {
    const [directAccess] = await db
      .select({ id: schema.decks.id })
      .from(schema.decks)
      .where(
        and(
          eq(schema.decks.id, id),
          accessFilter(schema.decks, schema.deckShares),
        ),
      )
      .limit(1);
    if (directAccess) throw redirect(`/deck/${id}`);
  }

  const [deck] = await db
    .select({
      title: schema.decks.title,
      data: schema.decks.data,
    })
    .from(schema.decks)
    .where(and(eq(schema.decks.id, id), eq(schema.decks.visibility, "public")))
    .limit(1);

  if (!deck) throw new Response("Not found", { status: 404 });
  return { deck: toSharedDeck(deck) };
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const title = data?.deck?.title ?? "Shared Presentation";
  return [{ title }];
};

export function HydrateFallback() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-black">
      <Spinner className="size-8 text-white" />
    </div>
  );
}

export default function PublicDeckRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <SharedPresentation initialDeck={data.deck} initialError={data.error} />
  );
}
