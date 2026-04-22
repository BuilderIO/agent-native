/**
 * Success state with check-mark SVG animation + add-to-calendar buttons.
 */
import { motion } from "motion/react";
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import type { EventType, Slot } from "@agent-native/scheduling/shared";
import { Button } from "@/components/ui/button";
import { IconCalendar, IconCalendarPlus, IconCheck } from "@tabler/icons-react";

export interface SuccessCardProps {
  bookingUid: string;
  eventType: EventType;
  slot: Slot;
  timezone: string;
}

export function SuccessCard(props: SuccessCardProps) {
  const gcalUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
    props.eventType.title,
  )}&dates=${toIcs(props.slot.start)}/${toIcs(props.slot.end)}`;
  const icsUrl = `/booking/${props.bookingUid}.ics`;
  const outlookUrl = `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&startdt=${props.slot.start}&enddt=${props.slot.end}&subject=${encodeURIComponent(props.eventType.title)}`;

  return (
    <div className="mx-auto max-w-md space-y-4 text-center">
      <motion.div
        className="mx-auto flex h-16 w-16 items-center justify-center rounded-full"
        style={{ background: "hsl(var(--brand-accent) / 0.1)" }}
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
      >
        <IconCheck className="h-8 w-8 booker-accent" strokeWidth={3} />
      </motion.div>
      <h2 className="text-xl font-semibold">You're booked</h2>
      <div className="rounded-md border border-border bg-muted/20 p-3 text-left text-sm">
        <div className="font-medium">{props.eventType.title}</div>
        <div className="text-muted-foreground">
          {format(
            new TZDate(new Date(props.slot.start).getTime(), props.timezone),
            "EEEE, MMMM d · h:mm a",
          )}{" "}
          ({props.timezone})
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Button asChild variant="outline" size="sm">
          <a href={gcalUrl} target="_blank" rel="noreferrer">
            <IconCalendar className="mr-1 h-4 w-4" />
            Google
          </a>
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href={outlookUrl} target="_blank" rel="noreferrer">
            <IconCalendarPlus className="mr-1 h-4 w-4" />
            Outlook
          </a>
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href={icsUrl} download>
            <IconCalendar className="mr-1 h-4 w-4" />
            iCal
          </a>
        </Button>
      </div>
      <div className="text-xs text-muted-foreground">
        A confirmation has been sent to your email.
      </div>
    </div>
  );
}

function toIcs(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}
