import {
  IconBook2,
  IconCheck,
  IconChevronDown,
  IconLanguage,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  addDictationVocabularyTerm,
  DICTATION_CLEANUP_STYLES,
  DICTATION_LANGUAGE_OPTIONS,
  type DictationPreferences,
  type DictationVocabularyEntry,
  listDictationVocabulary,
  loadDictationPreferences,
  removeDictationVocabularyTerm,
  saveDictationPreferences,
} from "@/lib/dictation-preferences";

export default function DictationSettings() {
  const [preferences, setPreferences] = useState<DictationPreferences | null>(
    null,
  );
  const [vocabulary, setVocabulary] = useState<DictationVocabularyEntry[]>([]);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [replacement, setReplacement] = useState("");
  const [loadingVocabulary, setLoadingVocabulary] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingVocabulary, setEditingVocabulary] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [vocabularyError, setVocabularyError] = useState<string | null>(null);

  const refreshVocabulary = useCallback(async () => {
    setLoadingVocabulary(true);
    setVocabularyError(null);
    try {
      setVocabulary(await listDictationVocabulary());
    } catch {
      setVocabularyError(
        "Connect to Clips to manage your personal vocabulary.",
      );
    } finally {
      setLoadingVocabulary(false);
    }
  }, []);

  useEffect(() => {
    void loadDictationPreferences().then(setPreferences);
    void refreshVocabulary();
  }, [refreshVocabulary]);

  const savePreferences = useCallback(async () => {
    if (!preferences || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const saved = await saveDictationPreferences(preferences);
      setPreferences(saved);
      setMessage("Dictation preferences saved on this device.");
    } catch {
      setMessage("Could not save dictation preferences.");
    } finally {
      setSaving(false);
    }
  }, [preferences, saving]);

  const addTerm = useCallback(async () => {
    if (!term.trim() || editingVocabulary) return;
    setEditingVocabulary(true);
    setVocabularyError(null);
    try {
      await addDictationVocabularyTerm(term, replacement);
      setTerm("");
      setReplacement("");
      await refreshVocabulary();
    } catch (error) {
      setVocabularyError(
        error instanceof Error
          ? error.message
          : "Could not add this vocabulary term.",
      );
    } finally {
      setEditingVocabulary(false);
    }
  }, [editingVocabulary, refreshVocabulary, replacement, term]);

  const removeTerm = useCallback(
    async (entry: DictationVocabularyEntry) => {
      if (editingVocabulary) return;
      const previous = vocabulary;
      setEditingVocabulary(true);
      setVocabularyError(null);
      setVocabulary((current) =>
        current.filter((candidate) => candidate.id !== entry.id),
      );
      try {
        await removeDictationVocabularyTerm(entry.id);
      } catch {
        setVocabulary(previous);
        setVocabularyError("Could not remove that vocabulary term.");
      } finally {
        setEditingVocabulary(false);
      }
    },
    [editingVocabulary, vocabulary],
  );

  if (!preferences) {
    return (
      <View className="m-4 p-7 rounded-2xl bg-card-dark items-center justify-center">
        <ActivityIndicator color="#c7f36b" />
      </View>
    );
  }

  const languageLabel =
    DICTATION_LANGUAGE_OPTIONS.find(
      (option) => option.value === preferences.language,
    )?.label ?? "System language";

  return (
    <View className="px-4 pt-5 gap-3">
      <View className="flex-row items-start gap-2.5">
        <IconLanguage color="#c7f36b" size={20} strokeWidth={1.8} />
        <View className="flex-1">
          <Text className="text-white text-lg font-bold">Dictation</Text>
          <Text className="text-text-muted text-xs leading-4 mt-0.5">
            Tune transcription and preferred spellings on iPhone and iPad.
          </Text>
        </View>
      </View>

      <View className="bg-card-dark border border-border-dark rounded-2xl p-3.5">
        <Text className="text-text-light text-xs font-semibold mb-1.75">
          Spoken language
        </Text>
        <Pressable
          accessibilityLabel={`Spoken language: ${languageLabel}`}
          accessibilityRole="button"
          onPress={() => setLanguageOpen(true)}
          className="min-h-11.5 rounded-xl border border-gray-border-medium bg-background-pure px-3 flex-row items-center justify-between active:opacity-70"
        >
          <Text className="text-white text-sm font-medium">
            {languageLabel}
          </Text>
          <IconChevronDown color="#a1a1aa" size={18} />
        </Pressable>
        <Text className="text-text-muted text-xs leading-4 mt-1.75">
          System automatically detects language. Choose a BCP-47 locale when
          names or accents need a stronger hint.
        </Text>

        <Text className="text-text-light text-xs font-semibold mb-1.75 mt-4.5">
          Cleanup style
        </Text>
        <View className="gap-1.75">
          {DICTATION_CLEANUP_STYLES.map((style) => {
            const selected = preferences.cleanupStyle === style.value;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={style.value}
                onPress={() =>
                  setPreferences((current) =>
                    current
                      ? { ...current, cleanupStyle: style.value }
                      : current,
                  )
                }
                className={`flex-row items-center gap-2.5 px-2.75 py-2.5 border border-border-dim rounded-xl bg-background-pure active:opacity-70 ${
                  selected ? "border-accent-lime-bright/50 bg-[#20251a]" : ""
                }`}
              >
                <View className="flex-1">
                  <Text className="text-white text-sm font-semibold">
                    {style.label}
                  </Text>
                  <Text className="text-text-muted text-xs leading-4 mt-0.5">
                    {style.description}
                  </Text>
                </View>
                <View
                  className={`w-5 h-5 rounded-full border border-gray-border-dark items-center justify-center ${
                    selected
                      ? "bg-accent-lime-bright border-accent-lime-bright"
                      : ""
                  }`}
                >
                  {selected ? <IconCheck color="#111111" size={13} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>

        <Text className="text-text-light text-xs font-semibold mb-1.75 mt-4.5">
          Extra instructions
        </Text>
        <TextInput
          accessibilityLabel="Extra dictation instructions"
          maxLength={500}
          multiline
          onChangeText={(customInstructions) =>
            setPreferences((current) =>
              current ? { ...current, customInstructions } : current,
            )
          }
          placeholder="For example: Keep product updates in short paragraphs."
          placeholderTextColor="#71717a"
          className="min-h-20.5 rounded-xl border border-gray-border-medium bg-background-pure text-white text-sm leading-4.5 p-2.75"
          textAlignVertical="top"
          value={preferences.customInstructions}
        />
        <View className="flex-row items-center justify-end gap-2.5 mt-2.5">
          <Text className="flex-1 text-text-muted text-xs leading-4">
            {message}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={() => void savePreferences()}
            className={`min-w-22.5 h-10 px-3.5 rounded-lg bg-accent-lime-bright flex-row items-center justify-center gap-1.5 active:opacity-70 ${
              saving ? "opacity-45" : ""
            }`}
          >
            {saving ? (
              <ActivityIndicator color="#111111" size="small" />
            ) : (
              <IconCheck color="#111111" size={17} />
            )}
            <Text className="text-background-pure text-sm font-bold">Save</Text>
          </Pressable>
        </View>
      </View>

      <View className="bg-card-dark border border-border-dark rounded-2xl p-3.5">
        <View className="flex-row items-start gap-2.25 mb-3.25">
          <IconBook2 color="#f4f4f5" size={18} strokeWidth={1.8} />
          <View className="flex-1">
            <Text className="text-white text-sm font-bold">
              Personal vocabulary
            </Text>
            <Text className="text-text-muted text-xs leading-4 mt-1.75">
              Bias every dictation toward names and product spellings you use.
            </Text>
          </View>
        </View>

        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={120}
          onChangeText={setTerm}
          placeholder="Word or phrase"
          placeholderTextColor="#71717a"
          className="h-11 rounded-lg border border-gray-border-medium bg-background-pure text-white text-sm px-2.75"
          value={term}
        />
        <View className="flex-row items-center gap-2 mt-2">
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={120}
            onChangeText={setReplacement}
            placeholder="Preferred spelling (optional)"
            placeholderTextColor="#71717a"
            className="flex-1 h-11 rounded-lg border border-gray-border-medium bg-background-pure text-white text-sm px-2.75"
            value={replacement}
          />
          <Pressable
            accessibilityLabel="Add vocabulary term"
            accessibilityRole="button"
            disabled={!term.trim() || editingVocabulary}
            onPress={() => void addTerm()}
            className={`w-11 h-11 rounded-lg bg-accent-lime-bright items-center justify-center active:opacity-70 ${
              !term.trim() || editingVocabulary ? "opacity-45" : ""
            }`}
          >
            <IconPlus color="#111111" size={20} strokeWidth={2.2} />
          </Pressable>
        </View>

        {vocabularyError ? (
          <Text className="text-error-text text-xs leading-4 mt-2.5">
            {vocabularyError}
          </Text>
        ) : null}
        {loadingVocabulary ? (
          <ActivityIndicator color="#c7f36b" className="my-4.5" />
        ) : vocabulary.length === 0 && !vocabularyError ? (
          <Text className="text-text-muted text-xs leading-4 text-center px-2.5 py-4.5">
            No terms yet. Add a name or spelling that transcription should
            preserve.
          </Text>
        ) : (
          <View className="border-t border-border-dark mt-3">
            {vocabulary.map((entry) => (
              <View
                key={entry.id}
                className="min-h-13.5 flex-row items-center gap-2 border-b border-border-dark"
              >
                <View className="flex-1">
                  <Text className="text-white text-sm font-semibold">
                    {entry.replacement}
                  </Text>
                  <Text className="text-text-muted text-xs mt-0.5">
                    {entry.term === entry.replacement
                      ? `Used ${entry.usesCount} times`
                      : `Replace “${entry.term}” · Used ${entry.usesCount} times`}
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel={`Remove ${entry.replacement}`}
                  accessibilityRole="button"
                  disabled={editingVocabulary}
                  hitSlop={8}
                  onPress={() => void removeTerm(entry)}
                  className="w-9 h-9 items-center justify-center active:opacity-70"
                >
                  <IconTrash color="#f87171" size={18} strokeWidth={1.8} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </View>

      <Modal
        animationType="fade"
        onRequestClose={() => setLanguageOpen(false)}
        transparent
        visible={languageOpen}
      >
        <View className="flex-1 justify-center bg-black/60 p-5">
          <View className="max-h-[90%] rounded-2xl border border-gray-border-medium bg-card-dark p-4">
            <Text className="text-white text-lg font-bold mb-2.5">
              Spoken language
            </Text>
            <ScrollView style={{ maxHeight: 400 }}>
              <View className="border-t border-border-dark">
                {DICTATION_LANGUAGE_OPTIONS.map((option) => {
                  const selected = preferences.language === option.value;
                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      key={option.value ?? "system"}
                      onPress={() => {
                        setPreferences((current) =>
                          current
                            ? { ...current, language: option.value }
                            : current,
                        );
                        setLanguageOpen(false);
                      }}
                      className="min-h-12 flex-row items-center justify-between border-b border-border-dark px-0.75 active:opacity-70"
                    >
                      <View>
                        <Text className="text-white text-sm font-medium">
                          {option.label}
                        </Text>
                        <Text className="text-text-muted text-xs mt-0.25">
                          {option.value ?? "Automatic"}
                        </Text>
                      </View>
                      {selected ? (
                        <IconCheck
                          color="#c7f36b"
                          size={18}
                          strokeWidth={2.2}
                        />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              onPress={() => setLanguageOpen(false)}
              className="h-10.5 rounded-lg items-center justify-center mt-3 bg-gray-medium-dark active:opacity-70"
            >
              <Text className="text-white text-sm font-semibold">Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
