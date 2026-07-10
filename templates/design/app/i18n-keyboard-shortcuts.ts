import type { LocaleCode } from "@agent-native/core/client";

interface KeyboardShortcutLabels {
  title: string;
  essential: string;
  shape: string;
  selection: string;
  cursor: string;
  transform: string;
  arrange: string;
  components: string;
  hideUiDescription: string;
  undoDescription: string;
  redoDescription: string;
}

interface KeyboardKeyLabels {
  or: string;
  command: string;
  control: string;
  option: string;
  alt: string;
  shift: string;
  arrowDown: string;
  arrowLeft: string;
  arrowRight: string;
  arrowUp: string;
  backspace: string;
  delete: string;
  enter: string;
  tab: string;
  questionMark: string;
  backslash: string;
  equals: string;
  minus: string;
  leftBracket: string;
  rightBracket: string;
}

export const keyboardShortcutLabels = {
  "zh-TW": {
    title: "鍵盤快速鍵",
    essential: "基本",
    shape: "形狀",
    selection: "選取",
    cursor: "游標",
    transform: "變形",
    arrange: "排列",
    components: "元件",
    hideUiDescription: "立即按下以快速隱藏面板並專注於工作",
    undoDescription: "逐步回復最近的設計變更",
    redoDescription: "還原剛才復原的設計變更",
  },
  "zh-CN": {
    title: "键盘快捷键",
    essential: "基本",
    shape: "形状",
    selection: "选择",
    cursor: "光标",
    transform: "变换",
    arrange: "排列",
    components: "组件",
    hideUiDescription: "立即按下以快速隐藏面板并专注于工作",
    undoDescription: "逐步撤销最近的设计更改",
    redoDescription: "恢复刚刚撤销的设计更改",
  },
  "es-ES": {
    title: "Atajos de teclado",
    essential: "Esenciales",
    shape: "Formas",
    selection: "Selección",
    cursor: "Cursor",
    transform: "Transformar",
    arrange: "Organizar",
    components: "Componentes",
    hideUiDescription:
      "Púlsalo ahora para ocultar los paneles y concentrarte en tu trabajo",
    undoDescription: "Retrocede por el cambio de diseño más reciente",
    redoDescription: "Restaura el cambio de diseño que acabas de deshacer",
  },
  "fr-FR": {
    title: "Raccourcis clavier",
    essential: "Essentiels",
    shape: "Formes",
    selection: "Sélection",
    cursor: "Curseur",
    transform: "Transformer",
    arrange: "Organiser",
    components: "Composants",
    hideUiDescription:
      "Appuyez maintenant pour masquer les panneaux et vous concentrer sur votre travail",
    undoDescription: "Revenez sur votre dernière modification de design",
    redoDescription:
      "Restaurez la modification de design que vous venez d’annuler",
  },
  "de-DE": {
    title: "Tastenkürzel",
    essential: "Grundlagen",
    shape: "Formen",
    selection: "Auswahl",
    cursor: "Zeiger",
    transform: "Transformieren",
    arrange: "Anordnen",
    components: "Komponenten",
    hideUiDescription:
      "Drücke jetzt, um die Bereiche auszublenden und dich auf deine Arbeit zu konzentrieren",
    undoDescription: "Mache die letzte Designänderung rückgängig",
    redoDescription:
      "Stelle die soeben rückgängig gemachte Designänderung wieder her",
  },
  "ja-JP": {
    title: "キーボードショートカット",
    essential: "基本",
    shape: "シェイプ",
    selection: "選択",
    cursor: "カーソル",
    transform: "変形",
    arrange: "配置",
    components: "コンポーネント",
    hideUiDescription: "今すぐ押してパネルを隠し、作業に集中できます",
    undoDescription: "直前のデザイン変更を元に戻します",
    redoDescription: "元に戻したデザイン変更を復元します",
  },
  "ko-KR": {
    title: "키보드 단축키",
    essential: "필수",
    shape: "도형",
    selection: "선택",
    cursor: "커서",
    transform: "변형",
    arrange: "정렬",
    components: "컴포넌트",
    hideUiDescription: "지금 눌러 패널을 빠르게 숨기고 작업에 집중하세요",
    undoDescription: "가장 최근 디자인 변경을 되돌립니다",
    redoDescription: "방금 실행 취소한 디자인 변경을 복원합니다",
  },
  "pt-BR": {
    title: "Atalhos de teclado",
    essential: "Essenciais",
    shape: "Formas",
    selection: "Seleção",
    cursor: "Cursor",
    transform: "Transformar",
    arrange: "Organizar",
    components: "Componentes",
    hideUiDescription:
      "Pressione agora para ocultar os painéis e focar no seu trabalho",
    undoDescription: "Desfaça a alteração de design mais recente",
    redoDescription:
      "Restaure a alteração de design que você acabou de desfazer",
  },
  "hi-IN": {
    title: "कीबोर्ड शॉर्टकट",
    essential: "आवश्यक",
    shape: "आकृति",
    selection: "चयन",
    cursor: "कर्सर",
    transform: "रूपांतरण",
    arrange: "व्यवस्थित करें",
    components: "कॉम्पोनेंट",
    hideUiDescription: "पैनल तुरंत छिपाकर अपने काम पर ध्यान देने के लिए इसे अभी दबाएँ",
    undoDescription: "सबसे हाल के डिज़ाइन बदलाव को वापस करें",
    redoDescription: "अभी वापस किए गए डिज़ाइन बदलाव को फिर से लागू करें",
  },
  "ar-SA": {
    title: "اختصارات لوحة المفاتيح",
    essential: "أساسي",
    shape: "الأشكال",
    selection: "التحديد",
    cursor: "المؤشر",
    transform: "التحويل",
    arrange: "الترتيب",
    components: "المكونات",
    hideUiDescription: "اضغطه الآن لإخفاء اللوحات بسرعة والتركيز على عملك",
    undoDescription: "تراجع عن أحدث تغيير في التصميم",
    redoDescription: "استعد تغيير التصميم الذي تراجعت عنه للتو",
  },
} satisfies Record<Exclude<LocaleCode, "en-US">, KeyboardShortcutLabels>;

