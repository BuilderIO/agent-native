import type { AgentComposerReference } from "@agent-native/core/client/agent-chat";

type TemplateReferenceInput = {
  id?: string | null;
  libraryId?: string | null;
  mediaType?: string | null;
  title?: string | null;
};

type LibraryReferenceInput = {
  id?: string | null;
  title?: string | null;
};

export function templateComposerReference(
  template: TemplateReferenceInput | null | undefined,
  library: LibraryReferenceInput | null | undefined,
): AgentComposerReference | null {
  if (!template?.id || !template.title) return null;

  const reference: AgentComposerReference = {
    label: template.title,
    icon: "document",
    source: "templates",
    refType: "template",
    refId: template.id,
    refPath: `/templates/${encodeURIComponent(template.id)}`,
    slotKey: "template",
    slotLabel: "Template",
    metadata: {
      mediaType: template.mediaType,
    },
  };

  if (!template.libraryId) return reference;
  if (library?.id !== template.libraryId || !library.title) return null;

  reference.metadata = {
    ...reference.metadata,
    libraryId: library.id,
    libraryTitle: library.title,
    requiredSlotKey: "brand-kit",
    requiredRefId: library.id,
  };
  reference.relatedReferences = [
    {
      label: library.title,
      icon: "folder",
      source: "brandKits",
      refType: "brand-kit",
      refId: library.id,
      refPath: `/templates/${encodeURIComponent(template.id)}`,
      slotKey: "brand-kit",
      slotLabel: "Brand kit",
      clearsSlots: ["template"],
      metadata: {
        libraryId: library.id,
      },
    },
  ];
  return reference;
}
