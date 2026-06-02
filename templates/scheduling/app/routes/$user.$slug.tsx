import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  getEventTypeBySlug,
  resolveEventTypeSlug,
} from "@agent-native/scheduling/server";
import { Booker } from "@/components/booker/Booker";
import { buildSocialOgImageUrl, socialImageMeta } from "@/lib/social-og";

export async function loader({ params, request }: LoaderFunctionArgs) {
  const ownerEmail = params.user!;
  const slug = params.slug!;
  const eventType =
    (await getEventTypeBySlug({ ownerEmail, slug })) ??
    (await resolveEventTypeSlug({ ownerEmail, slug }));
  if (!eventType || eventType.hidden)
    throw new Response("Not found", { status: 404 });
  const name = ownerEmail.split("@")[0];
  const title = `${eventType.title} with ${name}`;
  return {
    eventType,
    ownerEmail,
    ogImageUrl: buildSocialOgImageUrl({
      request,
      title,
      subtitle: "Agent-Native Scheduling",
    }),
  };
}

export function meta({
  data,
}: {
  data?: {
    eventType: { title: string; description?: string | null };
    ownerEmail: string;
    ogImageUrl?: string;
  };
}) {
  if (!data) return [{ title: "Book a meeting" }];
  const name = data.ownerEmail.split("@")[0];
  const title = `${data.eventType.title} with ${name}`;
  return [
    { title },
    {
      name: "description",
      content: data.eventType.description || `Book a meeting with ${name}.`,
    },
    { property: "og:title", content: title },
    {
      property: "og:description",
      content: data.eventType.description || `Book a meeting with ${name}.`,
    },
    { property: "og:type", content: "website" },
    ...(data.ogImageUrl
      ? socialImageMeta(data.ogImageUrl, "Agent-Native Scheduling booking link")
      : []),
  ];
}

export default function BookerPage() {
  const { eventType, ownerEmail } = useLoaderData<typeof loader>();
  return (
    <div className="min-h-screen bg-background py-8">
      <Booker eventType={eventType} ownerEmail={ownerEmail} mode="page" />
    </div>
  );
}