export const keyboardKeyLabels = {
  "zh-TW": {
    or: "或",
    command: "Command 鍵",
    control: "Control 鍵",
    option: "Option 鍵",
    alt: "Alt 鍵",
    shift: "Shift 鍵",
    arrowDown: "下方向鍵",
    arrowLeft: "左方向鍵",
    arrowRight: "右方向鍵",
    arrowUp: "上方向鍵",
    backspace: "退格鍵",
    delete: "刪除鍵",
    enter: "Enter 鍵",
    tab: "Tab 鍵",
    questionMark: "問號",
    backslash: "反斜線",
    equals: "等號",
    minus: "減號",
    leftBracket: "左方括號",
    rightBracket: "右方括號",
  },
  "zh-CN": {
    or: "或",
    command: "Command 键",
    control: "Control 键",
    option: "Option 键",
    alt: "Alt 键",
    shift: "Shift 键",
    arrowDown: "向下箭头键",
    arrowLeft: "向左箭头键",
    arrowRight: "向右箭头键",
    arrowUp: "向上箭头键",
    backspace: "退格键",
    delete: "删除键",
    enter: "Enter 键",
    tab: "Tab 键",
    questionMark: "问号",
    backslash: "反斜杠",
    equals: "等号",
    minus: "减号",
    leftBracket: "左方括号",
    rightBracket: "右方括号",
  },
  "es-ES": {
    or: "o",
    command: "Comando",
    control: "Control",
    option: "Opción",
    alt: "Alt",
    shift: "Mayús",
    arrowDown: "Flecha abajo",
    arrowLeft: "Flecha izquierda",
    arrowRight: "Flecha derecha",
    arrowUp: "Flecha arriba",
    backspace: "Retroceso",
    delete: "Suprimir",
    enter: "Intro",
    tab: "Tabulador",
    questionMark: "Signo de interrogación",
    backslash: "Barra invertida",
    equals: "Igual",
    minus: "Menos",
    leftBracket: "Corchete izquierdo",
    rightBracket: "Corchete derecho",
  },
  "fr-FR": {
    or: "ou",
    command: "Commande",
    control: "Contrôle",
    option: "Option",
    alt: "Alt",
    shift: "Majuscule",
    arrowDown: "Flèche vers le bas",
    arrowLeft: "Flèche vers la gauche",
    arrowRight: "Flèche vers la droite",
    arrowUp: "Flèche vers le haut",
    backspace: "Retour arrière",
    delete: "Supprimer",
    enter: "Entrée",
    tab: "Tabulation",
    questionMark: "Point d’interrogation",
    backslash: "Barre oblique inverse",
    equals: "Égal",
    minus: "Moins",
    leftBracket: "Crochet gauche",
    rightBracket: "Crochet droit",
  },
  "de-DE": {
    or: "oder",
    command: "Befehl",
    control: "Steuerung",
    option: "Wahltaste",
    alt: "Alt",
    shift: "Umschalt",
    arrowDown: "Pfeil nach unten",
    arrowLeft: "Pfeil nach links",
    arrowRight: "Pfeil nach rechts",
    arrowUp: "Pfeil nach oben",
    backspace: "Rücktaste",
    delete: "Entfernen",
    enter: "Eingabetaste",
    tab: "Tabulatortaste",
    questionMark: "Fragezeichen",
    backslash: "Umgekehrter Schrägstrich",
    equals: "Gleichheitszeichen",
    minus: "Minuszeichen",
    leftBracket: "Linke eckige Klammer",
    rightBracket: "Rechte eckige Klammer",
  },
  "ja-JP": {
    or: "または",
    command: "Commandキー",
    control: "Controlキー",
    option: "Optionキー",
    alt: "Altキー",
    shift: "Shiftキー",
    arrowDown: "下矢印キー",
    arrowLeft: "左矢印キー",
    arrowRight: "右矢印キー",
    arrowUp: "上矢印キー",
    backspace: "Backspaceキー",
    delete: "Deleteキー",
    enter: "Enterキー",
    tab: "Tabキー",
    questionMark: "疑問符",
    backslash: "バックスラッシュ",
    equals: "等号",
    minus: "マイナス",
    leftBracket: "左角括弧",
    rightBracket: "右角括弧",
  },
  "ko-KR": {
    or: "또는",
    command: "Command 키",
    control: "Control 키",
    option: "Option 키",
    alt: "Alt 키",
    shift: "Shift 키",
    arrowDown: "아래쪽 화살표 키",
    arrowLeft: "왼쪽 화살표 키",
    arrowRight: "오른쪽 화살표 키",
    arrowUp: "위쪽 화살표 키",
    backspace: "백스페이스 키",
    delete: "Delete 키",
    enter: "Enter 키",
    tab: "Tab 키",
    questionMark: "물음표",
    backslash: "백슬래시",
    equals: "등호",
    minus: "빼기 기호",
    leftBracket: "왼쪽 대괄호",
    rightBracket: "오른쪽 대괄호",
  },
  "pt-BR": {
    or: "ou",
    command: "Comando",
    control: "Control",
    option: "Opção",
    alt: "Alt",
    shift: "Shift",
    arrowDown: "Seta para baixo",
    arrowLeft: "Seta para a esquerda",
    arrowRight: "Seta para a direita",
    arrowUp: "Seta para cima",
    backspace: "Backspace",
    delete: "Excluir",
    enter: "Enter",
    tab: "Tab",
    questionMark: "Ponto de interrogação",
    backslash: "Barra invertida",
    equals: "Igual",
    minus: "Menos",
    leftBracket: "Colchete esquerdo",
    rightBracket: "Colchete direito",
  },
  "hi-IN": {
    or: "या",
    command: "Command कुंजी",
    control: "Control कुंजी",
    option: "Option कुंजी",
    alt: "Alt कुंजी",
    shift: "Shift कुंजी",
    arrowDown: "नीचे तीर कुंजी",
    arrowLeft: "बायाँ तीर कुंजी",
    arrowRight: "दायाँ तीर कुंजी",
    arrowUp: "ऊपर तीर कुंजी",
    backspace: "Backspace कुंजी",
    delete: "Delete कुंजी",
    enter: "Enter कुंजी",
    tab: "Tab कुंजी",
    questionMark: "प्रश्न चिह्न",
    backslash: "बैकस्लैश",
    equals: "बराबर चिह्न",
    minus: "ऋण चिह्न",
    leftBracket: "बायाँ कोष्ठक",
    rightBracket: "दायाँ कोष्ठक",
  },
  "ar-SA": {
    or: "أو",
    command: "مفتاح Command",
    control: "مفتاح Control",
    option: "مفتاح Option",
    alt: "مفتاح Alt",
    shift: "مفتاح Shift",
    arrowDown: "مفتاح السهم لأسفل",
    arrowLeft: "مفتاح السهم لليسار",
    arrowRight: "مفتاح السهم لليمين",
    arrowUp: "مفتاح السهم لأعلى",
    backspace: "مفتاح Backspace",
    delete: "مفتاح Delete",
    enter: "مفتاح Enter",
    tab: "مفتاح Tab",
    questionMark: "علامة الاستفهام",
    backslash: "الشرطة المائلة العكسية",
    equals: "علامة يساوي",
    minus: "علامة الطرح",
    leftBracket: "القوس المربع الأيسر",
    rightBracket: "القوس المربع الأيمن",
  },
} satisfies Record<Exclude<LocaleCode, "en-US">, KeyboardKeyLabels>;

