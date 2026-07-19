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
      <View className="items-end flex-row justify-between">
        <Text className="text-status-gray text-xs font-bold tracking-wider mt-6">
          UP NEXT
        </Text>
        {state.status === "connected" ? (
          <Pressable
            accessibilityLabel="Refresh upcoming meeting"
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => void loadUpcomingMeeting()}
            className="active:opacity-75"
          >
            <IconRefresh color="#71717a" size={18} />
          </Pressable>
        ) : null}
      </View>

      {state.status === "checking" ? (
        <View className="bg-card-dark border border-border-dark rounded-2xl mt-3 p-4 items-center flex-row gap-2.5 justify-center h-19">
          <ActivityIndicator color="#8dd7ff" size="small" />
          <Text className="text-text-muted text-xs">
            Checking calendar access…
          </Text>
        </View>
      ) : null}

      {state.status === "disconnected" ? (
        <View className="bg-card-dark border border-border-dark rounded-2xl mt-3 p-4">
          <View className="items-center flex-row">
            <View className="items-center self-start bg-accent-blue rounded-xl h-10.5 justify-center w-10.5">
              <IconCalendarEvent color="#0b0b0c" size={21} strokeWidth={1.9} />
            </View>
            <View className="flex-1 ml-3">
              <Text className="text-text-bright text-base font-bold leading-5">
                Be ready for your next meeting
              </Text>
              <Text className="text-text-muted text-xs leading-[17px] mt-1">
                Connect your device calendar to see what’s next. Agent Native
                never joins or starts recording on its own.
              </Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={connecting}
            onPress={() => void connect()}
            className="items-center align-stretch bg-accent-blue rounded-xl flex-row gap-2 justify-center mt-4 h-10.5 px-3.5 active:opacity-70"
          >
            {connecting ? (
              <ActivityIndicator color="#0b0b0c" size="small" />
            ) : (
              <Text className="text-background-dark text-sm font-bold">
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
        <View className="bg-card-dark border border-border-dark rounded-2xl mt-3 p-4 items-center flex-row">
          <View className="items-center self-start bg-accent-blue rounded-xl h-10.5 justify-center w-10.5">
            <IconCalendarEvent color="#0b0b0c" size={21} strokeWidth={1.9} />
          </View>
          <View className="flex-1 ml-3">
            <Text className="text-text-bright text-base font-bold leading-5">
              Your calendar is clear
            </Text>
            <Text className="text-text-muted text-xs leading-[17px] mt-1">
              No upcoming events in the next 30 days.
            </Text>
          </View>
        </View>
      ) : null}

      {state.status === "connected" && state.meeting ? (
        <View className="bg-card-dark border border-border-dark rounded-2xl mt-3 p-4">
          <View className="items-center flex-row">
            <View className="items-center self-start bg-accent-blue rounded-xl h-10.5 justify-center w-10.5">
              <IconCalendarEvent color="#0b0b0c" size={21} strokeWidth={1.9} />
            </View>
            <View className="flex-1 ml-3">
              <Text
                numberOfLines={2}
                className="text-text-bright text-base font-bold leading-5"
              >
                {state.meeting.title}
              </Text>
              <Text className="text-accent-blue text-xs leading-[17px] mt-1">
                {formatUpcomingMeetingTiming(state.meeting)}
              </Text>
            </View>
          </View>
          <View className="flex-row gap-2 mt-4">
            {state.meeting.joinUrl ? (
              <Pressable
                accessibilityHint="Opens the meeting link outside Agent Native"
                accessibilityRole="link"
                onPress={() => void openJoinLink(state.meeting!.joinUrl!)}
                className="items-center bg-gray-charcoal rounded-xl flex-row gap-2 justify-center h-10.5 px-3.5 active:opacity-70"
              >
                <IconExternalLink color="#d4d4d8" size={17} />
                <Text className="text-text-light text-sm font-bold">Join</Text>
              </Pressable>
            ) : null}
            <Link asChild href="/capture/audio">
              <Pressable
                accessibilityHint="Opens meeting capture ready to record"
                accessibilityRole="link"
                onPress={onPrepare}
                className="items-center align-stretch bg-accent-blue rounded-xl flex-row gap-2 justify-center mt-0 h-10.5 px-3.5 flex-1 active:opacity-70"
              >
                <IconMicrophone color="#0b0b0c" size={17} strokeWidth={2.1} />
                <Text className="text-background-dark text-sm font-bold">
                  Prepare recording
                </Text>
              </Pressable>
            </Link>
          </View>
        </View>
      ) : null}

      {state.status === "error" ? (
        <View className="bg-card-dark border border-border-dark rounded-2xl mt-3 p-4">
          <Text className="text-text-bright text-base font-bold leading-5">
            Calendar is unavailable
          </Text>
          <Text className="text-text-muted text-xs leading-[17px] mt-1">
            Your calendar wasn’t changed. Try checking access again.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void loadUpcomingMeeting()}
            className="items-center bg-gray-charcoal rounded-xl flex-row gap-2 justify-center h-10.5 px-3.5 self-start mt-3.5 active:opacity-70"
          >
            <IconRefresh color="#d4d4d8" size={17} />
            <Text className="text-text-light text-sm font-bold">Try again</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
