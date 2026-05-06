import { useMemo, type Dispatch, type SetStateAction } from "react";
import { t, translate, type Language } from "./i18n";
import type { ToolbarItemDef } from "./Toolbar";
import type { SortMode, FilterMode } from "./utils/sorting";
import type { SlideshowMode } from "./hooks/useSlideshow";
import {
  OpenIcon, FolderIcon, ShortcutsIcon, ShortcutsIconSmall,
  SidebarIcon, SidebarIconSmall, ChevronDownIcon,
  ChevronLeftIcon, ChevronRightIcon,
  PlayIcon, PauseIcon, CloseIcon,
  SettingsIcon, FullscreenEnterIcon, FullscreenExitIcon,
} from "./icons";

interface UseToolbarItemsParams {
  language: Language;
  showExtras: boolean;
  showCenter: boolean;
  sidebarVisible: boolean;
  fileName: string;
  sortBy: SortMode;
  sortOrder: "asc" | "desc";
  sortDropdownOpen: boolean;
  currentIndex: number;
  imageCount: number;
  slideshowActive: boolean;
  slideshowMode: SlideshowMode;
  settingsOpen: boolean;
  isImmersive: boolean;
  recursiveRoot: string | null;
  onExitRecursive: () => void;
  filterMode: FilterMode;
  setFilterMode: Dispatch<SetStateAction<FilterMode>>;
  filterDropdownOpen: boolean;
  setFilterDropdownOpen: Dispatch<SetStateAction<boolean>>;
  filterDropdownRef: { current: HTMLDivElement | null };
  openFile: () => void;
  navigate: (delta: number) => void;
  toggleSlideshow: () => void;
  cycleSlideshowMode: () => void;
  toggleImmersive: () => void;
  setSortBy: (mode: SortMode) => void;
  setSortOrder: Dispatch<SetStateAction<"asc" | "desc">>;
  setSortDropdownOpen: Dispatch<SetStateAction<boolean>>;
  setSidebarVisible: Dispatch<SetStateAction<boolean>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setShortcutsOpen: Dispatch<SetStateAction<boolean>>;
}

