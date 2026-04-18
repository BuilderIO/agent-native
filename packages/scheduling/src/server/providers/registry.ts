/**
 * Provider registry — consumers register calendar/video/SMS providers at
 * startup. Actions look up providers by kind.
 */
import type { CalendarProvider, VideoProvider, SmsProvider } from "./types.js";

const calendarProviders = new Map<string, CalendarProvider>();
const videoProviders = new Map<string, VideoProvider>();
const smsProviders = new Map<string, SmsProvider>();

export function registerCalendarProvider(p: CalendarProvider): void {
  calendarProviders.set(p.kind, p);
}

export function registerVideoProvider(p: VideoProvider): void {
  videoProviders.set(p.kind, p);
}

export function registerSmsProvider(p: SmsProvider): void {
  smsProviders.set(p.kind, p);
}

export function getCalendarProvider(
  kind: string,
): CalendarProvider | undefined {
  return calendarProviders.get(kind);
}

export function getVideoProvider(kind: string): VideoProvider | undefined {
  return videoProviders.get(kind);
}

export function getSmsProvider(kind: string): SmsProvider | undefined {
  return smsProviders.get(kind);
}

export function listCalendarProviders(): CalendarProvider[] {
  return Array.from(calendarProviders.values());
}

export function listVideoProviders(): VideoProvider[] {
  return Array.from(videoProviders.values());
}