interface KeyboardMessagesSource {
  editPanel: {
    properties: string;
    sections: {
      layout: string;
      autoLayout: string;
      fill: string;
      stroke: string;
      codeConfidence: string;
    };
    labels: { align: string };
    alignOptions: { start: string; center: string; end: string };
    textDecorations: { underline: string; strikethrough: string };
  };
  designEditor: {
    leftRail: { tools: string; assets: string };
    modes: { edit: string; draw: string };
    tools: Record<
      | "move"
      | "frame"
      | "text"
      | "pen"
      | "hand"
      | "scale"
      | "rect"
      | "ellipse"
      | "line"
      | "arrow",
      string
    >;
    undo: string;
    redo: string;
    view: string;
    zoom: string;
    zoomIn: string;
    zoomOut: string;
    fitToScreen: string;
    pinComment: string;
    downloadPng: string;
    close: string;
    componentInstances: { detach: string };
  };
  layersPanel: {
    title: string;
    screens: string;
    searchPlaceholder: string;
    copy: string;
    pasteHere: string;
    pasteToReplace: string;
    duplicate: string;
    delete: string;
    rename: string;
    flipHorizontal: string;
    flipVertical: string;
    bringForward: string;
    bringToFront: string;
    sendBackward: string;
    sendToBack: string;
    group: string;
    ungroup: string;
    frameSelection: string;
  };
}

