import {
  IconArrowRight,
  IconCalendarEvent,
  IconExternalLink,
  IconMicrophone,
  IconRefresh,
} from "@tabler/icons-react-native";
import * as Calendar from "expo-calendar";
import { Link } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  findNextUpcomingMeeting,
  formatUpcomingMeetingTiming,
  isReadableCalendar,
  type UpcomingMeeting,
} from "@/lib/calendar-readiness";

const LOOKAHEAD_DAYS = 30;

type CalendarReadinessState =
  | { status: "checking" }
  | { status: "disconnected"; canAskAgain: boolean }
  | { status: "connected"; meeting?: UpcomingMeeting }
  | { status: "error" };

interface UpcomingMeetingCardProps {
  onPrepare: () => void;
}

export default function UpcomingMeetingCard({
  onPrepare,
}: UpcomingMeetingCardProps) {
  const [state, setState] = useState<CalendarReadinessState>({
    status: "checking",
  });
  const [connecting, setConnecting] = useState(false);

  const loadUpcomingMeeting = useCallback(async () => {
    try {
      const permission = await Calendar.getCalendarPermissions();
      if (!permission.granted) {
        setState({
          status: "disconnected",
          canAskAgain: permission.canAskAgain,
        });
        return;
      }

      const calendars = (
        await Calendar.getCalendars(Calendar.EntityTypes.EVENT)
      ).filter(isReadableCalendar);
      const now = new Date();
      const through = new Date(
        now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000,
      );
      const events = calendars.length
        ? await Calendar.listEvents(calendars, now, through)
        : [];
      setState({
        status: "connected",
        meeting: findNextUpcomingMeeting(events, now),
      });
    } catch {
      setState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void loadUpcomingMeeting();
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") void loadUpcomingMeeting();
    });
    return () => subscription.remove();
  }, [loadUpcomingMeeting]);

  const connect = useCallback(async () => {
    if (state.status !== "disconnected") return;
    if (!state.canAskAgain) {
      await Linking.openSettings().catch(() => null);
      return;
    }

    setConnecting(true);
    try {
      const permission = await Calendar.requestCalendarPermissions();
      if (permission.granted) {
        await loadUpcomingMeeting();
      } else {
        setState({
          status: "disconnected",
          canAskAgain: permission.canAskAgain,
        });
      }
    } catch {
      setState({ status: "error" });
    } finally {
      setConnecting(false);
    }
  }, [loadUpcomingMeeting, state]);

  const openJoinLink = useCallback(async (joinUrl: string) => {
    await Linking.openURL(joinUrl).catch(() => setState({ status: "error" }));
  }, []);

  return (
    <View>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>UP NEXT</Text>
        {state.status === "connected" ? (
          <Pressable
            accessibilityLabel="Refresh upcoming meeting"
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => void loadUpcomingMeeting()}
          >
            <IconRefresh color="#71717a" size={18} />
          </Pressable>
        ) : null}
      </View>

      {state.status === "checking" ? (
        <View style={[styles.card, styles.centeredCard]}>
          <ActivityIndicator color="#8dd7ff" size="small" />
          <Text style={styles.mutedText}>Checking calendar access…</Text>
        </View>
      ) : null}

      {state.status === "disconnected" ? (
        <View style={styles.card}>
          <View style={styles.headingRow}>
            <View style={styles.calendarIcon}>
              <IconCalendarEvent color="#0b0b0c" size={21} strokeWidth={1.9} />
            </View>
            <View style={styles.copy}>
              <Text style={styles.title}>Be ready for your next meeting</Text>
              <Text style={styles.description}>
                Connect your device calendar to see what’s next. Agent Native
                never joins or starts recording on its own.
              </Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={connecting}
            onPress={() => void connect()}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.buttonPressed,
            ]}
          >
            {connecting ? (
              <ActivityIndicator color="#0b0b0c" size="small" />
            ) : (
              <Text style={styles.primaryButtonText}>
                {state.canAskAgain ? "Connect calendar" : "Open settings"}
              </Text>
            )}
            {!connecting ? (
              <IconArrowRight color="#0b0b0c" size={18} strokeWidth={2.2} />
            ) : null}
          </Pressable>
        </View>
      ) : null}

      {state.status === "connected" && !state.meeting ? (
        <View style={[styles.card, styles.headingRow]}>
          <View style={styles.calendarIcon}>
            <IconCalendarEvent color="#0b0b0c" size={21} strokeWidth={1.9} />
          </View>
          <View style={styles.copy}>
            <Text style={styles.title}>Your calendar is clear</Text>
            <Text style={styles.description}>
              No upcoming events in the next 30 days.
            </Text>
          </View>
        </View>
      ) : null}

      {state.status === "connected" && state.meeting ? (
        <View style={styles.card}>
          <View style={styles.headingRow}>
            <View style={styles.calendarIcon}>
              <IconCalendarEvent color="#0b0b0c" size={21} strokeWidth={1.9} />
            </View>
            <View style={styles.copy}>
              <Text numberOfLines={2} style={styles.title}>
                {state.meeting.title}
              </Text>
              <Text style={styles.timing}>
                {formatUpcomingMeetingTiming(state.meeting)}
              </Text>
            </View>
          </View>
          <View style={styles.buttonRow}>
            {state.meeting.joinUrl ? (
              <Pressable
                accessibilityHint="Opens the meeting link outside Agent Native"
                accessibilityRole="link"
                onPress={() => void openJoinLink(state.meeting!.joinUrl!)}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <IconExternalLink color="#d4d4d8" size={17} />
                <Text style={styles.secondaryButtonText}>Join</Text>
              </Pressable>
            ) : null}
            <Link asChild href="/capture/audio">
              <Pressable
                accessibilityHint="Opens meeting capture ready to record"
                accessibilityRole="link"
                onPress={onPrepare}
                style={({ pressed }) => [
                  styles.primaryButton,
                  styles.prepareButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <IconMicrophone color="#0b0b0c" size={17} strokeWidth={2.1} />
                <Text style={styles.primaryButtonText}>Prepare recording</Text>
              </Pressable>
            </Link>
          </View>
        </View>
      ) : null}

      {state.status === "error" ? (
        <View style={styles.card}>
          <Text style={styles.title}>Calendar is unavailable</Text>
          <Text style={styles.description}>
            Your calendar wasn’t changed. Try checking access again.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void loadUpcomingMeeting()}
            style={({ pressed }) => [
              styles.secondaryButton,
              styles.retryButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <IconRefresh color="#d4d4d8" size={17} />
            <Text style={styles.secondaryButtonText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sectionLabel: {
    color: "#71717a",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.15,
    marginTop: 25,
  },
  card: {
    backgroundColor: "#18181b",
    borderColor: "#27272a",
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 11,
    padding: 15,
  },
  centeredCard: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
    minHeight: 76,
  },
  headingRow: { alignItems: "center", flexDirection: "row" },
  calendarIcon: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#8dd7ff",
    borderRadius: 12,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  copy: { flex: 1, marginLeft: 12 },
  title: { color: "#fafafa", fontSize: 15, fontWeight: "700", lineHeight: 20 },
  description: {
    color: "#a1a1aa",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  timing: { color: "#8dd7ff", fontSize: 12, lineHeight: 17, marginTop: 4 },
  mutedText: { color: "#a1a1aa", fontSize: 12 },
  buttonRow: { flexDirection: "row", gap: 9, marginTop: 15 },
  primaryButton: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: "#8dd7ff",
    borderRadius: 12,
    flexDirection: "row",
    gap: 7,
    justifyContent: "center",
    marginTop: 15,
    minHeight: 42,
    paddingHorizontal: 14,
  },
  prepareButton: { flex: 1, marginTop: 0 },
  primaryButtonText: { color: "#0b0b0c", fontSize: 13, fontWeight: "700" },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#27272a",
    borderRadius: 12,
    flexDirection: "row",
    gap: 7,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 14,
  },
  secondaryButtonText: { color: "#d4d4d8", fontSize: 13, fontWeight: "700" },
  retryButton: { alignSelf: "flex-start", marginTop: 14 },
  buttonPressed: { opacity: 0.72 },
});
