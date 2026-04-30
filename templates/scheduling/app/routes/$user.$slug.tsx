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

export function meta({
  data,
}: {
  data?: {
    eventType: { title: string; description?: string | null };
    ownerEmail: string;
  };
}) {
  if (!data) return [{ title: "Book a meeting" }];
  const name = data.ownerEmail.split("@")[0];
  return [
    { title: `${data.eventType.title} with ${name}` },
    {
      name: "description",
      content: data.eventType.description || `Book a meeting with ${name}.`,
    },
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