function ToolbarLeftItems(params: UseToolbarItemsParams): ToolbarItemDef[] {
  const {
    language, showExtras, sidebarVisible, fileName,
    sortBy, sortOrder, sortDropdownOpen, filterMode, setFilterMode, filterDropdownOpen, setFilterDropdownOpen, filterDropdownRef,
    openFile, setSortBy, setSortDropdownOpen, setSortOrder, setSidebarVisible, setShortcutsOpen,
  } = params;

  return useMemo((): ToolbarItemDef[] => {
    const items: ToolbarItemDef[] = [];

    items.push({
      id: "open", section: "left", priority: 0, condition: true,
      renderToolbar: () => (
        <button className="toolbar-btn" onClick={openFile} title={t("toolbar.openImage", language)}>
          <OpenIcon size={20} />
        </button>
      ),
      renderMenu: () => (
        <button className="toolbar-more-item" onClick={openFile}>
          <FolderIcon size={16} />
          {t("toolbar.openImage", language)}
        </button>
      ),
    });

    items.push({
      id: "shortcuts", section: "left", priority: 0, condition: true,
      renderToolbar: () => (
        <button className="toolbar-btn" onClick={() => setShortcutsOpen(true)} title={t("shortcuts.title", language)}>
          <ShortcutsIcon size={18} />
        </button>
      ),
      renderMenu: () => (
        <button className="toolbar-more-item" onClick={() => setShortcutsOpen(true)}>
          <ShortcutsIconSmall size={16} />
          {t("shortcuts.title", language)}
        </button>
      ),
    });

    items.push({
      id: "sidebar-toggle", section: "left", priority: 5, condition: showExtras,
      renderToolbar: () => (
        <button className={`toolbar-btn${sidebarVisible ? " active" : ""}`} onClick={() => setSidebarVisible((v) => !v)} title={t("toolbar.toggleSidebar", language)}>
          <SidebarIcon size={20} />
        </button>
      ),
      renderMenu: () => (
        <button className="toolbar-more-item" onClick={() => setSidebarVisible((v) => !v)}>
          <SidebarIconSmall size={16} />
          {t("toolbar.toggleSidebar", language)}
        </button>
      ),
    });

    items.push({
      id: "sort-controls", section: "left", priority: 10, condition: showExtras,
      renderToolbar: () => (
        <div className="sort-controls">
          <button className="sort-btn" onClick={() => setSortDropdownOpen((o) => !o)} title={translate(`sort.${sortBy}`, language)}>
            <span className="sort-label">{translate(`sort.${sortBy}`, language)}</span>
            <span className="sort-chevron"><ChevronDownIcon size={8} /></span>
          </button>
          {sortDropdownOpen && (
            <div className="sort-dropdown">
              {(["name", "dimensions", "aspect-ratio", "modified"] as SortMode[]).map((mode) => (
                <button key={mode} className={`sort-dropdown-item${mode === sortBy ? " active" : ""}`} onClick={() => { setSortBy(mode); setSortDropdownOpen(false); }}>
                  {translate(`sort.${mode}`, language)}
                </button>
              ))}
            </div>
          )}
          <button className="sort-dir-btn" onClick={() => setSortOrder((o) => (o === "asc" ? "desc" : "asc"))} title={sortOrder === "asc" ? t("sort.ascending", language) : t("sort.descending", language)}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" stroke="none">
              {sortOrder === "asc" ? (
                <>
                  <rect x="0" y="9" width="3" height="3" rx="0.5" opacity="0.35" />
                  <rect x="4.5" y="5" width="3" height="7" rx="0.5" opacity="0.65" />
                  <rect x="9" y="0" width="3" height="12" rx="0.5" />
                </>
              ) : (
                <>
                  <rect x="0" y="0" width="3" height="12" rx="0.5" />
                  <rect x="4.5" y="2" width="3" height="10" rx="0.5" opacity="0.65" />
                  <rect x="9" y="7" width="3" height="5" rx="0.5" opacity="0.35" />
                </>
              )}
            </svg>
          </button>
        </div>
      ),
      renderMenu: () => (
        <>
          <span className="toolbar-more-label">{language === "zh" ? "排序方式" : "Sort by"}</span>
          {(["name", "dimensions", "aspect-ratio", "modified"] as SortMode[]).map((mode) => (
            <button key={mode} className={`toolbar-more-item${mode === sortBy ? " active" : ""}`} onClick={() => setSortBy(mode)}>
              {translate(`sort.${mode}`, language)}
            </button>
          ))}
          <div className="toolbar-more-separator" />
          <button className="toolbar-more-item" onClick={() => setSortOrder((o) => (o === "asc" ? "desc" : "asc"))}>
            {sortOrder === "asc" ? t("sort.ascending", language) : t("sort.descending", language)}
          </button>
        </>
      ),
    });

    const FILTER_MODES: FilterMode[] = ["all", "landscape", "portrait"];
    items.push({
      id: "filter", section: "left", priority: 12, condition: showExtras,
      renderToolbar: () => (
        <div className="filter-controls" ref={filterDropdownRef}>
          <button
            className={`filter-btn${filterMode !== "all" ? " active" : ""}`}
            onClick={() => setFilterDropdownOpen((o) => !o)}
            title={translate(`filter.${filterMode}`, language)}
          >
            <span className="filter-label">{translate(`filter.${filterMode}`, language)}</span>
            <span className="filter-chevron"><ChevronDownIcon size={8} /></span>
          </button>
          {filterDropdownOpen && (
            <div className="filter-dropdown">
              {FILTER_MODES.map((mode) => (
                <button
                  key={mode}
                  className={`filter-dropdown-item${mode === filterMode ? " active" : ""}`}
                  onClick={() => { setFilterMode(mode); setFilterDropdownOpen(false); }}
                >
                  {translate(`filter.${mode}`, language)}
                </button>
              ))}
            </div>
          )}
        </div>
      ),
      renderMenu: () => (
        <>
          <span className="toolbar-more-label">{language === "zh" ? "筛选" : "Filter"}</span>
          {FILTER_MODES.map((mode) => (
            <button
              key={mode}
              className={`toolbar-more-item${mode === filterMode ? " active" : ""}`}
              onClick={() => setFilterMode(mode)}
            >
              {translate(`filter.${mode}`, language)}
            </button>
          ))}
        </>
      ),
    });

    items.push({
      id: "filename", section: "left", priority: 35, condition: !!fileName,
      renderToolbar: () => <span className="toolbar-filename">{fileName}</span>,
      renderMenu: () => <span className="toolbar-more-label">{fileName}</span>,
    });

    return items;
  }, [language, showExtras, sidebarVisible, fileName, sortBy, sortOrder, sortDropdownOpen, filterMode, setFilterMode, filterDropdownOpen, setFilterDropdownOpen, filterDropdownRef, openFile, setSortBy, setSortDropdownOpen, setSortOrder, setSidebarVisible, setShortcutsOpen]);
}

