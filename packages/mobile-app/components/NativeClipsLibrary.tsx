import {
  IconArrowLeft,
  IconCamera,
  IconEye,
  IconLock,
  IconMessageCircle,
  IconRefresh,
  IconSearch,
  IconSend,
  IconShare3,
  IconUsers,
  IconVideo,
} from "@tabler/icons-react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from "react-native";

import { SafeAreaView } from "@/components/uniwind-interop";
import { ClipsApiError } from "@/lib/clips-api";
import {
  addNativeClipComment,
  buildNativeClipSharePayload,
  formatClipDate,
  formatClipDuration,
  getNativeClip,
  getNativeClipShareInfo,
  listNativeClips,
  parseCommentReactionCounts,
  reactToNativeClip,
  reactToNativeClipComment,
  resolveTrustedClipsUrl,
  searchNativeClips,
  type ClipsLibraryView,
  type NativeClipComment,
  type NativeClipDetail,
  type NativeClipSearchResult,
  type NativeClipSummary,
} from "@/lib/clips-library";
import { getClipsSession } from "@/lib/clips-session";

interface NativeClipsLibraryProps {
  onAuthRequired: () => void;
  onSelectionChange?: (recordingId: string | null) => void;
}

interface SelectedClip {
  id: string;
  matchMs?: number | null;
}

const VIDEO_REACTIONS = ["👍", "❤️", "🔥", "👏"] as const;

