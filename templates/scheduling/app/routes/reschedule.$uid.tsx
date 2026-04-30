import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  getBookingByUid,
  getEventTypeById,
} from "@agent-native/scheduling/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { Booker } from "@/components/booker/Booker";

export async function loader({ params, request }: LoaderFunctionArgs) {
  const booking = await getBookingByUid(params.uid!);
  if (!booking || booking.status === "cancelled")
    throw new Response("Booking not found", { status: 404 });
  const token = new URL(request.url).searchParams.get("token") ?? undefined;
  const userEmail = getRequestUserEmail();
  const isHost = !!userEmail && userEmail === booking.hostEmail;
  const hasToken = !!token && token === booking.rescheduleToken;
  if (!isHost && !hasToken) throw new Response("Not found", { status: 404 });
  const eventType = await getEventTypeById(booking.eventTypeId);
  if (!eventType) throw new Response("Event type missing", { status: 404 });
  return { booking, eventType, token };
}

export default function ReschedulePage() {
  const { booking, eventType, token } = useLoaderData<typeof loader>();
  return (
    <div className="min-h-screen bg-background py-6">
      <Booker
        eventType={eventType}
        ownerEmail={booking.hostEmail}
        rescheduleUid={booking.uid}
        rescheduleToken={token}
      />
    </div>
  );
}
