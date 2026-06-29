import {
  IconChevronDown,
  IconPlus,
  IconSettings,
  IconStar,
  IconStarFilled,
  IconTrash,
  IconDots,
  IconPencil,
  IconGripVertical,
  IconTool,
  IconEye,
  IconEyeOff,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { extensionPath, isExtensionPathname } from "../../extensions/path.js";
import { sendToAgentChat } from "../agent-chat.js";
import { agentNativePath } from "../api-path.js";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.js";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "../components/ui/hover-card.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { PromptComposer } from "../composer/PromptComposer.js";
import { DEFAULT_LOCALE, useOptionalLocale, type LocaleCode } from "../i18n.js";
import { cn } from "../utils.js";
import {
  deleteOrHideExtension,
  invalidateExtensionRemoval,
} from "./delete-extension.js";
import {
  applyToolsOrder,
  getToolsOrder,
  setToolsOrder,
} from "./extension-order.js";
import {
  extensionPopularityOf,
  useExtensionPopularity,
} from "./extension-popularity.js";

interface Extension {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  canDelete?: boolean;
  globallyHidden?: boolean;
  source?: {
    mode?: "database" | "local-files";
    entryPath?: string;
  };
}

const FAVORITES_KEY = "extensions-favorites";
const COLLAPSED_EXTENSION_COUNT = 3;
const EXTENSIONS_OPEN_KEY = "extensions-sidebar-open";
const EXTENSIONS_SORT_MODE_KEY = "extensions-sort-mode";

type ExtensionSortMode = "most-used" | "alphabetical" | "manual";

type ExtensionsCopy = {
  title: string;
  description: string;
  open: string;
  learnMore: string;
  sortOptions: string;
  sortTooltip: string;
  sortBy: string;
  mostUsed: string;
  alphabetical: string;
  manualOrder: string;
  showHidden: string;
  newExtension: string;
  createPlaceholder: string;
  collapse: string;
  expand: string;
  reorder: (name: string) => string;
  dragToReorder: string;
  hiddenFromEveryone: string;
  file: string;
  unfavorite: string;
  favorite: string;
  actions: string;
  editInFiles: string;
  rename: string;
  unhideForEveryone: string;
  hideFromEveryone: string;
  removeFromMyList: string;
  delete: string;
  showLess: string;
  showMore: string;
};

const EXTENSIONS_COPY: Record<LocaleCode, ExtensionsCopy> = {
  "en-US": {
    title: "Extensions",
    description:
      "Build small sandboxed apps that can read app data, call actions, and save their own state.",
    open: "Open extensions",
    learnMore: "Learn more",
    sortOptions: "Extensions sort options",
    sortTooltip: "Extensions sort",
    sortBy: "Sort by",
    mostUsed: "Most used",
    alphabetical: "Alphabetical",
    manualOrder: "Manual order",
    showHidden: "Show hidden",
    newExtension: "New extension",
    createPlaceholder: "Describe what you'd like to build...",
    collapse: "Collapse extensions",
    expand: "Expand extensions",
    reorder: (name) => `Reorder ${name}`,
    dragToReorder: "Drag to reorder",
    hiddenFromEveryone: "Hidden from everyone",
    file: "File",
    unfavorite: "Unfavorite",
    favorite: "Favorite",
    actions: "Extension actions",
    editInFiles: "Edit in files",
    rename: "Rename",
    unhideForEveryone: "Unhide for everyone",
    hideFromEveryone: "Hide from everyone",
    removeFromMyList: "Remove from my list",
    delete: "Delete",
    showLess: "show less",
    showMore: "show more",
  },
  "zh-CN": {
    title: "扩展",
    description: "构建可读取应用数据、调用操作并保存自身状态的小型沙盒应用。",
    open: "打开扩展",
    learnMore: "了解更多",
    sortOptions: "扩展排序选项",
    sortTooltip: "扩展排序",
    sortBy: "排序方式",
    mostUsed: "最常用",
    alphabetical: "按字母顺序",
    manualOrder: "手动排序",
    showHidden: "显示隐藏项",
    newExtension: "新建扩展",
    createPlaceholder: "描述你想构建的内容...",
    collapse: "收起扩展",
    expand: "展开扩展",
    reorder: (name) => `重新排序 ${name}`,
    dragToReorder: "拖动以重新排序",
    hiddenFromEveryone: "已对所有人隐藏",
    file: "文件",
    unfavorite: "取消收藏",
    favorite: "收藏",
    actions: "扩展操作",
    editInFiles: "在文件中编辑",
    rename: "重命名",
    unhideForEveryone: "对所有人取消隐藏",
    hideFromEveryone: "对所有人隐藏",
    removeFromMyList: "从我的列表中移除",
    delete: "删除",
    showLess: "收起",
    showMore: "显示更多",
  },
  "zh-TW": {
    title: "擴充功能",
    description:
      "建立可讀取應用程式資料、呼叫動作並儲存自身狀態的小型沙盒應用程式。",
    open: "開啟擴充功能",
    learnMore: "了解更多",
    sortOptions: "擴充功能排序選項",
    sortTooltip: "擴充功能排序",
    sortBy: "排序方式",
    mostUsed: "最常用",
    alphabetical: "依字母排序",
    manualOrder: "手動排序",
    showHidden: "顯示隱藏項目",
    newExtension: "新增擴充功能",
    createPlaceholder: "描述你想建立的內容...",
    collapse: "收合擴充功能",
    expand: "展開擴充功能",
    reorder: (name) => `重新排序 ${name}`,
    dragToReorder: "拖曳以重新排序",
    hiddenFromEveryone: "已對所有人隱藏",
    file: "檔案",
    unfavorite: "取消最愛",
    favorite: "加入最愛",
    actions: "擴充功能動作",
    editInFiles: "在檔案中編輯",
    rename: "重新命名",
    unhideForEveryone: "對所有人取消隱藏",
    hideFromEveryone: "對所有人隱藏",
    removeFromMyList: "從我的清單移除",
    delete: "刪除",
    showLess: "顯示較少",
    showMore: "顯示更多",
  },
  "es-ES": {
    title: "Extensiones",
    description:
      "Crea pequeñas apps aisladas que pueden leer datos de la app, llamar acciones y guardar su propio estado.",
    open: "Abrir extensiones",
    learnMore: "Más información",
    sortOptions: "Opciones de orden de extensiones",
    sortTooltip: "Orden de extensiones",
    sortBy: "Ordenar por",
    mostUsed: "Más usadas",
    alphabetical: "Alfabético",
    manualOrder: "Orden manual",
    showHidden: "Mostrar ocultas",
    newExtension: "Nueva extensión",
    createPlaceholder: "Describe lo que quieres crear...",
    collapse: "Contraer extensiones",
    expand: "Expandir extensiones",
    reorder: (name) => `Reordenar ${name}`,
    dragToReorder: "Arrastra para reordenar",
    hiddenFromEveryone: "Oculta para todos",
    file: "Archivo",
    unfavorite: "Quitar de favoritos",
    favorite: "Favorito",
    actions: "Acciones de extensión",
    editInFiles: "Editar en archivos",
    rename: "Renombrar",
    unhideForEveryone: "Mostrar para todos",
    hideFromEveryone: "Ocultar para todos",
    removeFromMyList: "Quitar de mi lista",
    delete: "Eliminar",
    showLess: "mostrar menos",
    showMore: "mostrar más",
  },
  "fr-FR": {
    title: "Extensions",
    description:
      "Créez de petites apps sandboxées capables de lire les données de l'app, d'appeler des actions et d'enregistrer leur propre état.",
    open: "Ouvrir les extensions",
    learnMore: "En savoir plus",
    sortOptions: "Options de tri des extensions",
    sortTooltip: "Tri des extensions",
    sortBy: "Trier par",
    mostUsed: "Les plus utilisées",
    alphabetical: "Alphabétique",
    manualOrder: "Ordre manuel",
    showHidden: "Afficher les masquées",
    newExtension: "Nouvelle extension",
    createPlaceholder: "Décrivez ce que vous voulez créer...",
    collapse: "Replier les extensions",
    expand: "Déplier les extensions",
    reorder: (name) => `Réordonner ${name}`,
    dragToReorder: "Faire glisser pour réordonner",
    hiddenFromEveryone: "Masquée pour tout le monde",
    file: "Fichier",
    unfavorite: "Retirer des favoris",
    favorite: "Favori",
    actions: "Actions de l'extension",
    editInFiles: "Modifier dans les fichiers",
    rename: "Renommer",
    unhideForEveryone: "Afficher pour tout le monde",
    hideFromEveryone: "Masquer pour tout le monde",
    removeFromMyList: "Retirer de ma liste",
    delete: "Supprimer",
    showLess: "afficher moins",
    showMore: "afficher plus",
  },
  "de-DE": {
    title: "Erweiterungen",
    description:
      "Erstelle kleine Sandbox-Apps, die App-Daten lesen, Aktionen aufrufen und ihren eigenen Zustand speichern können.",
    open: "Erweiterungen öffnen",
    learnMore: "Mehr erfahren",
    sortOptions: "Sortieroptionen für Erweiterungen",
    sortTooltip: "Erweiterungen sortieren",
    sortBy: "Sortieren nach",
    mostUsed: "Am häufigsten genutzt",
    alphabetical: "Alphabetisch",
    manualOrder: "Manuelle Reihenfolge",
    showHidden: "Ausgeblendete anzeigen",
    newExtension: "Neue Erweiterung",
    createPlaceholder: "Beschreibe, was du erstellen möchtest...",
    collapse: "Erweiterungen einklappen",
    expand: "Erweiterungen ausklappen",
    reorder: (name) => `${name} neu anordnen`,
    dragToReorder: "Zum Neuordnen ziehen",
    hiddenFromEveryone: "Für alle ausgeblendet",
    file: "Datei",
    unfavorite: "Aus Favoriten entfernen",
    favorite: "Favorisieren",
    actions: "Erweiterungsaktionen",
    editInFiles: "In Dateien bearbeiten",
    rename: "Umbenennen",
    unhideForEveryone: "Für alle einblenden",
    hideFromEveryone: "Für alle ausblenden",
    removeFromMyList: "Aus meiner Liste entfernen",
    delete: "Löschen",
    showLess: "weniger anzeigen",
    showMore: "mehr anzeigen",
  },
  "ja-JP": {
    title: "拡張機能",
    description:
      "アプリデータを読み取り、アクションを呼び出し、独自の状態を保存できる小さなサンドボックスアプリを作成します。",
    open: "拡張機能を開く",
    learnMore: "詳しく見る",
    sortOptions: "拡張機能の並べ替えオプション",
    sortTooltip: "拡張機能の並べ替え",
    sortBy: "並べ替え",
    mostUsed: "よく使う順",
    alphabetical: "アルファベット順",
    manualOrder: "手動順",
    showHidden: "非表示を表示",
    newExtension: "新しい拡張機能",
    createPlaceholder: "作りたいものを説明してください...",
    collapse: "拡張機能を折りたたむ",
    expand: "拡張機能を展開",
    reorder: (name) => `${name} を並べ替え`,
    dragToReorder: "ドラッグして並べ替え",
    hiddenFromEveryone: "全員に非表示",
    file: "ファイル",
    unfavorite: "お気に入り解除",
    favorite: "お気に入り",
    actions: "拡張機能の操作",
    editInFiles: "ファイルで編集",
    rename: "名前を変更",
    unhideForEveryone: "全員に表示",
    hideFromEveryone: "全員に非表示",
    removeFromMyList: "自分のリストから削除",
    delete: "削除",
    showLess: "少なく表示",
    showMore: "さらに表示",
  },
  "ko-KR": {
    title: "확장",
    description:
      "앱 데이터를 읽고, 액션을 호출하고, 자체 상태를 저장할 수 있는 작은 샌드박스 앱을 만듭니다.",
    open: "확장 열기",
    learnMore: "자세히 알아보기",
    sortOptions: "확장 정렬 옵션",
    sortTooltip: "확장 정렬",
    sortBy: "정렬 기준",
    mostUsed: "가장 많이 사용",
    alphabetical: "가나다순",
    manualOrder: "수동 순서",
    showHidden: "숨김 항목 표시",
    newExtension: "새 확장",
    createPlaceholder: "만들고 싶은 것을 설명하세요...",
    collapse: "확장 접기",
    expand: "확장 펼치기",
    reorder: (name) => `${name} 순서 변경`,
    dragToReorder: "드래그하여 순서 변경",
    hiddenFromEveryone: "모두에게 숨김",
    file: "파일",
    unfavorite: "즐겨찾기 해제",
    favorite: "즐겨찾기",
    actions: "확장 작업",
    editInFiles: "파일에서 편집",
    rename: "이름 변경",
    unhideForEveryone: "모두에게 표시",
    hideFromEveryone: "모두에게 숨기기",
    removeFromMyList: "내 목록에서 제거",
    delete: "삭제",
    showLess: "덜 보기",
    showMore: "더 보기",
  },
  "pt-BR": {
    title: "Extensões",
    description:
      "Crie pequenos apps isolados que podem ler dados do app, chamar ações e salvar o próprio estado.",
    open: "Abrir extensões",
    learnMore: "Saiba mais",
    sortOptions: "Opções de ordenação das extensões",
    sortTooltip: "Ordenação das extensões",
    sortBy: "Ordenar por",
    mostUsed: "Mais usadas",
    alphabetical: "Alfabética",
    manualOrder: "Ordem manual",
    showHidden: "Mostrar ocultas",
    newExtension: "Nova extensão",
    createPlaceholder: "Descreva o que você quer criar...",
    collapse: "Recolher extensões",
    expand: "Expandir extensões",
    reorder: (name) => `Reordenar ${name}`,
    dragToReorder: "Arraste para reordenar",
    hiddenFromEveryone: "Oculta para todos",
    file: "Arquivo",
    unfavorite: "Remover dos favoritos",
    favorite: "Favoritar",
    actions: "Ações da extensão",
    editInFiles: "Editar em arquivos",
    rename: "Renomear",
    unhideForEveryone: "Mostrar para todos",
    hideFromEveryone: "Ocultar para todos",
    removeFromMyList: "Remover da minha lista",
    delete: "Excluir",
    showLess: "mostrar menos",
    showMore: "mostrar mais",
  },
  "hi-IN": {
    title: "एक्सटेंशन",
    description:
      "छोटे सैंडबॉक्स ऐप बनाएं जो ऐप डेटा पढ़ सकते हैं, कार्रवाइयां चला सकते हैं और अपना स्टेट सहेज सकते हैं।",
    open: "एक्सटेंशन खोलें",
    learnMore: "और जानें",
    sortOptions: "एक्सटेंशन क्रम विकल्प",
    sortTooltip: "एक्सटेंशन क्रम",
    sortBy: "इसके अनुसार क्रमबद्ध करें",
    mostUsed: "सबसे अधिक उपयोग",
    alphabetical: "वर्णानुक्रम",
    manualOrder: "मैन्युअल क्रम",
    showHidden: "छिपे हुए दिखाएं",
    newExtension: "नया एक्सटेंशन",
    createPlaceholder: "बताएं कि आप क्या बनाना चाहते हैं...",
    collapse: "एक्सटेंशन समेटें",
    expand: "एक्सटेंशन फैलाएं",
    reorder: (name) => `${name} का क्रम बदलें`,
    dragToReorder: "क्रम बदलने के लिए खींचें",
    hiddenFromEveryone: "सभी से छिपा हुआ",
    file: "फ़ाइल",
    unfavorite: "पसंदीदा से हटाएं",
    favorite: "पसंदीदा",
    actions: "एक्सटेंशन कार्रवाइयां",
    editInFiles: "फ़ाइलों में संपादित करें",
    rename: "नाम बदलें",
    unhideForEveryone: "सभी के लिए दिखाएं",
    hideFromEveryone: "सभी से छिपाएं",
    removeFromMyList: "मेरी सूची से हटाएं",
    delete: "हटाएं",
    showLess: "कम दिखाएं",
    showMore: "और दिखाएं",
  },
  "ar-SA": {
    title: "الإضافات",
    description:
      "أنشئ تطبيقات صغيرة معزولة يمكنها قراءة بيانات التطبيق واستدعاء الإجراءات وحفظ حالتها الخاصة.",
    open: "فتح الإضافات",
    learnMore: "معرفة المزيد",
    sortOptions: "خيارات ترتيب الإضافات",
    sortTooltip: "ترتيب الإضافات",
    sortBy: "ترتيب حسب",
    mostUsed: "الأكثر استخدامًا",
    alphabetical: "أبجديًا",
    manualOrder: "ترتيب يدوي",
    showHidden: "إظهار المخفية",
    newExtension: "إضافة جديدة",
    createPlaceholder: "صف ما تريد إنشاءه...",
    collapse: "طي الإضافات",
    expand: "توسيع الإضافات",
    reorder: (name) => `إعادة ترتيب ${name}`,
    dragToReorder: "اسحب لإعادة الترتيب",
    hiddenFromEveryone: "مخفية عن الجميع",
    file: "ملف",
    unfavorite: "إزالة من المفضلة",
    favorite: "إضافة إلى المفضلة",
    actions: "إجراءات الإضافة",
    editInFiles: "تحرير في الملفات",
    rename: "إعادة تسمية",
    unhideForEveryone: "إظهار للجميع",
    hideFromEveryone: "إخفاء عن الجميع",
    removeFromMyList: "إزالة من قائمتي",
    delete: "حذف",
    showLess: "إظهار أقل",
    showMore: "إظهار المزيد",
  },
};

function useExtensionsCopy() {
  const locale = useOptionalLocale()?.locale ?? DEFAULT_LOCALE;
  return EXTENSIONS_COPY[locale] ?? EXTENSIONS_COPY[DEFAULT_LOCALE];
}

function getFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveFavorites(ids: Set<string>) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // localStorage unavailable — ignore
  }
}

function getStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

function setStoredBoolean(key: string, value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // localStorage unavailable — ignore
  }
}

function getSortMode(): ExtensionSortMode {
  if (typeof window === "undefined") return "most-used";
  const raw = window.localStorage.getItem(EXTENSIONS_SORT_MODE_KEY);
  if (raw === "alphabetical" || raw === "manual" || raw === "most-used") {
    return raw;
  }
  return "most-used";
}

function setSortMode(mode: ExtensionSortMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(EXTENSIONS_SORT_MODE_KEY, mode);
  } catch {
    // localStorage unavailable — ignore
  }
}

function sortByName<T extends { id: string; name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const name = a.name.localeCompare(b.name);
    return name !== 0 ? name : a.id.localeCompare(b.id);
  });
}

function ExtensionSortMenu({
  value,
  onChange,
  showHidden,
  onShowHiddenChange,
  copy,
}: {
  value: ExtensionSortMode;
  onChange: (value: ExtensionSortMode) => void;
  showHidden: boolean;
  onShowHiddenChange: (next: boolean) => void;
  copy: ExtensionsCopy;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/45 opacity-0 transition-all hover:bg-accent hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring group-hover/extensions-section:opacity-100"
              aria-label={copy.sortOptions}
            >
              <IconSettings className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{copy.sortTooltip}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="right" align="start" className="w-44">
        <DropdownMenuLabel>{copy.sortBy}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (
              next === "most-used" ||
              next === "alphabetical" ||
              next === "manual"
            ) {
              onChange(next);
            }
          }}
        >
          <DropdownMenuRadioItem value="most-used">
            {copy.mostUsed}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="alphabetical">
            {copy.alphabetical}
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          <DropdownMenuRadioItem value="manual">
            {copy.manualOrder}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={showHidden}
          onCheckedChange={(checked) => onShowHiddenChange(Boolean(checked))}
        >
          {copy.showHidden}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ExtensionsSidebarSection() {
  const copy = useExtensionsCopy();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const popularity = useExtensionPopularity();
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() =>
    typeof window !== "undefined" ? getFavorites() : new Set(),
  );
  const [extensionsOpen, setExtensionsOpen] = useState(() =>
    getStoredBoolean(EXTENSIONS_OPEN_KEY, true),
  );
  const [sortModeState, setSortModeState] =
    useState<ExtensionSortMode>(getSortMode);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [toolOrderState, setToolOrderState] = useState<string[]>(() =>
    typeof window !== "undefined" ? getToolsOrder() : [],
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [showAllExtensions, setShowAllExtensions] = useState(false);
  const [showGloballyHidden, setShowGloballyHidden] = useState(false);

  const { data: extensions, isLoading } = useQuery<Extension[]>({
    queryKey: ["extensions", { includeGloballyHidden: showGloballyHidden }],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath(
          showGloballyHidden
            ? "/_agent-native/extensions?includeGloballyHidden=true"
            : "/_agent-native/extensions",
        ),
      );
      if (!res.ok) return [];
      return res.json();
    },
  });

  const toggleFavorite = useCallback((id: string) => {
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      saveFavorites(next);
      return next;
    });
  }, []);

  const setExtensionSortMode = useCallback((mode: ExtensionSortMode) => {
    setSortMode(mode);
    setSortModeState(mode);
  }, []);

  const toggleExtensionsOpen = useCallback(() => {
    setExtensionsOpen((current) => {
      const next = !current;
      setStoredBoolean(EXTENSIONS_OPEN_KEY, next);
      return next;
    });
  }, []);

  const handleDelete = useCallback(
    async (extension: Extension) => {
      const extensionId = extension.id;
      setMenuOpenId(null);
      const prev = queryClient.getQueryData<Extension[]>(["extensions"]);
      queryClient.setQueryData<Extension[]>(["extensions"], (old) =>
        (old ?? []).filter((t) => t.id !== extensionId),
      );
      try {
        await deleteOrHideExtension(extension);
        invalidateExtensionRemoval(queryClient, extensionId);
        setFavoriteIds((prev) => {
          const next = new Set(prev);
          next.delete(extensionId);
          saveFavorites(next);
          return next;
        });
        setToolOrderState((prev) => {
          const next = prev.filter((id) => id !== extensionId);
          if (next.length !== prev.length) setToolsOrder(next);
          return next;
        });
        if (isExtensionPathname(location.pathname, extensionId)) {
          navigate("/extensions");
        }
      } catch {
        if (prev) queryClient.setQueryData(["extensions"], prev);
      }
    },
    [location.pathname, navigate, queryClient],
  );

  const handleGlobalHide = useCallback(
    async (extension: Extension) => {
      setMenuOpenId(null);
      try {
        await fetch(
          agentNativePath(
            `/_agent-native/extensions/${extension.id}/global-hide`,
          ),
          { method: "POST" },
        );
      } finally {
        queryClient.invalidateQueries({ queryKey: ["extensions"] });
      }
    },
    [queryClient],
  );

  const handleGlobalUnhide = useCallback(
    async (extension: Extension) => {
      setMenuOpenId(null);
      try {
        await fetch(
          agentNativePath(
            `/_agent-native/extensions/${extension.id}/global-unhide`,
          ),
          { method: "POST" },
        );
      } finally {
        queryClient.invalidateQueries({ queryKey: ["extensions"] });
      }
    },
    [queryClient],
  );

  const startRename = useCallback((extension: Extension) => {
    setMenuOpenId(null);
    setRenameValue(extension.name);
    setRenamingId(extension.id);
  }, []);

  const submitRename = useCallback(
    async (extensionId: string) => {
      const trimmed = renameValue.trim();
      setRenamingId(null);
      if (!trimmed) return;
      const prev = queryClient.getQueryData<Extension[]>(["extensions"]);
      const existing = prev?.find((t) => t.id === extensionId);
      if (!existing || trimmed === existing.name) return;
      queryClient.setQueryData<Extension[]>(["extensions"], (old) =>
        (old ?? []).map((t) =>
          t.id === extensionId ? { ...t, name: trimmed } : t,
        ),
      );
      queryClient.setQueryData<Extension>(["extension", extensionId], (old) =>
        old ? { ...old, name: trimmed } : old,
      );
      try {
        await fetch(
          agentNativePath(`/_agent-native/extensions/${extensionId}`),
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: trimmed }),
          },
        );
        queryClient.invalidateQueries({ queryKey: ["extensions"] });
        queryClient.invalidateQueries({ queryKey: ["extension", extensionId] });
      } catch {
        if (prev) queryClient.setQueryData(["extensions"], prev);
        queryClient.invalidateQueries({ queryKey: ["extension", extensionId] });
      }
    },
    [renameValue, queryClient],
  );

  const sortedTools = useMemo(() => {
    if (!extensions) return [];
    if (sortModeState === "alphabetical") {
      return sortByName(extensions);
    }
    const mostUsed = [...extensions].sort((a, b) => {
      const aPop = extensionPopularityOf(popularity, a.id);
      const bPop = extensionPopularityOf(popularity, b.id);
      if (aPop !== bPop) return bPop - aPop;
      const aFav = favoriteIds.has(a.id) ? 0 : 1;
      const bFav = favoriteIds.has(b.id) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;
      return a.name.localeCompare(b.name);
    });
    return sortModeState === "manual" && toolOrderState.length > 0
      ? applyToolsOrder(mostUsed, toolOrderState)
      : mostUsed;
  }, [extensions, favoriteIds, popularity, sortModeState, toolOrderState]);

  const activeExtensionId = useMemo(
    () =>
      sortedTools.find((extension) =>
        isExtensionPathname(location.pathname, extension.id),
      )?.id ?? null,
    [location.pathname, sortedTools],
  );

  const visibleTools = useMemo(() => {
    if (showAllExtensions || sortedTools.length <= COLLAPSED_EXTENSION_COUNT) {
      return sortedTools;
    }

    const defaultVisible = sortedTools.slice(0, COLLAPSED_EXTENSION_COUNT);
    if (!activeExtensionId) return defaultVisible;

    const activeTool = sortedTools.find(
      (extension) => extension.id === activeExtensionId,
    );
    if (!activeTool || defaultVisible.some((tool) => tool.id === activeTool.id))
      return defaultVisible;

    return [
      ...defaultVisible.slice(0, COLLAPSED_EXTENSION_COUNT - 1),
      activeTool,
    ];
  }, [activeExtensionId, showAllExtensions, sortedTools]);

  const hasMoreExtensions = sortedTools.length > COLLAPSED_EXTENSION_COUNT;

  const reorderTool = useCallback(
    (activeId: string, overId: string) => {
      if (activeId === overId) return;
      const ids = sortedTools.map((extension) => extension.id);
      const oldIndex = ids.indexOf(activeId);
      const newIndex = ids.indexOf(overId);
      if (oldIndex === -1 || newIndex === -1) return;
      const next = [...ids];
      const [moved] = next.splice(oldIndex, 1);
      if (!moved) return;
      next.splice(newIndex, 0, moved);
      setToolsOrder(next);
      setToolOrderState(next);
      setExtensionSortMode("manual");
    },
    [setExtensionSortMode, sortedTools],
  );

  const handleCreate = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    sendToAgentChat({
      message: `Create an extension: ${trimmed}`,
      submit: true,
      openSidebar: true,
      newTab: true,
    });
    setShowCreate(false);
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="relative min-w-0 py-1">
        <div
          className={cn(
            "group/extensions-section relative flex w-full min-w-0 items-center rounded-md text-sm font-medium transition-all hover:text-primary",
            location.pathname.startsWith("/extensions")
              ? "text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent/50",
            extensionsOpen && sortedTools.length > 0 && "mb-1",
          )}
        >
          <button
            type="button"
            onClick={toggleExtensionsOpen}
            className="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={extensionsOpen ? copy.collapse : copy.expand}
            aria-expanded={extensionsOpen}
          />
          <div className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 pr-20">
            <IconTool className="h-4 w-4 shrink-0" />
            <HoverCard openDelay={1200} closeDelay={200}>
              <HoverCardTrigger asChild>
                <span
                  className="pointer-events-auto min-w-0 select-none truncate"
                  onClick={toggleExtensionsOpen}
                >
                  {copy.title}
                </span>
              </HoverCardTrigger>
              <HoverCardContent
                side="top"
                align="start"
                sideOffset={8}
                className="w-72 space-y-3 p-3"
              >
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {copy.title}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {copy.description}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    to="/extensions"
                    className="inline-flex h-8 items-center rounded-md border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                  >
                    {copy.open}
                  </Link>
                  <a
                    href="https://agent-native.com/docs/extensions"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-8 items-center rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {copy.learnMore}
                  </a>
                </div>
              </HoverCardContent>
            </HoverCard>
          </div>
          <div className="absolute right-1 top-1/2 z-20 flex -translate-y-1/2 items-center">
            <ExtensionSortMenu
              value={sortModeState}
              onChange={setExtensionSortMode}
              showHidden={showGloballyHidden}
              onShowHiddenChange={setShowGloballyHidden}
              copy={copy}
            />
            <Popover open={showCreate} onOpenChange={setShowCreate}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-accent-foreground"
                  aria-label={copy.newExtension}
                >
                  <IconPlus className="h-3.5 w-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="right"
                align="start"
                className="w-[420px] p-3"
              >
                <p className="px-1 pb-2 text-sm font-semibold text-foreground">
                  {copy.newExtension}
                </p>
                <PromptComposer
                  autoFocus
                  placeholder={copy.createPlaceholder}
                  draftScope="extensions:sidebar-create"
                  onSubmit={handleCreate}
                />
              </PopoverContent>
            </Popover>
            <button
              type="button"
              onClick={toggleExtensionsOpen}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-accent hover:text-foreground"
              aria-label={extensionsOpen ? copy.collapse : copy.expand}
              aria-expanded={extensionsOpen}
            >
              <IconChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 transition-transform",
                  !extensionsOpen && "-rotate-90",
                )}
              />
            </button>
          </div>
        </div>

        {extensionsOpen &&
          (isLoading ? (
            <div className="min-w-0 space-y-0.5 px-0.5">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="flex items-center rounded-md px-2 py-1.5"
                >
                  <div
                    className="h-3 rounded bg-muted animate-pulse"
                    style={{ width: `${60 + i * 20}px` }}
                  />
                </div>
              ))}
            </div>
          ) : sortedTools.length === 0 ? null : (
            <div className="min-w-0 space-y-0.5 px-0.5">
              {visibleTools.map((extension) => {
                const isActive = isExtensionPathname(
                  location.pathname,
                  extension.id,
                );
                const isFav = favoriteIds.has(extension.id);
                const isRenamingThis = renamingId === extension.id;
                const isLocalExtension =
                  extension.source?.mode === "local-files";
                const actionsVisible =
                  menuOpenId === extension.id || isRenamingThis;

                return (
                  <div
                    key={extension.id}
                    onDragOver={(e) => {
                      if (!draggingId || draggingId === extension.id) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setDragOverId(extension.id);
                    }}
                    onDragLeave={() => {
                      setDragOverId((current) =>
                        current === extension.id ? null : current,
                      );
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const activeId =
                        draggingId || e.dataTransfer.getData("text/plain");
                      setDraggingId(null);
                      setDragOverId(null);
                      if (activeId) reorderTool(activeId, extension.id);
                    }}
                    className={cn(
                      "group/extension relative flex items-center min-w-0 rounded-md",
                      draggingId === extension.id && "opacity-50",
                      dragOverId === extension.id &&
                        draggingId !== extension.id &&
                        "bg-accent/60",
                    )}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          draggable
                          onDragStart={(e) => {
                            setDraggingId(extension.id);
                            setDragOverId(null);
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData("text/plain", extension.id);
                          }}
                          onDragEnd={() => {
                            setDraggingId(null);
                            setDragOverId(null);
                          }}
                          className="-ml-2 cursor-grab rounded p-0.5 text-muted-foreground/30 opacity-0 transition-colors hover:text-muted-foreground/70 active:cursor-grabbing group-hover/extension:opacity-100 group-focus-within/extension:opacity-100"
                          aria-label={copy.reorder(extension.name)}
                        >
                          <IconGripVertical className="h-3 w-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{copy.dragToReorder}</TooltipContent>
                    </Tooltip>
                    <Link
                      to={extensionPath(extension.id, extension.name)}
                      className={cn(
                        "flex min-w-0 flex-1 items-center rounded-md px-2 py-1.5 pr-12 text-xs transition-[padding,color,background-color] md:pr-2 md:group-hover/extension:pr-12 md:group-focus-within/extension:pr-12",
                        actionsVisible && "md:pr-12",
                        isActive
                          ? "bg-accent text-accent-foreground font-medium"
                          : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground",
                      )}
                    >
                      {isRenamingThis ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => submitRename(extension.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") submitRename(extension.id);
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          className="min-w-0 flex-1 truncate border-b border-primary bg-transparent px-0 py-0 text-xs outline-none"
                        />
                      ) : (
                        <span className="flex min-w-0 items-center gap-1.5">
                          {extension.globallyHidden && (
                            <IconEyeOff
                              className="h-3 w-3 shrink-0 text-muted-foreground/60"
                              aria-label={copy.hiddenFromEveryone}
                            />
                          )}
                          <span className="block truncate">
                            {extension.name}
                          </span>
                          {isLocalExtension && (
                            <span className="shrink-0 rounded border border-border px-1 text-[9px] font-medium uppercase tracking-wide text-muted-foreground/70">
                              {copy.file}
                            </span>
                          )}
                        </span>
                      )}
                    </Link>

                    <div
                      className={cn(
                        "pointer-events-none absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover/extension:opacity-100 md:group-focus-within/extension:opacity-100",
                        actionsVisible && "md:opacity-100",
                      )}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleFavorite(extension.id);
                        }}
                        className={cn(
                          "pointer-events-auto cursor-pointer rounded p-0.5 transition-colors",
                          isFav
                            ? "text-yellow-500"
                            : "text-muted-foreground/40 hover:text-yellow-500",
                        )}
                        aria-label={isFav ? copy.unfavorite : copy.favorite}
                      >
                        {isFav ? (
                          <IconStarFilled className="h-3 w-3" />
                        ) : (
                          <IconStar className="h-3 w-3" />
                        )}
                      </button>

                      <DropdownMenu
                        open={menuOpenId === extension.id}
                        onOpenChange={(open) =>
                          setMenuOpenId(open ? extension.id : null)
                        }
                      >
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="pointer-events-auto cursor-pointer rounded p-0.5 text-muted-foreground/40 transition-colors hover:text-foreground"
                            aria-label={copy.actions}
                          >
                            <IconDots className="h-3 w-3" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          sideOffset={4}
                          className="min-w-[140px]"
                        >
                          {isLocalExtension ? (
                            <DropdownMenuItem disabled>
                              <IconPencil className="h-3.5 w-3.5" />
                              {copy.editInFiles}
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onSelect={() => startRename(extension)}
                            >
                              <IconPencil className="h-3.5 w-3.5" />
                              {copy.rename}
                            </DropdownMenuItem>
                          )}
                          {!isLocalExtension &&
                            extension.canDelete !== false &&
                            (extension.globallyHidden ? (
                              <DropdownMenuItem
                                onSelect={() => handleGlobalUnhide(extension)}
                              >
                                <IconEye className="h-3.5 w-3.5" />
                                {copy.unhideForEveryone}
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onSelect={() => handleGlobalHide(extension)}
                              >
                                <IconEyeOff className="h-3.5 w-3.5" />
                                {copy.hideFromEveryone}
                              </DropdownMenuItem>
                            ))}
                          {!isLocalExtension && (
                            <DropdownMenuItem
                              onSelect={() => handleDelete(extension)}
                              className="text-destructive focus:text-destructive"
                            >
                              <IconTrash className="h-3.5 w-3.5" />
                              {extension.canDelete === false
                                ? copy.removeFromMyList
                                : copy.delete}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })}
              {hasMoreExtensions && (
                <button
                  type="button"
                  aria-expanded={showAllExtensions}
                  onClick={() => setShowAllExtensions((current) => !current)}
                  className="ml-5 mt-1 inline-flex h-5 items-center rounded px-1.5 text-[11px] font-medium text-muted-foreground/60 transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                >
                  {showAllExtensions ? copy.showLess : copy.showMore}
                </button>
              )}
            </div>
          ))}
      </div>
    </TooltipProvider>
  );
}