function ToolbarCenterItems(params: UseToolbarItemsParams): ToolbarItemDef[] {
  const { language, showCenter, currentIndex, imageCount, slideshowActive, slideshowMode, recursiveRoot, onExitRecursive, navigate, toggleSlideshow, cycleSlideshowMode } = params;

  const modeLabel = slideshowMode === "shuffle" ? "⇄" : "→";

  return useMemo((): ToolbarItemDef[] => {
    const items: ToolbarItemDef[] = [];

    items.push({
      id: "prev", section: "center", priority: 0, condition: showCenter,
      renderToolbar: () => (
        <button className="toolbar-btn" onClick={() => navigate(-1)} title={t("toolbar.previous", language)}>
          <ChevronLeftIcon size={20} />
        </button>
      ),
      renderMenu: () => (
        <button className="toolbar-more-item" onClick={() => navigate(-1)}>
          <ChevronLeftIcon size={16} />
          {t("toolbar.previous", language)}
        </button>
      ),
    });

    items.push({
      id: "recursive-chip", section: "center", priority: 5, condition: showCenter && !!recursiveRoot,
      renderToolbar: () => {
        const folderName = recursiveRoot ? (recursiveRoot.replace(/\\/g, "/").split("/").filter(Boolean).pop() || recursiveRoot) : "";
        return (
          <button className="toolbar-recursive-chip" onClick={onExitRecursive} title={t("toolbar.exitRecursive", language)}>
            <FolderIcon size={12} />
            <span className="toolbar-recursive-chip-name">{folderName}</span>
            <span className="toolbar-recursive-chip-close"><CloseIcon size={10} /></span>
          </button>
        );
      },
      renderMenu: () => (
        <button className="toolbar-more-item" onClick={onExitRecursive}>
          {t("toolbar.exitRecursive", language)}
        </button>
      ),
    });

    items.push({
      id: "counter", section: "center", priority: 20, condition: showCenter,
      renderToolbar: () => <span className="toolbar-counter">{currentIndex + 1} / {imageCount}</span>,
      renderMenu: () => <span className="toolbar-more-label">{currentIndex + 1} / {imageCount}</span>,
    });

    items.push({
      id: "next", section: "center", priority: 0, condition: showCenter,
      renderToolbar: () => (
        <button className="toolbar-btn" onClick={() => navigate(1)} title={t("toolbar.next", language)}>
          <ChevronRightIcon size={20} />
        </button>
      ),
      renderMenu: () => (
        <button className="toolbar-more-item" onClick={() => navigate(1)}>
          <ChevronRightIcon size={16} />
          {t("toolbar.next", language)}
        </button>
      ),
    });

    items.push({
      id: "slideshow", section: "center", priority: 15, condition: showCenter,
      renderToolbar: () => (
        <button className="toolbar-btn" onClick={toggleSlideshow} title={slideshowActive ? t("slideshow.pause", language) : t("slideshow.play", language)}>
          {slideshowActive ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
        </button>
      ),
      renderMenu: () => (
        <button className="toolbar-more-item" onClick={toggleSlideshow}>
          {slideshowActive ? t("slideshow.pause", language) : t("slideshow.play", language)}
        </button>
      ),
    });

    items.push({
      id: "slideshow-mode", section: "center", priority: 25, condition: showCenter && slideshowActive,
      renderToolbar: () => (
        <button className="toolbar-btn" onClick={cycleSlideshowMode} title={slideshowMode === "forward" ? "Forward" : "Shuffle"}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>{modeLabel}</span>
        </button>
      ),
      renderMenu: () => (
        <button className="toolbar-more-item" onClick={cycleSlideshowMode}>
          {slideshowMode === "forward" ? "Forward" : "Shuffle"}
        </button>
      ),
    });

    return items;
  }, [language, showCenter, currentIndex, imageCount, slideshowActive, slideshowMode, recursiveRoot, onExitRecursive, navigate, toggleSlideshow, cycleSlideshowMode]);
}

function ToolbarRightItems(params: UseToolbarItemsParams): ToolbarItemDef[] {
  const { language, settingsOpen, isImmersive, toggleImmersive, setSettingsOpen } = params;

  return useMemo((): ToolbarItemDef[] => {
    const items: ToolbarItemDef[] = [];

    items.push({
      id: "settings", section: "right", priority: 8, condition: true,
      renderToolbar: () => (
        <button
          className={`toolbar-btn${settingsOpen ? " active" : ""}`}
          onClick={() => setSettingsOpen((v) => !v)}
          title={t("settings.title", language)}
        >
          <SettingsIcon size={18} />
        </button>
      ),
      renderMenu: () => (
        <button className="toolbar-more-item" onClick={() => setSettingsOpen(true)}>
          <SettingsIcon size={16} />
          {t("settings.title", language)}
        </button>
      ),
    });

    items.push({
      id: "fullscreen", section: "right", priority: 5, condition: true,
      renderToolbar: () => (
        <button className="toolbar-btn" onClick={toggleImmersive} title={isImmersive ? t("toolbar.exitFullscreen", language) : t("toolbar.fullscreen", language)}>
          {isImmersive ? <FullscreenExitIcon size={18} /> : <FullscreenEnterIcon size={18} />}
        </button>
      ),
      renderMenu: () => (
        <button className="toolbar-more-item" onClick={toggleImmersive}>
          {isImmersive ? t("toolbar.exitFullscreen", language) : t("toolbar.fullscreen", language)}
        </button>
      ),
    });

    return items;
  }, [language, settingsOpen, isImmersive, toggleImmersive, setSettingsOpen]);
}

export function useToolbarItems(params: UseToolbarItemsParams): ToolbarItemDef[] {
  const left = ToolbarLeftItems(params);
  const center = ToolbarCenterItems(params);
  const right = ToolbarRightItems(params);
  return useMemo(() => [...left, ...center, ...right], [left, center, right]);
}
