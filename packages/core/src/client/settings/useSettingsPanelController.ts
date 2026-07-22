import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ALL_SETTINGS_SECTIONS,
  SETTINGS_SECTION_IDS,
  type SettingsSectionId,
} from "./agent-settings-search.js";

export interface SettingsPanelControllerOptions {
  sections?: readonly SettingsSectionId[];
  initialSection?: string | null;
  sectionRequestKey?: number;
  onScrollToSection?: (section: SettingsSectionId) => void;
}

export interface SettingsPanelController {
  sections: readonly SettingsSectionId[];
  openSection: SettingsSectionId | null;
  focusSecretKey: string | undefined;
  isSectionVisible: (section: SettingsSectionId) => boolean;
  isSectionOpen: (section: SettingsSectionId) => boolean;
  toggleSection: (section: SettingsSectionId) => void;
  openSettingsSection: (
    section: SettingsSectionId,
    options?: { scroll?: boolean },
  ) => void;
}

export function normalizeSettingsSection(
  value?: string | null,
): SettingsSectionId | null {
  const normalized = value?.replace(/^#/, "").toLowerCase() ?? "";
  if (!normalized) return null;
  if (normalized.startsWith("secrets")) return "secrets";
  if (
    normalized === "workspace" ||
    normalized === "workspace-settings" ||
    normalized === "organization" ||
    normalized === "org"
  ) {
    return "secrets";
  }
  if (normalized === "agent-engine") return "llm";
  if (
    normalized === "agent-model-defaults" ||
    normalized === "app-model-defaults" ||
    normalized === "models"
  ) {
    return "app-models";
  }
  if (normalized === "agent-limits" || normalized === "loop-settings") {
    return "limits";
  }
  return SETTINGS_SECTION_IDS.has(normalized as SettingsSectionId)
    ? (normalized as SettingsSectionId)
    : null;
}

export function settingsSectionDomId(section: SettingsSectionId): string {
  return `agent-settings-section-${section}`;
}

function firstVisibleSection(
  sections: readonly SettingsSectionId[],
): SettingsSectionId {
  if (sections.includes("llm")) return "llm";
  return sections[0] ?? "llm";
}

function initialOpenSection(
  sections: readonly SettingsSectionId[],
): SettingsSectionId {
  const hashSection =
    typeof window === "undefined"
      ? null
      : normalizeSettingsSection(window.location.hash);
  return hashSection && sections.includes(hashSection)
    ? hashSection
    : firstVisibleSection(sections);
}

export function useSettingsPanelController({
  sections = ALL_SETTINGS_SECTIONS,
  initialSection,
  sectionRequestKey,
  onScrollToSection,
}: SettingsPanelControllerOptions = {}): SettingsPanelController {
  const visibleSections = useMemo(() => new Set(sections), [sections]);
  const isSectionVisible = useCallback(
    (section: SettingsSectionId) => visibleSections.has(section),
    [visibleSections],
  );
  const [openSection, setOpenSection] = useState<SettingsSectionId | null>(() =>
    initialOpenSection(sections),
  );
  const [focusSecretKey, setFocusSecretKey] = useState<string>();

  const openSettingsSection = useCallback(
    (section: SettingsSectionId, options: { scroll?: boolean } = {}) => {
      setOpenSection(section);
      if (options.scroll) onScrollToSection?.(section);
    },
    [onScrollToSection],
  );

  const toggleSection = useCallback((section: SettingsSectionId) => {
    setOpenSection((current) => (current === section ? null : section));
  }, []);

  const isSectionOpen = useCallback(
    (section: SettingsSectionId) => openSection === section,
    [openSection],
  );

  useEffect(() => {
    const section = normalizeSettingsSection(initialSection);
    if (!section || !isSectionVisible(section)) return;
    if (section !== "secrets") setFocusSecretKey(undefined);
    openSettingsSection(section, { scroll: true });
  }, [
    initialSection,
    sectionRequestKey,
    isSectionVisible,
    openSettingsSection,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleHashChange = () => {
      const hash = window.location.hash?.replace(/^#/, "") ?? "";
      const section = normalizeSettingsSection(hash);
      if (!section || !isSectionVisible(section)) return;
      if (hash.startsWith("secrets:") || hash === "secrets") {
        const key = hash.slice("secrets:".length);
        setFocusSecretKey(key || undefined);
      } else {
        setFocusSecretKey(undefined);
      }
      openSettingsSection(section, { scroll: true });
    };
    handleHashChange();
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [isSectionVisible, openSettingsSection]);

  return {
    sections,
    openSection,
    focusSecretKey,
    isSectionVisible,
    isSectionOpen,
    toggleSection,
    openSettingsSection,
  };
}
