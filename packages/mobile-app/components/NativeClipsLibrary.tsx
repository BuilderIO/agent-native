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
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

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
    <View style={styles.artwork}>
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
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <IconVideo color="#71717a" size={26} strokeWidth={1.5} />
      )}
      <View style={styles.durationBadge}>
        <Text style={styles.durationText}>
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
      style={({ pressed }) => [
        styles.clipRow,
        pressed && styles.clipRowPressed,
      ]}
    >
      <ClipArtwork recording={recording} sessionToken={sessionToken} />
      <View style={styles.clipCopy}>
        <Text numberOfLines={2} style={styles.clipTitle}>
          {recording.title}
        </Text>
        {snippet ? (
          <Text numberOfLines={2} style={styles.snippet}>
            {snippet}
          </Text>
        ) : null}
        <View style={styles.metadataRow}>
          <Text style={styles.metadataText}>
            {formatClipDate(recording.createdAt)}
          </Text>
          <Text style={styles.metadataDivider}>·</Text>
          <IconEye color="#71717a" size={13} strokeWidth={1.7} />
          <Text style={styles.metadataText}>{recording.viewCount}</Text>
          <Text style={styles.metadataDivider}>·</Text>
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
    <View style={styles.emptyState}>
      <View style={styles.emptyIcon}>
        {searching ? (
          <IconSearch color="#c7f36b" size={25} strokeWidth={1.7} />
        ) : (
          <IconVideo color="#c7f36b" size={25} strokeWidth={1.7} />
        )}
      </View>
      <Text style={styles.emptyTitle}>
        {searching
          ? "No matching clips"
          : view === "shared"
            ? "Nothing shared with you yet"
            : "Your library is ready"}
      </Text>
      <Text style={styles.emptyDescription}>
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
          style={styles.emptyButton}
        >
          <IconCamera color="#0b0b0c" size={17} strokeWidth={2} />
          <Text style={styles.emptyButtonText}>Record a clip</Text>
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
    <View style={styles.commentCard}>
      <View style={styles.commentHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {author.slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <View style={styles.commentIdentity}>
          <Text numberOfLines={1} style={styles.commentAuthor}>
            {author}
          </Text>
          <Text style={styles.commentTime}>
            {formatClipDuration(comment.videoTimestampMs)} ·{" "}
            {formatClipDate(comment.createdAt)}
          </Text>
        </View>
      </View>
      <Text style={styles.commentContent}>{comment.content}</Text>
      <View style={styles.commentReactions}>
        {reactions.map((reaction) => (
          <Pressable
            accessibilityLabel={`React ${reaction.emoji}, ${reaction.count}`}
            accessibilityRole="button"
            disabled={reacting}
            key={reaction.emoji}
            onPress={() => onReact(reaction.emoji)}
            style={styles.commentReaction}
          >
            <Text style={styles.commentReactionText}>
              {reaction.emoji} {reaction.count}
            </Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityLabel="Add thumbs up reaction"
          accessibilityRole="button"
          disabled={reacting}
          onPress={() => onReact("👍")}
          style={styles.commentReaction}
        >
          <Text style={styles.commentReactionText}>👍 +</Text>
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
      style={styles.flex}
    >
      <ScrollView
        contentContainerStyle={styles.playerContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.playerHeader}>
          <Pressable
            accessibilityLabel="Back to Clips library"
            accessibilityRole="button"
            hitSlop={10}
            onPress={onBack}
            style={styles.iconButton}
          >
            <IconArrowLeft color="#f4f4f5" size={21} strokeWidth={1.8} />
          </Pressable>
          <Pressable
            accessibilityLabel="Share clip"
            accessibilityRole="button"
            disabled={sharing}
            onPress={() => void shareClip()}
            style={styles.shareButton}
          >
            {sharing ? (
              <ActivityIndicator color="#0b0b0c" size="small" />
            ) : (
              <IconShare3 color="#0b0b0c" size={17} strokeWidth={2} />
            )}
            <Text style={styles.shareButtonText}>Share</Text>
          </Pressable>
        </View>

        <View style={styles.playerFrame}>
          {source ? (
            <VideoView
              allowsPictureInPicture
              contentFit="contain"
              fullscreenOptions={{ enable: true }}
              nativeControls
              player={player}
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <View style={styles.playerUnavailable}>
              <IconVideo color="#71717a" size={30} strokeWidth={1.5} />
              <Text style={styles.playerUnavailableTitle}>
                Video is still processing
              </Text>
              <Text style={styles.playerUnavailableCopy}>
                Pull to refresh the library in a moment.
              </Text>
            </View>
          )}
        </View>

        <Text style={styles.playerTitle}>{detail.recording.title}</Text>
        <View style={styles.playerMetadata}>
          <Text style={styles.playerMetadataText}>
            {formatClipDate(detail.recording.createdAt)}
          </Text>
          <Text style={styles.metadataDivider}>·</Text>
          <Text style={styles.playerMetadataText}>
            {formatClipDuration(detail.recording.durationMs)}
          </Text>
          <Text style={styles.metadataDivider}>·</Text>
          <Text style={styles.playerMetadataText}>
            {detail.recording.viewCount} views
          </Text>
        </View>

        {detail.recording.description ? (
          <Text style={styles.playerDescription}>
            {detail.recording.description}
          </Text>
        ) : null}

        {detail.recording.enableReactions ? (
          <View style={styles.videoReactions}>
            {VIDEO_REACTIONS.map((emoji) => (
              <Pressable
                accessibilityLabel={`React ${emoji} at the current video time`}
                accessibilityRole="button"
                disabled={reactingKey !== null}
                key={emoji}
                onPress={() => void reactToVideo(emoji)}
                style={styles.videoReaction}
              >
                {reactingKey === `video:${emoji}` ? (
                  <ActivityIndicator color="#f4f4f5" size="small" />
                ) : (
                  <Text style={styles.videoReactionText}>{emoji}</Text>
                )}
              </Pressable>
            ))}
            {detail.reactions.length > 0 ? (
              <Text style={styles.reactionCount}>
                {detail.reactions.length} reaction
                {detail.reactions.length === 1 ? "" : "s"}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.commentsHeader}>
          <View style={styles.commentsTitleRow}>
            <IconMessageCircle color="#f4f4f5" size={19} strokeWidth={1.8} />
            <Text style={styles.commentsTitle}>
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
          <View style={styles.commentComposer}>
            <TextInput
              accessibilityLabel="Add a comment"
              maxLength={4000}
              multiline
              onChangeText={setComment}
              placeholder="Comment at the current video time…"
              placeholderTextColor="#71717a"
              style={styles.commentInput}
              value={comment}
            />
            <Pressable
              accessibilityLabel="Post comment"
              accessibilityRole="button"
              disabled={!comment.trim() || commenting}
              onPress={() => void submitComment()}
              style={[
                styles.sendButton,
                (!comment.trim() || commenting) && styles.sendButtonDisabled,
              ]}
            >
              {commenting ? (
                <ActivityIndicator color="#0b0b0c" size="small" />
              ) : (
                <IconSend color="#0b0b0c" size={17} strokeWidth={2} />
              )}
            </Pressable>
          </View>
        ) : (
          <Text style={styles.commentsDisabled}>
            The owner turned comments off for this clip.
          </Text>
        )}

        {notice ? <Text style={styles.inlineError}>{notice}</Text> : null}

        <View style={styles.commentList}>
          {detail.comments.map((item) => (
            <ClipComment
              comment={item}
              key={item.id}
              onReact={(emoji) => void reactToComment(item.id, emoji)}
              reacting={reactingKey?.startsWith(`${item.id}:`) ?? false}
            />
          ))}
          {detail.comments.length === 0 ? (
            <Text style={styles.noComments}>
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
      <View style={styles.centeredState}>
        <ActivityIndicator color="#c7f36b" />
        <Text style={styles.centeredCopy}>Opening clip…</Text>
      </View>
    );
  }

  if (!detail || !sessionToken) {
    return (
      <View style={styles.centeredState}>
        <Text style={styles.centeredTitle}>Couldn’t open this clip</Text>
        <Text style={styles.centeredCopy}>{error}</Text>
        <View style={styles.errorActions}>
          <Pressable onPress={onBack} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Back</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setLoading(true);
              void load();
            }}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>Try again</Text>
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
      contentContainerStyle={[
        styles.libraryContent,
        visibleRecordings.length === 0 && styles.libraryContentEmpty,
      ]}
      data={visibleRecordings}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      keyExtractor={(item) => item.id}
      ListEmptyComponent={
        loading || searching ? (
          <View style={styles.loadingLibrary}>
            <ActivityIndicator color="#c7f36b" />
            <Text style={styles.centeredCopy}>
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
        <View style={styles.libraryHeader}>
          <View style={styles.titleRow}>
            <View>
              <Text style={styles.eyebrow}>CLIPS</Text>
              <Text style={styles.libraryTitle}>Your recordings</Text>
            </View>
            <Pressable
              accessibilityLabel="Record a new clip"
              accessibilityRole="button"
              onPress={() => router.push("/capture/video" as never)}
              style={styles.recordButton}
            >
              <IconCamera color="#0b0b0c" size={17} strokeWidth={2} />
              <Text style={styles.recordButtonText}>Record</Text>
            </Pressable>
          </View>

          <View style={styles.searchBox}>
            <IconSearch color="#71717a" size={18} strokeWidth={1.8} />
            <TextInput
              accessibilityLabel="Search clips"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setQuery}
              placeholder="Search titles, transcripts, comments"
              placeholderTextColor="#71717a"
              returnKeyType="search"
              style={styles.searchInput}
              value={query}
            />
            {searching ? (
              <ActivityIndicator color="#a1a1aa" size="small" />
            ) : null}
          </View>

          {!query.trim() ? (
            <View style={styles.segmentedControl}>
              {(["library", "shared"] as const).map((item) => (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: view === item }}
                  key={item}
                  onPress={() => {
                    setLoading(true);
                    setView(item);
                  }}
                  style={[
                    styles.segment,
                    view === item && styles.segmentSelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      view === item && styles.segmentTextSelected,
                    ]}
                  >
                    {item === "library" ? "My clips" : "Shared with me"}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={styles.searchScope}>
              Searching every clip you can access
            </Text>
          )}

          {error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{error}</Text>
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
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <NativeClipsLibrary {...props} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: "#0b0b0c" },
  libraryContent: { paddingBottom: 32, paddingHorizontal: 20 },
  libraryContentEmpty: { flexGrow: 1 },
  libraryHeader: { paddingBottom: 10, paddingTop: 16 },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  eyebrow: {
    color: "#c7f36b",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  libraryTitle: {
    color: "#f4f4f5",
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.8,
    marginTop: 3,
  },
  recordButton: {
    alignItems: "center",
    backgroundColor: "#c7f36b",
    borderRadius: 12,
    flexDirection: "row",
    gap: 7,
    minHeight: 42,
    paddingHorizontal: 14,
  },
  recordButtonText: { color: "#0b0b0c", fontSize: 14, fontWeight: "700" },
  searchBox: {
    alignItems: "center",
    backgroundColor: "#18181b",
    borderColor: "#27272a",
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    minHeight: 46,
    paddingHorizontal: 13,
  },
  searchInput: { color: "#f4f4f5", flex: 1, fontSize: 15, paddingVertical: 10 },
  segmentedControl: {
    backgroundColor: "#18181b",
    borderRadius: 11,
    flexDirection: "row",
    marginTop: 14,
    padding: 3,
  },
  segment: {
    alignItems: "center",
    borderRadius: 8,
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  segmentSelected: { backgroundColor: "#303033" },
  segmentText: { color: "#71717a", fontSize: 13, fontWeight: "600" },
  segmentTextSelected: { color: "#f4f4f5" },
  searchScope: { color: "#71717a", fontSize: 12, marginTop: 10 },
  errorBanner: {
    alignItems: "center",
    backgroundColor: "#2a1517",
    borderColor: "#7f1d1d",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
    padding: 11,
  },
  errorBannerText: { color: "#fca5a5", flex: 1, fontSize: 12, lineHeight: 17 },
  clipRow: { flexDirection: "row", gap: 13, paddingVertical: 12 },
  clipRowPressed: { opacity: 0.72 },
  artwork: {
    alignItems: "center",
    backgroundColor: "#18181b",
    borderColor: "#27272a",
    borderRadius: 12,
    borderWidth: 1,
    height: 82,
    justifyContent: "center",
    overflow: "hidden",
    width: 126,
  },
  durationBadge: {
    backgroundColor: "rgba(0,0,0,0.78)",
    borderRadius: 5,
    bottom: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
    position: "absolute",
    right: 6,
  },
  durationText: {
    color: "#f4f4f5",
    fontSize: 10,
    fontVariant: ["tabular-nums"],
  },
  clipCopy: { flex: 1, justifyContent: "center", minWidth: 0 },
  clipTitle: {
    color: "#f4f4f5",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 20,
  },
  snippet: { color: "#a1a1aa", fontSize: 12, lineHeight: 16, marginTop: 3 },
  metadataRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    marginTop: 8,
  },
  metadataText: { color: "#71717a", fontSize: 11 },
  metadataDivider: { color: "#52525b", fontSize: 11 },
  separator: { backgroundColor: "#202023", height: StyleSheet.hairlineWidth },
  loadingLibrary: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingTop: 72,
  },
  emptyState: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
    paddingVertical: 72,
  },
  emptyIcon: {
    alignItems: "center",
    backgroundColor: "#1b2214",
    borderRadius: 18,
    height: 56,
    justifyContent: "center",
    marginBottom: 18,
    width: 56,
  },
  emptyTitle: {
    color: "#f4f4f5",
    fontSize: 19,
    fontWeight: "700",
    textAlign: "center",
  },
  emptyDescription: {
    color: "#71717a",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 7,
    maxWidth: 310,
    textAlign: "center",
  },
  emptyButton: {
    alignItems: "center",
    backgroundColor: "#c7f36b",
    borderRadius: 12,
    flexDirection: "row",
    gap: 7,
    marginTop: 20,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  emptyButtonText: { color: "#0b0b0c", fontSize: 14, fontWeight: "700" },
  centeredState: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 30,
  },
  centeredTitle: {
    color: "#f4f4f5",
    fontSize: 19,
    fontWeight: "700",
    textAlign: "center",
  },
  centeredCopy: {
    color: "#71717a",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
    textAlign: "center",
  },
  errorActions: { flexDirection: "row", gap: 10, marginTop: 20 },
  secondaryButton: {
    borderColor: "#3f3f46",
    borderRadius: 11,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  secondaryButtonText: { color: "#f4f4f5", fontSize: 14, fontWeight: "700" },
  primaryButton: {
    backgroundColor: "#c7f36b",
    borderRadius: 11,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  primaryButtonText: { color: "#0b0b0c", fontSize: 14, fontWeight: "700" },
  playerContent: { paddingBottom: 60, paddingHorizontal: 18, paddingTop: 10 },
  playerHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: "#18181b",
    borderColor: "#27272a",
    borderRadius: 12,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  shareButton: {
    alignItems: "center",
    backgroundColor: "#c7f36b",
    borderRadius: 12,
    flexDirection: "row",
    gap: 7,
    minHeight: 42,
    paddingHorizontal: 14,
  },
  shareButtonText: { color: "#0b0b0c", fontSize: 14, fontWeight: "700" },
  playerFrame: {
    aspectRatio: 16 / 9,
    backgroundColor: "#000",
    borderColor: "#27272a",
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    width: "100%",
  },
  playerUnavailable: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  playerUnavailableTitle: {
    color: "#d4d4d8",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 9,
  },
  playerUnavailableCopy: { color: "#71717a", fontSize: 12, marginTop: 4 },
  playerTitle: {
    color: "#f4f4f5",
    fontSize: 23,
    fontWeight: "700",
    letterSpacing: -0.5,
    lineHeight: 29,
    marginTop: 18,
  },
  playerMetadata: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    marginTop: 7,
  },
  playerMetadataText: { color: "#71717a", fontSize: 12 },
  playerDescription: {
    color: "#a1a1aa",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 14,
  },
  videoReactions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 18,
  },
  videoReaction: {
    alignItems: "center",
    backgroundColor: "#18181b",
    borderColor: "#303033",
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 42,
  },
  videoReactionText: { fontSize: 18 },
  reactionCount: { color: "#71717a", fontSize: 11, marginLeft: 3 },
  commentsHeader: {
    alignItems: "center",
    borderTopColor: "#27272a",
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 24,
    paddingTop: 20,
  },
  commentsTitleRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  commentsTitle: { color: "#f4f4f5", fontSize: 16, fontWeight: "700" },
  commentComposer: {
    alignItems: "flex-end",
    backgroundColor: "#18181b",
    borderColor: "#303033",
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    marginTop: 14,
    padding: 7,
  },
  commentInput: {
    color: "#f4f4f5",
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    maxHeight: 110,
    minHeight: 38,
    paddingHorizontal: 7,
    paddingVertical: 8,
  },
  sendButton: {
    alignItems: "center",
    backgroundColor: "#c7f36b",
    borderRadius: 9,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  sendButtonDisabled: { opacity: 0.35 },
  inlineError: {
    color: "#fca5a5",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
  },
  commentsDisabled: { color: "#71717a", fontSize: 13, marginTop: 13 },
  commentList: { gap: 10, marginTop: 14 },
  commentCard: {
    backgroundColor: "#141416",
    borderColor: "#27272a",
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  commentHeader: { alignItems: "center", flexDirection: "row", gap: 9 },
  avatar: {
    alignItems: "center",
    backgroundColor: "#303033",
    borderRadius: 15,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  avatarText: { color: "#f4f4f5", fontSize: 12, fontWeight: "800" },
  commentIdentity: { flex: 1, minWidth: 0 },
  commentAuthor: { color: "#d4d4d8", fontSize: 13, fontWeight: "700" },
  commentTime: { color: "#71717a", fontSize: 10, marginTop: 2 },
  commentContent: {
    color: "#d4d4d8",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 10,
  },
  commentReactions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 10,
  },
  commentReaction: {
    backgroundColor: "#202023",
    borderColor: "#303033",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  commentReactionText: { color: "#d4d4d8", fontSize: 11 },
  noComments: {
    color: "#71717a",
    fontSize: 13,
    lineHeight: 19,
    paddingVertical: 12,
    textAlign: "center",
  },
});
