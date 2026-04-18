import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getEventTypeBySlug } from "@agent-native/scheduling/server";
import { Booker } from "@/components/booker/Booker";

export async function loader({ params }: LoaderFunctionArgs) {
  const eventType = await getEventTypeBySlug({
    ownerEmail: params.user!,
    slug: params.slug!,
  });
  if (!eventType) throw new Response("Not found", { status: 404 });
  return { eventType, ownerEmail: params.user! };
}

export default function BookerEmbed() {
  const { eventType, ownerEmail } = useLoaderData<typeof loader>();
  return <Booker eventType={eventType} ownerEmail={ownerEmail} mode="embed" />;
}
