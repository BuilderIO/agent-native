import { useQuery } from "@tanstack/react-query";

/**
 * Fetch profile photos for a list of attendee emails from the
 * Google Workspace directory. Cached for 10 minutes.
 */
export function useAttendeePhotos(emails: string[]) {
  const key = emails.slice().sort().join(",");

  return useQuery<Record<string, string>>({
    queryKey: ["attendee-photos", key],
    queryFn: async () => {
      if (emails.length === 0) return {};
      const params = new URLSearchParams({
        emails: emails.slice(0, 20).join(","),
      });
      const res = await fetch(`/api/people/photos?${params}`);
      if (!res.ok) return {};
      return res.json();
    },
    staleTime: 10 * 60 * 1000, // 10 min
    enabled: emails.length > 0,
  });
}
