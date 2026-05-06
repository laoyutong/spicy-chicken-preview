import { useMemo, type Dispatch, type SetStateAction } from "react";
import { t, translate, type Language } from "./i18n";
import type { ToolbarItemDef } from "./Toolbar";
import type { SortMode, FilterMode } from "./utils/sorting";
import type { SlideshowMode } from "./hooks/useSlideshow";

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
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            <rect x="8" y="11" width="8" height="6" rx="1" />
            <circle cx="10" cy="13.5" r="1" />
            <polyline points="21 15 16 10 13 13" />
          </svg>
        </button>
      ),
      renderMenu: () => (
        <button className="toolbar-more-item" onClick={openFile}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          {t("toolbar.openImage", language)}
        </button>
      ),
    });

    items.push({
      id: "shortcuts", section: "left", priority: 0, condition: true,
      renderToolbar: () => (
        <button className="toolbar-btn" onClick={() => setShortcutsOpen(true)} title={t("shortcuts.title", language)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M6 16h.01M10 16h.01M14 16h.01" />
          </svg>
        </button>
      ),
      renderMenu: () => (
        <button className="toolbar-more-item" onClick={() => setShortcutsOpen(true)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01" />
          </svg>
          {t("shortcuts.title", language)}
        </button>
      ),
    });

    items.push({
      id: "sidebar-toggle", section: "left", priority: 5, condition: showExtras,
      renderToolbar: () => (
        <button className={`toolbar-btn${sidebarVisible ? " active" : ""}`} onClick={() => setSidebarVisible((v) => !v)} title={t("toolbar.toggleSidebar", language)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M10 3v18" />
            <rect x="5" y="7" width="3" height="3" fill="currentColor" />
            <rect x="5" y="12" width="3" height="3" fill="currentColor" />
            <rect x="5" y="17" width="3" height="1" fill="currentColor" />
          </svg>
        </button>
      ),
      renderMenu: () => (
        <button className="toolbar-more-item" onClick={() => setSidebarVisible((v) => !v)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M10 3v18" />
          </svg>
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
            <svg className="sort-chevron" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
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
            <svg className="filter-chevron" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
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
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      ),
      renderMenu: () => (
        <button className="toolbar-more-item" onClick={() => navigate(-1)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
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
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <span className="toolbar-recursive-chip-name">{folderName}</span>
            <svg className="toolbar-recursive-chip-close" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
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
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      ),
      renderMenu: () => (
        <button className="toolbar-more-item" onClick={() => navigate(1)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
          {t("toolbar.next", language)}
        </button>
      ),
    });

    items.push({
      id: "slideshow", section: "center", priority: 15, condition: showCenter,
      renderToolbar: () => (
        <button className="toolbar-btn" onClick={toggleSlideshow} title={slideshowActive ? t("slideshow.pause", language) : t("slideshow.play", language)}>
          {slideshowActive ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <polygon points="6,3 20,12 6,21" />
            </svg>
          )}
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
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      ),
      renderMenu: () => (
        <button className="toolbar-more-item" onClick={() => setSettingsOpen(true)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          {t("settings.title", language)}
        </button>
      ),
    });

    items.push({
      id: "fullscreen", section: "right", priority: 5, condition: true,
      renderToolbar: () => (
        <button className="toolbar-btn" onClick={toggleImmersive} title={isImmersive ? t("toolbar.exitFullscreen", language) : t("toolbar.fullscreen", language)}>
          {isImmersive ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
              <line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          )}
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