export function attachLocalizedKeyboardShortcuts<
  T extends KeyboardMessagesSource,
>(
  messages: T,
  labels: KeyboardShortcutLabels,
  keyLabels: KeyboardKeyLabels,
): T {
  const d = messages.designEditor;
  const layers = messages.layersPanel;
  const edit = messages.editPanel;
  return {
    ...messages,
    designEditor: {
      ...d,
      keyboardShortcuts: {
        title: labels.title,
        close: `${d.close}: ${labels.title}`,
        codeContext: edit.sections.codeConfidence,
        screenContext: layers.screens,
        keys: keyLabels,
        descriptions: {
          toggleUi: labels.hideUiDescription,
          undo: labels.undoDescription,
          redo: labels.redoDescription,
        },
        categories: {
          essential: labels.essential,
          tools: d.leftRail.tools,
          view: d.view,
          zoom: d.zoom,
          text: d.tools.text,
          shape: labels.shape,
          selection: labels.selection,
          cursor: labels.cursor,
          edit: d.modes.edit,
          transform: labels.transform,
          arrange: labels.arrange,
          components: labels.components,
          layout: edit.sections.layout,
        },
        commands: {
          showShortcuts: labels.title,
          undo: d.undo,
          redo: d.redo,
          moveTool: d.tools.move,
          frameTool: d.tools.frame,
          textTool: d.tools.text,
          penTool: d.tools.pen,
          handTool: d.tools.hand,
          scaleTool: d.tools.scale,
          commentTool: d.pinComment,
          drawTool: d.modes.draw,
          showLayers: layers.title,
          showAssets: d.leftRail.assets,
          toggleUi: d.view,
          toggleComments: d.pinComment,
          zoomIn: d.zoomIn,
          zoomOut: d.zoomOut,
          zoomReset: `${d.zoom} 100%`,
          zoomFit: d.fitToScreen,
          zoomSelection: `${d.zoom}: ${labels.selection}`,
          underline: edit.textDecorations.underline,
          strikethrough: edit.textDecorations.strikethrough,
          rectangle: d.tools.rect,
          ellipse: d.tools.ellipse,
          line: d.tools.line,
          arrow: d.tools.arrow,
          selectAll: labels.selection,
          selectParent: `${labels.selection}: ${layers.title}`,
          enterSelection: labels.selection,
          nextSibling: `${labels.selection} →`,
          previousSibling: `← ${labels.selection}`,
          nextScreen: `${layers.screens} →`,
          previousScreen: `← ${layers.screens}`,
          nudge: d.tools.move,
          nudgeLarge: `${d.tools.move} 10`,
          copy: layers.copy,
          copyPng: `${layers.copy} PNG`,
          cut: layers.delete,
          paste: layers.pasteHere,
          pasteOver: layers.pasteToReplace,
          copyProperties: `${layers.copy}: ${edit.properties}`,
          pasteProperties: `${layers.pasteHere}: ${edit.properties}`,
          pasteReplace: layers.pasteToReplace,
          duplicate: layers.duplicate,
          delete: layers.delete,
          rename: layers.rename,
          find: layers.searchPlaceholder,
          flipHorizontal: layers.flipHorizontal,
          flipVertical: layers.flipVertical,
          swapFillStroke: `${edit.sections.fill} / ${edit.sections.stroke}`,
          bringForward: layers.bringForward,
          sendBackward: layers.sendBackward,
          bringFront: layers.bringToFront,
          sendBack: layers.sendToBack,
          alignLeft: `${edit.labels.align}: ${edit.alignOptions.start}`,
          alignRight: `${edit.labels.align}: ${edit.alignOptions.end}`,
          alignTop: `${edit.labels.align}: ${edit.alignOptions.start}`,
          alignBottom: `${edit.labels.align}: ${edit.alignOptions.end}`,
          tidy: edit.sections.autoLayout,
          createComponent: labels.components,
          detachInstance: d.componentInstances.detach,
          group: layers.group,
          ungroup: layers.ungroup,
          frameSelection: layers.frameSelection,
          autoLayout: edit.sections.autoLayout,
        },
      },
    },
  } as T;
}
