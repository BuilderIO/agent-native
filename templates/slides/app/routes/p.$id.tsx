import SharedPresentation from "@/pages/SharedPresentation";
import { Spinner } from "@/components/ui/spinner";
import type { SharedDeckResponse } from "@shared/api";
import { and, eq, or } from "drizzle-orm";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
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

  // Mirror Google Slides: access is checked on the deck, not on the URL shape.
  // `/p/<id>` (presentation) and `/deck/<id>` (editor) share the same access
  // rules. Anyone with at least viewer access — owner, explicit share grant,
  // org visibility for an org member, or public visibility — can open the
  // presentation. Earlier behavior gated `/p/<id>` on `visibility = "public"`,
  // which 404'd shared admins and broke the share-link copy flow.
  const db = getDb();
  const userEmail = getRequestUserEmail();
  const where = userEmail
    ? and(
        eq(schema.decks.id, id),
        or(
          accessFilter(schema.decks, schema.deckShares),
          eq(schema.decks.visibility, "public"),
        ),
      )
    : and(eq(schema.decks.id, id), eq(schema.decks.visibility, "public"));

  const [deck] = await db
    .select({
      title: schema.decks.title,
      data: schema.decks.data,
    })
    .from(schema.decks)
    .where(where)
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