function isAuthError(error: unknown): boolean {
  return error instanceof ClipsApiError && error.code === "auth_required";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function VisibilityIcon({ visibility }: { visibility: string }) {
  return visibility === "private" ? (
    <IconLock color="#a1a1aa" size={13} strokeWidth={1.8} />
  ) : (
    <IconUsers color="#a1a1aa" size={13} strokeWidth={1.8} />
  );
}

function ClipArtwork({
  recording,
  sessionToken,
}: {
  recording: NativeClipSummary;
  sessionToken: string | null;
}) {
  const thumbnailUrl = resolveTrustedClipsUrl(recording.thumbnailUrl);
  return (
    <View className="w-31.5 h-20.5 rounded-xl border border-border-dark overflow-hidden items-center justify-center bg-card-dark">
      {thumbnailUrl ? (
        <Image
          accessibilityIgnoresInvertColors
          resizeMode="cover"
          source={{
            uri: thumbnailUrl,
            ...(sessionToken
              ? { headers: { Authorization: `Bearer ${sessionToken}` } }
              : {}),
          }}
          className="absolute inset-0"
        />
      ) : (
        <IconVideo color="#71717a" size={26} strokeWidth={1.5} />
      )}
      <View className="absolute bottom-1.5 right-1.5 px-1.25 py-0.5 rounded bg-black/75">
        <Text
          style={{ fontVariant: ["tabular-nums"] }}
          className="text-white text-xxs font-mono"
        >
          {formatClipDuration(recording.durationMs)}
        </Text>
      </View>
    </View>
  );
}

function ClipRow({
  recording,
  sessionToken,
  snippet,
  onPress,
}: {
  recording: NativeClipSummary;
  sessionToken: string | null;
  snippet?: string | null;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityHint="Opens this clip for playback and comments"
      accessibilityRole="button"
      onPress={onPress}
      className="flex-row gap-3.25 py-3 active:opacity-75"
    >
      <ClipArtwork recording={recording} sessionToken={sessionToken} />
      <View className="flex-1 justify-center min-w-0">
        <Text
          numberOfLines={2}
          className="text-white text-sm font-bold leading-5"
        >
          {recording.title}
        </Text>
        {snippet ? (
          <Text
            numberOfLines={2}
            className="text-text-muted text-xs leading-4 mt-0.75"
          >
            {snippet}
          </Text>
        ) : null}
        <View className="flex-row items-center gap-1 mt-2">
          <Text className="text-text-muted text-xxs">
            {formatClipDate(recording.createdAt)}
          </Text>
          <Text className="text-text-muted text-xxs">·</Text>
          <IconEye color="#71717a" size={13} strokeWidth={1.7} />
          <Text className="text-text-muted text-xxs">
            {recording.viewCount}
          </Text>
          <Text className="text-text-muted text-xxs">·</Text>
          <VisibilityIcon visibility={recording.visibility} />
        </View>
      </View>
    </Pressable>
  );
}

function EmptyLibrary({
  searching,
  view,
  onRecord,
}: {
  searching: boolean;
  view: ClipsLibraryView;
  onRecord: () => void;
}) {
  return (
    <View className="flex-1 items-center justify-center px-7 py-18">
      <View className="w-14 h-14 rounded-2xl bg-accent-green-dim items-center justify-center mb-4.5">
        {searching ? (
          <IconSearch color="#c7f36b" size={25} strokeWidth={1.7} />
        ) : (
          <IconVideo color="#c7f36b" size={25} strokeWidth={1.7} />
        )}
      </View>
      <Text className="text-white text-lg font-bold text-center">
        {searching
          ? "No matching clips"
          : view === "shared"
            ? "Nothing shared with you yet"
            : "Your library is ready"}
      </Text>
      <Text className="text-status-gray text-sm leading-5 mt-1.75 max-w-[310px] text-center">
        {searching
          ? "Try a title, transcript phrase, or comment."
          : view === "shared"
            ? "Clips shared directly or through your organization appear here."
            : "Record a video and it will stay on this phone until it is safely uploaded."}
      </Text>
      {!searching && view === "library" ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRecord}
          className="px-4 py-2.75 bg-primary rounded-xl flex-row items-center justify-center gap-1.75 mt-5 active:opacity-75"
        >
          <IconCamera color="#0b0b0c" size={17} strokeWidth={2} />
          <Text className="text-background-dark text-sm font-bold">
            Record a clip
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ClipComment({
  comment,
  reacting,
  onReact,
}: {
  comment: NativeClipComment;
  reacting: boolean;
  onReact: (emoji: string) => void;
}) {
  const reactions = parseCommentReactionCounts(comment.emojiReactionsJson);
  const author =
    comment.authorName ?? comment.authorEmail?.split("@")[0] ?? "Viewer";
  return (
    <View className="bg-background-dark border border-border-dark rounded-xl p-3">
      <View className="flex-row items-center gap-2.25">
        <View className="w-7.5 h-7.5 rounded-full bg-gray-charcoal items-center justify-center">
          <Text className="text-white text-xs font-extrabold">
            {author.slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <View className="flex-1 min-w-0">
          <Text numberOfLines={1} className="text-text-light text-sm font-bold">
            {author}
          </Text>
          <Text className="text-text-muted text-xxs mt-0.5">
            {formatClipDuration(comment.videoTimestampMs)} ·{" "}
            {formatClipDate(comment.createdAt)}
          </Text>
        </View>
      </View>
      <Text className="text-text-light text-sm leading-5 mt-2.5">
        {comment.content}
      </Text>
      <View className="flex-row flex-wrap gap-1.5 mt-2.5">
        {reactions.map((reaction) => (
          <Pressable
            accessibilityLabel={`React ${reaction.emoji}, ${reaction.count}`}
            accessibilityRole="button"
            disabled={reacting}
            key={reaction.emoji}
            onPress={() => onReact(reaction.emoji)}
            className="bg-gray-charcoal border border-border-dark rounded-xl px-2 py-1 active:opacity-75"
          >
            <Text className="text-text-light text-xxs">
              {reaction.emoji} {reaction.count}
            </Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityLabel="Add thumbs up reaction"
          accessibilityRole="button"
          disabled={reacting}
          onPress={() => onReact("👍")}
          className="bg-gray-charcoal border border-border-dark rounded-xl px-2 py-1 active:opacity-75"
        >
          <Text className="text-text-light text-xxs">👍 +</Text>
        </Pressable>
      </View>
    </View>
  );
}

function NativeClipPlayerContent({
  detail,
  initialMatchMs,
  sessionToken,
  onBack,
  onReload,
  onAuthRequired,
}: {
  detail: NativeClipDetail;
  initialMatchMs?: number | null;
  sessionToken: string;
  onBack: () => void;
  onReload: () => Promise<void>;
  onAuthRequired: () => void;
}) {
  const videoUrl = resolveTrustedClipsUrl(detail.recording.videoUrl);
  const source = useMemo(
    () =>
      videoUrl
        ? {
            uri: videoUrl,
            headers: {
              Authorization: `Bearer ${sessionToken}`,
              "X-Agent-Native-Client": "mobile",
            },
            metadata: { title: detail.recording.title },
          }
        : null,
    [detail.recording.title, sessionToken, videoUrl],
  );
  const player = useVideoPlayer(source, (instance) => {
    instance.timeUpdateEventInterval = 0.5;
    if (initialMatchMs && initialMatchMs > 0) {
      instance.currentTime = initialMatchMs / 1000;
    }
  });
  const [comment, setComment] = useState("");
  const [commenting, setCommenting] = useState(false);
  const [reactingKey, setReactingKey] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const submitComment = useCallback(async () => {
    const content = comment.trim();
    if (!content || commenting) return;
    setCommenting(true);
    setNotice(null);
    try {
      await addNativeClipComment({
        recordingId: detail.recording.id,
        content,
        videoTimestampMs: player.currentTime * 1000,
      });
      setComment("");
      await onReload();
    } catch (error) {
      if (isAuthError(error)) onAuthRequired();
      setNotice(errorMessage(error, "Could not add your comment."));
    } finally {
      setCommenting(false);
    }
  }, [
    comment,
    commenting,
    detail.recording.id,
    onAuthRequired,
    onReload,
    player,
  ]);

  const reactToVideo = useCallback(
    async (emoji: string) => {
      setReactingKey(`video:${emoji}`);
      setNotice(null);
      try {
        await reactToNativeClip({
          recordingId: detail.recording.id,
          emoji,
          videoTimestampMs: player.currentTime * 1000,
        });
        await onReload();
      } catch (error) {
        if (isAuthError(error)) onAuthRequired();
        setNotice(errorMessage(error, "Could not add your reaction."));
      } finally {
        setReactingKey(null);
      }
    },
    [detail.recording.id, onAuthRequired, onReload, player],
  );

  const reactToComment = useCallback(
    async (commentId: string, emoji: string) => {
      setReactingKey(`${commentId}:${emoji}`);
      setNotice(null);
      try {
        await reactToNativeClipComment({ commentId, emoji });
        await onReload();
      } catch (error) {
        if (isAuthError(error)) onAuthRequired();
        setNotice(errorMessage(error, "Could not update the reaction."));
      } finally {
        setReactingKey(null);
      }
    },
    [onAuthRequired, onReload],
  );

  const shareClip = useCallback(async () => {
    if (sharing) return;
    setSharing(true);
    setNotice(null);
    try {
      const shareInfo = await getNativeClipShareInfo(detail.recording.id);
      const payload = buildNativeClipSharePayload(
        detail.recording,
        shareInfo.visibility,
      );
      await Share.share({
        title: payload.title,
        message: `${payload.message}\n${payload.url}`,
        url: payload.url,
      });
    } catch (error) {
      if (isAuthError(error)) onAuthRequired();
      setNotice(errorMessage(error, "Could not open the share sheet."));
    } finally {
      setSharing(false);
    }
  }, [detail.recording, onAuthRequired, sharing]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={82}
      className="flex-1"
    >
      <ScrollView
        contentContainerClassName="pb-15 px-4.5 pt-2.5"
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-row items-center justify-between mb-3">
          <Pressable
            accessibilityLabel="Back to Clips library"
            accessibilityRole="button"
            hitSlop={10}
            onPress={onBack}
            className="w-10.5 h-10.5 rounded-xl bg-card-dark border border-border-dark items-center justify-center active:opacity-75"
          >
            <IconArrowLeft color="#f4f4f5" size={21} strokeWidth={1.8} />
          </Pressable>
          <Pressable
            accessibilityLabel="Share clip"
            accessibilityRole="button"
            disabled={sharing}
            onPress={() => void shareClip()}
            className="h-10.5 px-3.5 bg-primary rounded-xl flex-row items-center justify-center gap-1.75 active:opacity-75"
          >
            {sharing ? (
              <ActivityIndicator color="#0b0b0c" size="small" />
            ) : (
              <IconShare3 color="#0b0b0c" size={17} strokeWidth={2} />
            )}
            <Text className="text-background-dark text-sm font-bold">
              Share
            </Text>
          </Pressable>
        </View>

        <View className="aspect-video w-full rounded-2xl border border-border-dark bg-black overflow-hidden">
          {source ? (
            <VideoView
              allowsPictureInPicture
              contentFit="contain"
              fullscreenOptions={{ enable: true }}
              nativeControls
              player={player}
              className="absolute inset-0"
            />
          ) : (
            <View className="flex-1 items-center justify-center p-5">
              <IconVideo color="#71717a" size={30} strokeWidth={1.5} />
              <Text className="text-text-light text-sm font-bold mt-2.25">
                Video is still processing
              </Text>
              <Text className="text-text-muted text-xs mt-1">
                Pull to refresh the library in a moment.
              </Text>
            </View>
          )}
        </View>

        <Text className="text-white text-2xl font-bold mt-4.5 tracking-tight leading-7">
          {detail.recording.title}
        </Text>
        <View className="flex-row items-center gap-1.25 mt-1.75">
          <Text className="text-text-muted text-xs">
            {formatClipDate(detail.recording.createdAt)}
          </Text>
          <Text className="text-text-muted text-xs">·</Text>
          <Text className="text-text-muted text-xs">
            {formatClipDuration(detail.recording.durationMs)}
          </Text>
          <Text className="text-text-muted text-xs">·</Text>
          <Text className="text-text-muted text-xs">
            {detail.recording.viewCount} views
          </Text>
        </View>

        {detail.recording.description ? (
          <Text className="text-text-muted text-sm leading-5 mt-3.5">
            {detail.recording.description}
          </Text>
        ) : null}

        {detail.recording.enableReactions ? (
          <View className="flex-row items-center gap-2 mt-4.5">
            {VIDEO_REACTIONS.map((emoji) => (
              <Pressable
                accessibilityLabel={`React ${emoji} at the current video time`}
                accessibilityRole="button"
                disabled={reactingKey !== null}
                key={emoji}
                onPress={() => void reactToVideo(emoji)}
                className="w-10.5 h-9 rounded-full bg-card-dark border border-border-dark items-center justify-center active:opacity-75"
              >
                {reactingKey === `video:${emoji}` ? (
                  <ActivityIndicator color="#f4f4f5" size="small" />
                ) : (
                  <Text className="text-lg">{emoji}</Text>
                )}
              </Pressable>
            ))}
            {detail.reactions.length > 0 ? (
              <Text className="text-text-muted text-xs ml-0.75">
                {detail.reactions.length} reaction
                {detail.reactions.length === 1 ? "" : "s"}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View className="flex-row items-center justify-between border-t border-border-dark mt-6 pt-5">
          <View className="flex-row items-center gap-2">
            <IconMessageCircle color="#f4f4f5" size={19} strokeWidth={1.8} />
            <Text className="text-white text-base font-bold">
              Comments{" "}
              {detail.comments.length > 0 ? detail.comments.length : ""}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Refresh comments"
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => void onReload()}
          >
            <IconRefresh color="#71717a" size={17} strokeWidth={1.8} />
          </Pressable>
        </View>

        {detail.recording.enableComments ? (
          <View className="flex-row items-end gap-2 bg-card-dark border border-border-dark rounded-xl p-1.75 mt-3.5">
            <TextInput
              accessibilityLabel="Add a comment"
              maxLength={4000}
              multiline
              onChangeText={setComment}
              placeholder="Comment at the current video time…"
              placeholderTextColor="#71717a"
              className="flex-1 text-white text-sm leading-5 max-h-27.5 min-h-9.5 px-1.75 py-2"
              value={comment}
            />
            <Pressable
              accessibilityLabel="Post comment"
              accessibilityRole="button"
              disabled={!comment.trim() || commenting}
              onPress={() => void submitComment()}
              className={`w-9.5 h-9.5 rounded bg-primary items-center justify-center active:opacity-75 ${
                !comment.trim() || commenting ? "opacity-35" : ""
              }`}
            >
              {commenting ? (
                <ActivityIndicator color="#0b0b0c" size="small" />
              ) : (
                <IconSend color="#0b0b0c" size={17} strokeWidth={2} />
              )}
            </Pressable>
          </View>
        ) : (
          <Text className="text-text-muted text-sm mt-3.25">
            The owner turned comments off for this clip.
          </Text>
        )}

        {notice ? (
          <Text className="text-error-text text-xs leading-4 mt-2.5">
            {notice}
          </Text>
        ) : null}

        <View className="gap-2.5 mt-3.5">
          {detail.comments.map((item) => (
            <ClipComment
              comment={item}
              key={item.id}
              onReact={(emoji) => void reactToComment(item.id, emoji)}
              reacting={reactingKey?.startsWith(`${item.id}:`) ?? false}
            />
          ))}
          {detail.comments.length === 0 ? (
            <Text className="text-text-muted text-sm leading-5 py-3 text-center">
              No comments yet. Start the conversation at the moment that
              matters.
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function NativeClipPlayer({
  selection,
  onBack,
  onAuthRequired,
}: {
  selection: SelectedClip;
  onBack: () => void;
  onAuthRequired: () => void;
}) {
  const [detail, setDetail] = useState<NativeClipDetail | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextDetail, session] = await Promise.all([
        getNativeClip(selection.id),
        getClipsSession(),
      ]);
      if (!session) {
        onAuthRequired();
        return;
      }
      setDetail(nextDetail);
      setSessionToken(session.token);
    } catch (caught) {
      if (isAuthError(caught)) onAuthRequired();
      setError(errorMessage(caught, "Could not open this clip."));
    } finally {
      setLoading(false);
    }
  }, [onAuthRequired, selection.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center px-7.5 bg-background-dark">
        <ActivityIndicator color="#c7f36b" />
        <Text className="text-text-muted text-sm leading-5 mt-2.5 text-center">
          Opening clip…
        </Text>
      </View>
    );
  }

  if (!detail || !sessionToken) {
    return (
      <View className="flex-1 items-center justify-center px-7.5 bg-background-dark">
        <Text className="text-white text-lg font-bold text-center">
          Couldn’t open this clip
        </Text>
        <Text className="text-text-muted text-sm leading-5 mt-2.5 text-center">
          {error}
        </Text>
        <View className="flex-row gap-2.5 mt-5">
          <Pressable
            onPress={onBack}
            className="border border-gray-border-medium rounded-xl px-4.5 py-2.5 active:opacity-75"
          >
            <Text className="text-white text-sm font-bold">Back</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setLoading(true);
              void load();
            }}
            className="bg-primary rounded-xl px-4.5 py-2.5 active:opacity-75"
          >
            <Text className="text-background-dark text-sm font-bold">
              Try again
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <NativeClipPlayerContent
      detail={detail}
      initialMatchMs={selection.matchMs}
      onAuthRequired={onAuthRequired}
      onBack={onBack}
      onReload={load}
      sessionToken={sessionToken}
    />
  );
}

export default function NativeClipsLibrary({
  onAuthRequired,
  onSelectionChange,
}: NativeClipsLibraryProps) {
  const router = useRouter();
  const [view, setView] = useState<ClipsLibraryView>("library");
  const [recordings, setRecordings] = useState<NativeClipSummary[]>([]);
  const [searchResults, setSearchResults] = useState<
    NativeClipSearchResult[] | null
  >(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SelectedClip | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchGeneration = useRef(0);

  const load = useCallback(
    async (showRefresh = false) => {
      if (showRefresh) setRefreshing(true);
      setError(null);
      try {
        const [items, session] = await Promise.all([
          listNativeClips(view),
          getClipsSession(),
        ]);
        if (!session) {
          onAuthRequired();
          return;
        }
        setRecordings(items);
        setSessionToken(session.token);
      } catch (caught) {
        if (isAuthError(caught)) onAuthRequired();
        setError(errorMessage(caught, "Could not load your Clips library."));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [onAuthRequired, view],
  );

  useFocusEffect(
    useCallback(() => {
      if (!selected) void load();
    }, [load, selected]),
  );

  useEffect(() => {
    const clean = query.trim();
    const generation = ++searchGeneration.current;
    if (!clean) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      void searchNativeClips(clean)
        .then((results) => {
          if (generation === searchGeneration.current) {
            setSearchResults(results);
            setError(null);
          }
        })
        .catch((caught) => {
          if (generation !== searchGeneration.current) return;
          if (isAuthError(caught)) onAuthRequired();
          setError(errorMessage(caught, "Could not search Clips."));
        })
        .finally(() => {
          if (generation === searchGeneration.current) setSearching(false);
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [onAuthRequired, query]);

  const openClip = useCallback(
    (recording: NativeClipSummary | NativeClipSearchResult) => {
      const matchMs = "matchMs" in recording ? recording.matchMs : null;
      setSelected({ id: recording.id, matchMs });
      onSelectionChange?.(recording.id);
    },
    [onSelectionChange],
  );

  const closeClip = useCallback(() => {
    setSelected(null);
    onSelectionChange?.(null);
  }, [onSelectionChange]);

  if (selected) {
    return (
      <NativeClipPlayer
        onAuthRequired={onAuthRequired}
        onBack={closeClip}
        selection={selected}
      />
    );
  }

  const visibleRecordings = searchResults ?? recordings;

  return (
    <FlatList
      contentContainerClassName={`pb-8 px-5 ${visibleRecordings.length === 0 ? "flex-grow" : ""}`}
      data={visibleRecordings}
      ItemSeparatorComponent={() => <View className="h-px bg-border-dark" />}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      keyExtractor={(item) => item.id}
      ListEmptyComponent={
        loading || searching ? (
          <View className="flex-1 items-center justify-center pt-18">
            <ActivityIndicator color="#c7f36b" />
            <Text className="text-text-muted text-sm leading-5 mt-2.5 text-center">
              {searching ? "Searching everything…" : "Loading your clips…"}
            </Text>
          </View>
        ) : (
          <EmptyLibrary
            onRecord={() => router.push("/capture/video" as never)}
            searching={searchResults !== null}
            view={view}
          />
        )
      }
      ListHeaderComponent={
        <View className="pb-2.5 pt-4">
          <View className="flex-row items-center justify-between mb-5">
            <View>
              <Text
                style={{ letterSpacing: 1.4 }}
                className="text-primary text-xxs font-extrabold uppercase"
              >
                CLIPS
              </Text>
              <Text className="text-white text-3xl font-bold tracking-tight mt-0.75">
                Your recordings
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Record a new clip"
              accessibilityRole="button"
              onPress={() => router.push("/capture/video" as never)}
              className="flex-row items-center gap-1.75 bg-primary rounded-xl px-3.5 h-10.5 active:opacity-75"
            >
              <IconCamera color="#0b0b0c" size={17} strokeWidth={2} />
              <Text className="text-background-dark text-sm font-bold">
                Record
              </Text>
            </Pressable>
          </View>

          <View className="flex-row items-center gap-2.25 bg-card-dark border border-border-dark rounded-xl px-3.25 h-11.5">
            <IconSearch color="#71717a" size={18} strokeWidth={1.8} />
            <TextInput
              accessibilityLabel="Search clips"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setQuery}
              placeholder="Search titles, transcripts, comments"
              placeholderTextColor="#71717a"
              returnKeyType="search"
              className="flex-1 text-white text-sm py-2.5"
              value={query}
            />
            {searching ? (
              <ActivityIndicator color="#a1a1aa" size="small" />
            ) : null}
          </View>

          {!query.trim() ? (
            <View className="flex-row bg-card-dark rounded-xl p-0.75 mt-3.5">
              {(["library", "shared"] as const).map((item) => (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: view === item }}
                  key={item}
                  onPress={() => {
                    setLoading(true);
                    setView(item);
                  }}
                  className={`flex-1 items-center rounded-lg px-2.5 py-2 active:opacity-75 ${
                    view === item ? "bg-[#303033]" : ""
                  }`}
                >
                  <Text
                    className={`text-sm font-semibold ${
                      view === item ? "text-white" : "text-text-muted"
                    }`}
                  >
                    {item === "library" ? "My clips" : "Shared with me"}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text className="text-text-muted text-xs mt-2.5">
              Searching every clip you can access
            </Text>
          )}

          {error ? (
            <View className="flex-row items-center gap-2.5 bg-error-bg border border-error-border rounded-lg p-2.75 mt-3">
              <Text className="flex-1 text-error-text text-xs leading-4">
                {error}
              </Text>
              <Pressable
                accessibilityLabel="Retry loading clips"
                accessibilityRole="button"
                onPress={() => void load()}
              >
                <IconRefresh color="#fca5a5" size={17} strokeWidth={1.8} />
              </Pressable>
            </View>
          ) : null}
        </View>
      }
      refreshControl={
        <RefreshControl
          onRefresh={() => void load(true)}
          refreshing={refreshing}
          tintColor="#f4f4f5"
        />
      }
      renderItem={({ item }) => (
        <ClipRow
          onPress={() => openClip(item)}
          recording={item}
          sessionToken={sessionToken}
          snippet={
            searchResults ? (item as NativeClipSearchResult).snippet : null
          }
        />
      )}
    />
  );
}

export function NativeClipsLibraryScreen(props: NativeClipsLibraryProps) {
  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background-dark">
      <NativeClipsLibrary {...props} />
    </SafeAreaView>
  );
}
