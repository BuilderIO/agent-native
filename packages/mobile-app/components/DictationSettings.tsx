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
  StyleSheet,
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
      <View style={styles.loadingCard}>
        <ActivityIndicator color="#c7f36b" />
      </View>
    );
  }

  const languageLabel =
    DICTATION_LANGUAGE_OPTIONS.find(
      (option) => option.value === preferences.language,
    )?.label ?? "System language";

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <IconLanguage color="#c7f36b" size={20} strokeWidth={1.8} />
        <View style={styles.headingCopy}>
          <Text style={styles.sectionTitle}>Dictation</Text>
          <Text style={styles.sectionDescription}>
            Tune transcription and preferred spellings on iPhone and iPad.
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.fieldLabel}>Spoken language</Text>
        <Pressable
          accessibilityLabel={`Spoken language: ${languageLabel}`}
          accessibilityRole="button"
          onPress={() => setLanguageOpen(true)}
          style={({ pressed }) => [
            styles.selectButton,
            pressed && styles.buttonPressed,
          ]}
        >
          <Text style={styles.selectText}>{languageLabel}</Text>
          <IconChevronDown color="#a1a1aa" size={18} />
        </Pressable>
        <Text style={styles.helpText}>
          System automatically detects language. Choose a BCP-47 locale when
          names or accents need a stronger hint.
        </Text>

        <Text style={[styles.fieldLabel, styles.spacedLabel]}>
          Cleanup style
        </Text>
        <View style={styles.choiceGroup}>
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
                style={({ pressed }) => [
                  styles.choice,
                  selected && styles.choiceSelected,
                  pressed && styles.buttonPressed,
                ]}
              >
                <View style={styles.choiceCopy}>
                  <Text style={styles.choiceTitle}>{style.label}</Text>
                  <Text style={styles.choiceDescription}>
                    {style.description}
                  </Text>
                </View>
                <View style={[styles.radio, selected && styles.radioSelected]}>
                  {selected ? <IconCheck color="#111111" size={13} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.fieldLabel, styles.spacedLabel]}>
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
          style={styles.instructionsInput}
          textAlignVertical="top"
          value={preferences.customInstructions}
        />
        <View style={styles.saveRow}>
          <Text style={styles.statusText}>{message}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={() => void savePreferences()}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.buttonPressed,
              saving && styles.buttonDisabled,
            ]}
          >
            {saving ? (
              <ActivityIndicator color="#111111" size="small" />
            ) : (
              <IconCheck color="#111111" size={17} />
            )}
            <Text style={styles.primaryButtonText}>Save</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.vocabularyHeading}>
          <IconBook2 color="#f4f4f5" size={18} strokeWidth={1.8} />
          <View style={styles.headingCopy}>
            <Text style={styles.cardTitle}>Personal vocabulary</Text>
            <Text style={styles.helpText}>
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
          style={styles.textInput}
          value={term}
        />
        <View style={styles.addRow}>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={120}
            onChangeText={setReplacement}
            placeholder="Preferred spelling (optional)"
            placeholderTextColor="#71717a"
            style={[styles.textInput, styles.replacementInput]}
            value={replacement}
          />
          <Pressable
            accessibilityLabel="Add vocabulary term"
            accessibilityRole="button"
            disabled={!term.trim() || editingVocabulary}
            onPress={() => void addTerm()}
            style={({ pressed }) => [
              styles.addButton,
              pressed && styles.buttonPressed,
              (!term.trim() || editingVocabulary) && styles.buttonDisabled,
            ]}
          >
            <IconPlus color="#111111" size={20} strokeWidth={2.2} />
          </Pressable>
        </View>

        {vocabularyError ? (
          <Text style={styles.errorText}>{vocabularyError}</Text>
        ) : null}
        {loadingVocabulary ? (
          <ActivityIndicator color="#c7f36b" style={styles.listLoader} />
        ) : vocabulary.length === 0 && !vocabularyError ? (
          <Text style={styles.emptyText}>
            No terms yet. Add a name or spelling that transcription should
            preserve.
          </Text>
        ) : (
          <View style={styles.vocabularyList}>
            {vocabulary.map((entry) => (
              <View key={entry.id} style={styles.vocabularyRow}>
                <View style={styles.vocabularyCopy}>
                  <Text style={styles.vocabularyTerm}>{entry.replacement}</Text>
                  <Text style={styles.vocabularyMeta}>
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
                  style={({ pressed }) => [
                    styles.deleteButton,
                    pressed && styles.buttonPressed,
                  ]}
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
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Spoken language</Text>
            <ScrollView style={styles.languageScroll}>
              <View style={styles.languageList}>
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
                      style={({ pressed }) => [
                        styles.languageRow,
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <View>
                        <Text style={styles.languageLabel}>{option.label}</Text>
                        <Text style={styles.languageCode}>
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
              style={({ pressed }) => [
                styles.cancelButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: 16,
    paddingTop: 20,
    gap: 12,
  },
  loadingCard: {
    margin: 16,
    padding: 28,
    borderRadius: 16,
    backgroundColor: "#18181b",
  },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  headingCopy: {
    flex: 1,
  },
  sectionTitle: {
    color: "#f4f4f5",
    fontSize: 18,
    fontWeight: "700",
  },
  sectionDescription: {
    color: "#a1a1aa",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  card: {
    backgroundColor: "#18181b",
    borderColor: "#27272a",
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  fieldLabel: {
    color: "#e4e4e7",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 7,
  },
  spacedLabel: {
    marginTop: 18,
  },
  selectButton: {
    minHeight: 46,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#3f3f46",
    backgroundColor: "#111113",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  selectText: {
    color: "#f4f4f5",
    fontSize: 15,
    fontWeight: "500",
  },
  helpText: {
    color: "#a1a1aa",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 7,
  },
  choiceGroup: {
    gap: 7,
  },
  choice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 11,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#303036",
    borderRadius: 11,
    backgroundColor: "#111113",
  },
  choiceSelected: {
    borderColor: "#c7f36b88",
    backgroundColor: "#20251a",
  },
  choiceCopy: {
    flex: 1,
  },
  choiceTitle: {
    color: "#f4f4f5",
    fontSize: 14,
    fontWeight: "600",
  },
  choiceDescription: {
    color: "#a1a1aa",
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#52525b",
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: {
    backgroundColor: "#c7f36b",
    borderColor: "#c7f36b",
  },
  instructionsInput: {
    minHeight: 82,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#3f3f46",
    backgroundColor: "#111113",
    color: "#f4f4f5",
    fontSize: 14,
    lineHeight: 19,
    padding: 11,
  },
  saveRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 10,
  },
  statusText: {
    flex: 1,
    color: "#a1a1aa",
    fontSize: 12,
    lineHeight: 16,
  },
  primaryButton: {
    minWidth: 90,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "#c7f36b",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  primaryButtonText: {
    color: "#111111",
    fontSize: 14,
    fontWeight: "700",
  },
  vocabularyHeading: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    marginBottom: 13,
  },
  cardTitle: {
    color: "#f4f4f5",
    fontSize: 15,
    fontWeight: "700",
  },
  textInput: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#3f3f46",
    backgroundColor: "#111113",
    color: "#f4f4f5",
    fontSize: 14,
    paddingHorizontal: 11,
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  replacementInput: {
    flex: 1,
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#c7f36b",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  errorText: {
    color: "#fca5a5",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
  },
  listLoader: {
    marginVertical: 18,
  },
  emptyText: {
    color: "#71717a",
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
    paddingHorizontal: 10,
    paddingVertical: 18,
  },
  vocabularyList: {
    borderTopWidth: 1,
    borderTopColor: "#27272a",
    marginTop: 12,
  },
  vocabularyRow: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#27272a",
  },
  vocabularyCopy: {
    flex: 1,
  },
  vocabularyTerm: {
    color: "#f4f4f5",
    fontSize: 14,
    fontWeight: "600",
  },
  vocabularyMeta: {
    color: "#71717a",
    fontSize: 11,
    marginTop: 2,
  },
  deleteButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: "#000000aa",
    padding: 20,
  },
  modalCard: {
    maxHeight: "90%",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#3f3f46",
    backgroundColor: "#18181b",
    padding: 16,
  },
  modalTitle: {
    color: "#f4f4f5",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 10,
  },
  languageList: {
    borderTopWidth: 1,
    borderTopColor: "#27272a",
  },
  languageScroll: {
    maxHeight: 520,
  },
  languageRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#27272a",
    paddingHorizontal: 3,
  },
  languageLabel: {
    color: "#f4f4f5",
    fontSize: 14,
    fontWeight: "500",
  },
  languageCode: {
    color: "#71717a",
    fontSize: 11,
    marginTop: 1,
  },
  cancelButton: {
    height: 42,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
    backgroundColor: "#27272a",
  },
  cancelButtonText: {
    color: "#f4f4f5",
    fontSize: 14,
    fontWeight: "600",
  },
});
