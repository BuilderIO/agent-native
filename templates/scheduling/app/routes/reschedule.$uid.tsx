import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  getBookingByUid,
  getEventTypeById,
} from "@agent-native/scheduling/server";
import { Booker } from "@/components/booker/Booker";

export async function loader({ params }: LoaderFunctionArgs) {
  const booking = await getBookingByUid(params.uid!);
  if (!booking || booking.status === "cancelled")
    throw new Response("Booking not found", { status: 404 });
  const eventType = await getEventTypeById(booking.eventTypeId);
  if (!eventType) throw new Response("Event type missing", { status: 404 });
  return { booking, eventType };
}

export default function ReschedulePage() {
  const { booking, eventType } = useLoaderData<typeof loader>();
  return (
    <div className="min-h-screen bg-background py-6">
      <Booker
        eventType={eventType}
        ownerEmail={booking.hostEmail}
        rescheduleUid={booking.uid}
      />
    </div>
  );
}
