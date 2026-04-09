/**
 * Tracks when an event detail popover was dismissed by clicking outside.
 * WeekView/DayView read this to suppress time-slot creation on the same click.
 */
let popoverInteractOutsideAt = 0;

export function markPopoverInteractOutside() {
  popoverInteractOutsideAt = Date.now();
}

export function shouldSuppressAfterPopoverClose() {
  return Date.now() - popoverInteractOutsideAt < 200;
}
