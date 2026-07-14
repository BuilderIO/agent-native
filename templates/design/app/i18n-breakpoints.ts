/**
 * Localized strings for BreakpointDeviceControl and breakpoint interactions.
 * Used in: app/components/design/BreakpointBar.tsx (the unified breakpoint
 * targeting control in the right-inspector header).
 */
export const breakpointBarOverrides = {
  "en-US": {
    designEditor: {
      breakpointBar: {
        base: "Base",
        editBaseWidth: "Edit base width",
        addBreakpoint: "Add breakpoint",
        remove: "Remove breakpoint",
        options: "Breakpoint options",
        changeWidth: "Change width",
        customWidth: "Custom width",
        add: "Add",
        showAllBreakpoints: "Show all breakpoints",
        desktop: "Desktop",
        tablet: "Tablet",
        phone: "Phone",
        scope: {
          label: "Responsive edit scope",
          cascadeSmaller: "This breakpoint and smaller",
          only: "This breakpoint only",
          firstEditGuidance:
            "Responsive edits affect this breakpoint and smaller sizes by default. Change the scope beside the breakpoint control.",
        },
      },
      screenDeletion: {
        titleOne: "Delete this screen?",
        titleMany: "Delete {{count}} screens?",
        descriptionOne:
          '"{{filename}}" and all of its responsive variants will be deleted. You can undo this while the editor remains open.',
        descriptionMany:
          "These screens and all of their responsive variants will be deleted. You can undo this while the editor remains open.",
        cancel: "Cancel",
        confirm: "Delete",
      },
      tweaksHelp:
        "Tweaks are breakpoint- and state-specific visual overrides layered on the base design. Reset a control to return to the inherited value.",
    },
  },
  "zh-CN": {
    designEditor: {
      breakpointBar: {
        base: "基础",
        editBaseWidth: "编辑基础宽度",
        addBreakpoint: "添加断点",
        remove: "移除断点",
        options: "断点选项",
        changeWidth: "更改宽度",
        customWidth: "自定义宽度",
        add: "添加",
        showAllBreakpoints: "显示所有断点",
        desktop: "桌面端",
        tablet: "平板",
        phone: "手机",
        scope: {
          label: "响应式编辑范围",
          cascadeSmaller: "此断点及更小尺寸",
          only: "仅此断点",
          firstEditGuidance:
            "响应式编辑默认影响此断点及更小尺寸。可在断点控件旁更改范围。",
        },
      },
      screenDeletion: {
        titleOne: "删除此屏幕？",
        titleMany: "删除 {{count}} 个屏幕？",
        descriptionOne:
          "将删除“{{filename}}”及其所有响应式变体。编辑器保持打开时可以撤销。",
        descriptionMany:
          "将删除这些屏幕及其所有响应式变体。编辑器保持打开时可以撤销。",
        cancel: "取消",
        confirm: "删除",
      },
      tweaksHelp:
        "调整项是叠加在基础设计上的断点和状态专属视觉覆盖。重置控件可恢复继承值。",
    },
  },
  "zh-TW": {
    designEditor: {
      breakpointBar: {
        base: "基礎",
        editBaseWidth: "編輯基礎寬度",
        addBreakpoint: "新增中斷點",
        remove: "移除中斷點",
        options: "中斷點選項",
        changeWidth: "變更寬度",
        customWidth: "自訂寬度",
        add: "新增",
        showAllBreakpoints: "顯示所有中斷點",
        desktop: "桌面",
        tablet: "平板",
        phone: "手機",
        scope: {
          label: "響應式編輯範圍",
          cascadeSmaller: "此中斷點及更小尺寸",
          only: "僅此中斷點",
          firstEditGuidance:
            "響應式編輯預設會影響此中斷點及更小尺寸。可在中斷點控制旁變更範圍。",
        },
      },
      screenDeletion: {
        titleOne: "刪除此畫面？",
        titleMany: "刪除 {{count}} 個畫面？",
        descriptionOne:
          "將刪除「{{filename}}」及其所有響應式變體。編輯器保持開啟時可以復原。",
        descriptionMany:
          "將刪除這些畫面及其所有響應式變體。編輯器保持開啟時可以復原。",
        cancel: "取消",
        confirm: "刪除",
      },
      tweaksHelp:
        "調整項是疊加在基礎設計上的中斷點與狀態專屬視覺覆寫。重設控制項可回到繼承值。",
    },
  },
  "es-ES": {
    designEditor: {
      breakpointBar: {
        base: "Base",
        editBaseWidth: "Editar ancho de base",
        addBreakpoint: "Añadir punto de quiebre",
        remove: "Quitar punto de quiebre",
        options: "Opciones de punto de quiebre",
        changeWidth: "Cambiar ancho",
        customWidth: "Ancho personalizado",
        add: "Añadir",
        showAllBreakpoints: "Mostrar todos los puntos de quiebre",
        desktop: "Escritorio",
        tablet: "Tablet",
        phone: "Teléfono",
        scope: {
          label: "Ámbito de edición adaptable",
          cascadeSmaller: "Este punto y tamaños menores",
          only: "Solo este punto",
          firstEditGuidance:
            "Las ediciones adaptables afectan este punto y tamaños menores de forma predeterminada. Cambia el ámbito junto al control.",
        },
      },
      screenDeletion: {
        titleOne: "¿Eliminar esta pantalla?",
        titleMany: "¿Eliminar {{count}} pantallas?",
        descriptionOne:
          "Se eliminarán “{{filename}}” y todas sus variantes adaptables. Puedes deshacerlo mientras el editor siga abierto.",
        descriptionMany:
          "Se eliminarán estas pantallas y todas sus variantes adaptables. Puedes deshacerlo mientras el editor siga abierto.",
        cancel: "Cancelar",
        confirm: "Eliminar",
      },
      tweaksHelp:
        "Los ajustes son modificaciones visuales por punto de quiebre y estado superpuestas al diseño base. Restablece un control para volver al valor heredado.",
    },
  },
  "fr-FR": {
    designEditor: {
      breakpointBar: {
        base: "Base",
        editBaseWidth: "Modifier la largeur de base",
        addBreakpoint: "Ajouter un point d'arrêt",
        remove: "Supprimer le point d'arrêt",
        options: "Options du point d'arrêt",
        changeWidth: "Modifier la largeur",
        customWidth: "Largeur personnalisée",
        add: "Ajouter",
        showAllBreakpoints: "Afficher tous les points d'arrêt",
        desktop: "Bureau",
        tablet: "Tablette",
        phone: "Téléphone",
        scope: {
          label: "Portée de modification responsive",
          cascadeSmaller: "Ce point et tailles inférieures",
          only: "Ce point uniquement",
          firstEditGuidance:
            "Les modifications responsive affectent ce point et les tailles inférieures par défaut. Modifiez la portée à côté du contrôle.",
        },
      },
      screenDeletion: {
        titleOne: "Supprimer cet écran ?",
        titleMany: "Supprimer {{count}} écrans ?",
        descriptionOne:
          "« {{filename}} » et toutes ses variantes responsive seront supprimés. Vous pouvez annuler tant que l’éditeur reste ouvert.",
        descriptionMany:
          "Ces écrans et toutes leurs variantes responsive seront supprimés. Vous pouvez annuler tant que l’éditeur reste ouvert.",
        cancel: "Annuler",
        confirm: "Supprimer",
      },
      tweaksHelp:
        "Les ajustements sont des surcharges visuelles propres aux points d’arrêt et aux états, superposées au design de base. Réinitialisez un contrôle pour revenir à la valeur héritée.",
    },
  },
  "de-DE": {
    designEditor: {
      breakpointBar: {
        base: "Basis",
        editBaseWidth: "Basisbreite bearbeiten",
        addBreakpoint: "Haltepunkt hinzufügen",
        remove: "Haltepunkt entfernen",
        options: "Haltepunkt-Optionen",
        changeWidth: "Breite ändern",
        customWidth: "Benutzerdefinierte Breite",
        add: "Hinzufügen",
        showAllBreakpoints: "Alle Haltepunkte anzeigen",
        desktop: "Desktop",
        tablet: "Tablet",
        phone: "Telefon",
        scope: {
          label: "Responsiver Bearbeitungsbereich",
          cascadeSmaller: "Dieser Haltepunkt und kleiner",
          only: "Nur dieser Haltepunkt",
          firstEditGuidance:
            "Responsive Änderungen gelten standardmäßig für diesen Haltepunkt und kleinere Größen. Der Bereich kann daneben geändert werden.",
        },
      },
      screenDeletion: {
        titleOne: "Diesen Bildschirm löschen?",
        titleMany: "{{count}} Bildschirme löschen?",
        descriptionOne:
          "„{{filename}}“ und alle responsiven Varianten werden gelöscht. Solange der Editor geöffnet bleibt, können Sie dies rückgängig machen.",
        descriptionMany:
          "Diese Bildschirme und alle responsiven Varianten werden gelöscht. Solange der Editor geöffnet bleibt, können Sie dies rückgängig machen.",
        cancel: "Abbrechen",
        confirm: "Löschen",
      },
      tweaksHelp:
        "Anpassungen sind breakpoint- und zustandsspezifische visuelle Überschreibungen über dem Basisdesign. Setzen Sie ein Steuerelement zurück, um den geerbten Wert wiederherzustellen.",
    },
  },
  "ja-JP": {
    designEditor: {
      breakpointBar: {
        base: "ベース",
        editBaseWidth: "ベース幅を編集",
        addBreakpoint: "ブレークポイントを追加",
        remove: "ブレークポイントを削除",
        options: "ブレークポイント オプション",
        changeWidth: "幅を変更",
        customWidth: "カスタム幅",
        add: "追加",
        showAllBreakpoints: "すべてのブレークポイントを表示",
        desktop: "デスクトップ",
        tablet: "タブレット",
        phone: "モバイル",
        scope: {
          label: "レスポンシブ編集範囲",
          cascadeSmaller: "このブレークポイント以下",
          only: "このブレークポイントのみ",
          firstEditGuidance:
            "レスポンシブ編集は既定でこのブレークポイント以下に適用されます。横のコントロールで範囲を変更できます。",
        },
      },
      screenDeletion: {
        titleOne: "この画面を削除しますか？",
        titleMany: "{{count}} 個の画面を削除しますか？",
        descriptionOne:
          "「{{filename}}」とすべてのレスポンシブバリエーションが削除されます。エディターを開いている間は元に戻せます。",
        descriptionMany:
          "これらの画面とすべてのレスポンシブバリエーションが削除されます。エディターを開いている間は元に戻せます。",
        cancel: "キャンセル",
        confirm: "削除",
      },
      tweaksHelp:
        "調整はベースデザインに重ねる、ブレークポイントおよび状態固有の視覚的オーバーライドです。コントロールをリセットすると継承値に戻ります。",
    },
  },
  "ko-KR": {
    designEditor: {
      breakpointBar: {
        base: "기본",
        editBaseWidth: "기본 너비 편집",
        addBreakpoint: "중단점 추가",
        remove: "중단점 제거",
        options: "중단점 옵션",
        changeWidth: "너비 변경",
        customWidth: "사용자 지정 너비",
        add: "추가",
        showAllBreakpoints: "모든 중단점 표시",
        desktop: "데스크톱",
        tablet: "태블릿",
        phone: "휴대폰",
        scope: {
          label: "반응형 편집 범위",
          cascadeSmaller: "이 중단점 및 더 작은 크기",
          only: "이 중단점만",
          firstEditGuidance:
            "반응형 편집은 기본적으로 이 중단점과 더 작은 크기에 적용됩니다. 옆의 컨트롤에서 범위를 변경하세요.",
        },
      },
      screenDeletion: {
        titleOne: "이 화면을 삭제할까요?",
        titleMany: "화면 {{count}}개를 삭제할까요?",
        descriptionOne:
          "“{{filename}}” 및 모든 반응형 변형이 삭제됩니다. 편집기가 열려 있는 동안 실행 취소할 수 있습니다.",
        descriptionMany:
          "이 화면들과 모든 반응형 변형이 삭제됩니다. 편집기가 열려 있는 동안 실행 취소할 수 있습니다.",
        cancel: "취소",
        confirm: "삭제",
      },
      tweaksHelp:
        "조정은 기본 디자인 위에 적용되는 중단점 및 상태별 시각적 재정의입니다. 컨트롤을 재설정하면 상속된 값으로 돌아갑니다.",
    },
  },
  "pt-BR": {
    designEditor: {
      breakpointBar: {
        base: "Base",
        editBaseWidth: "Editar largura base",
        addBreakpoint: "Adicionar ponto de interrupção",
        remove: "Remover ponto de interrupção",
        options: "Opções de ponto de interrupção",
        changeWidth: "Alterar largura",
        customWidth: "Largura personalizada",
        add: "Adicionar",
        showAllBreakpoints: "Mostrar todos os pontos de interrupção",
        desktop: "Desktop",
        tablet: "Tablet",
        phone: "Telefone",
        scope: {
          label: "Escopo de edição responsiva",
          cascadeSmaller: "Este ponto e tamanhos menores",
          only: "Somente este ponto",
          firstEditGuidance:
            "As edições responsivas afetam este ponto e tamanhos menores por padrão. Altere o escopo ao lado do controle.",
        },
      },
      screenDeletion: {
        titleOne: "Excluir esta tela?",
        titleMany: "Excluir {{count}} telas?",
        descriptionOne:
          "“{{filename}}” e todas as suas variações responsivas serão excluídas. Você pode desfazer enquanto o editor permanecer aberto.",
        descriptionMany:
          "Estas telas e todas as suas variações responsivas serão excluídas. Você pode desfazer enquanto o editor permanecer aberto.",
        cancel: "Cancelar",
        confirm: "Excluir",
      },
      tweaksHelp:
        "Os ajustes são substituições visuais específicas de breakpoint e estado sobre o design base. Redefina um controle para voltar ao valor herdado.",
    },
  },
  "hi-IN": {
    designEditor: {
      breakpointBar: {
        base: "आधार",
        editBaseWidth: "आधार चौड़ाई संपादित करें",
        addBreakpoint: "ब्रेकपॉइंट जोड़ें",
        remove: "ब्रेकपॉइंट हटाएं",
        options: "ब्रेकपॉइंट विकल्प",
        changeWidth: "चौड़ाई बदलें",
        customWidth: "कस्टम चौड़ाई",
        add: "जोड़ें",
        showAllBreakpoints: "सभी ब्रेकपॉइंट दिखाएं",
        desktop: "डेस्कटॉप",
        tablet: "टैबलेट",
        phone: "फ़ोन",
        scope: {
          label: "रेस्पॉन्सिव संपादन दायरा",
          cascadeSmaller: "यह ब्रेकपॉइंट और छोटे आकार",
          only: "केवल यह ब्रेकपॉइंट",
          firstEditGuidance:
            "रेस्पॉन्सिव संपादन डिफ़ॉल्ट रूप से इस ब्रेकपॉइंट और छोटे आकारों पर लागू होते हैं। पास के कंट्रोल से दायरा बदलें।",
        },
      },
      screenDeletion: {
        titleOne: "यह स्क्रीन हटाएँ?",
        titleMany: "{{count}} स्क्रीन हटाएँ?",
        descriptionOne:
          "“{{filename}}” और उसके सभी रेस्पॉन्सिव रूप हटाए जाएँगे। एडिटर खुला रहने तक आप इसे पूर्ववत कर सकते हैं।",
        descriptionMany:
          "ये स्क्रीन और इनके सभी रेस्पॉन्सिव रूप हटाए जाएँगे। एडिटर खुला रहने तक आप इसे पूर्ववत कर सकते हैं।",
        cancel: "रद्द करें",
        confirm: "हटाएँ",
      },
      tweaksHelp:
        "ट्वीक्स आधार डिज़ाइन पर लागू ब्रेकपॉइंट और स्थिति-विशिष्ट विज़ुअल ओवरराइड हैं। विरासत में मिले मान पर लौटने के लिए कंट्रोल रीसेट करें।",
    },
  },
  "ar-SA": {
    designEditor: {
      breakpointBar: {
        base: "الأساس",
        editBaseWidth: "تحرير عرض الأساس",
        addBreakpoint: "إضافة نقطة توقف",
        remove: "إزالة نقطة التوقف",
        options: "خيارات نقطة التوقف",
        changeWidth: "تغيير العرض",
        customWidth: "عرض مخصص",
        add: "إضافة",
        showAllBreakpoints: "عرض جميع نقاط التوقف",
        desktop: "سطح المكتب",
        tablet: "الجهاز اللوحي",
        phone: "الهاتف",
        scope: {
          label: "نطاق التحرير المتجاوب",
          cascadeSmaller: "نقطة التوقف هذه والأحجام الأصغر",
          only: "نقطة التوقف هذه فقط",
          firstEditGuidance:
            "تؤثر التعديلات المتجاوبة افتراضيًا في نقطة التوقف هذه والأحجام الأصغر. غيّر النطاق بجوار عنصر التحكم.",
        },
      },
      screenDeletion: {
        titleOne: "حذف هذه الشاشة؟",
        titleMany: "حذف {{count}} شاشة؟",
        descriptionOne:
          'سيتم حذف "{{filename}}" وجميع تنويعاته المتجاوبة. يمكنك التراجع ما دام المحرر مفتوحًا.',
        descriptionMany:
          "سيتم حذف هذه الشاشات وجميع تنويعاتها المتجاوبة. يمكنك التراجع ما دام المحرر مفتوحًا.",
        cancel: "إلغاء",
        confirm: "حذف",
      },
      tweaksHelp:
        "التعديلات هي تجاوزات مرئية خاصة بنقطة التوقف والحالة فوق التصميم الأساسي. أعد ضبط عنصر التحكم للعودة إلى القيمة الموروثة.",
    },
  },
};
