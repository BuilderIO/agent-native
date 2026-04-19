import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  getEventTypeBySlug,
  resolveEventTypeSlug,
} from "@agent-native/scheduling/server";
import { Booker } from "@/components/booker/Booker";

export async function loader({ params }: LoaderFunctionArgs) {
  const ownerEmail = params.user!;
  const slug = params.slug!;
  const eventType =
    (await getEventTypeBySlug({ ownerEmail, slug })) ??
    (await resolveEventTypeSlug({ ownerEmail, slug }));
  if (!eventType || eventType.hidden)
    throw new Response("Not found", { status: 404 });
  return { eventType, ownerEmail };
}

export default function BookerPage() {
  const { eventType, ownerEmail } = useLoaderData<typeof loader>();
  return (
    <div className="min-h-screen bg-background py-8">
      <Booker eventType={eventType} ownerEmail={ownerEmail} mode="page" />
    </div>
  );
}
