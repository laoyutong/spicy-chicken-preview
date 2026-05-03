import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { t, type Language } from "./i18n";
import { CachedThumbnail } from "./thumbnailCache";

interface SubdirInfo {
  name: string;
  path: string;
}

export const MIN_SIDEBAR_WIDTH = 140;
export const MAX_SIDEBAR_WIDTH = 500;
export const DEFAULT_SIDEBAR_WIDTH = 200;

interface ThumbnailItemProps {
  index: number;
  filePath: string;
  isActive: boolean;
  isSelected: boolean;
  onSelect: (index: number, e: React.MouseEvent) => void;
}

function ThumbnailItem({ index, filePath, isActive, isSelected, onSelect }: ThumbnailItemProps) {
  const fileName = useMemo(() => filePath.split(/[/\\]/).pop() || filePath, [filePath]);

  return (
    <div
      className={`sidebar-item${isActive ? " active" : ""}${isSelected ? " selected" : ""}`}
      onClick={(e) => onSelect(index, e)}
      title={fileName}
    >
      <CachedThumbnail filePath={filePath} />
      <span className="sidebar-filename">{fileName}</span>
    </div>
  );
}

interface SidebarProps {
  images: string[];
  currentIndex: number;
  onSelect: (index: number, e?: React.MouseEvent) => void;
  visible: boolean;
  currentFolder: string | null;
  subdirs: SubdirInfo[];
  parentPath: string | null;
  onNavigateFolder: (folderPath: string) => void;
  onNavigateUp: () => void;
  language: Language;
  recentFolders?: SubdirInfo[];
  width: number;
  onWidthChange: (width: number) => void;
  selectedIndices: Set<number>;
  onSelectedIndicesChange: (indices: Set<number>) => void;
  onBatchDelete: () => void;
}

function getFolderName(folderPath: string): string {
  const normalized = folderPath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : folderPath;
}

export default function Sidebar({
  images,
  currentIndex,
  onSelect,
  visible,
  currentFolder,
  subdirs,
  parentPath,
  onNavigateFolder,
  onNavigateUp,
  language,
  recentFolders = [],
  width,
  onWidthChange,
  selectedIndices,
  onSelectedIndicesChange,
  onBatchDelete,
}: SidebarProps) {
  const activeRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [recentCollapsed, setRecentCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const resizing = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const widthRef = useRef(width);
  widthRef.current = width;
  // Virtual scroll state
  const ITEM_HEIGHT = 48;
  const OVERSCAN = 5;
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const rafRef = useRef(0);

  const isSearching = searchQuery.length > 0;

  // Filter images by filename when searching
  const filteredImages = useMemo(() => {
    if (!isSearching) return null;
    const q = searchQuery.toLowerCase();
    return images
      .map((path, originalIndex) => ({ path, originalIndex }))
      .filter(({ path }) => {
        const name = (path.split(/[/\\]/).pop() || path).toLowerCase();
        return name.includes(q);
      });
  }, [images, searchQuery, isSearching]);

  // Determine which image list to render
  const displayItems = isSearching
    ? filteredImages!
    : images.map((path, i) => ({ path, originalIndex: i }));
  const itemCount = displayItems.length;

  // Compute visible range for virtual scrolling
  const visibleRange = (() => {
    if (itemCount <= 100) return null;
    const start = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN);
    const end = Math.min(itemCount, Math.ceil((scrollTop + containerHeight) / ITEM_HEIGHT) + OVERSCAN);
    return { start, end };
  })();

  const virtualItems = visibleRange ? displayItems.slice(visibleRange.start, visibleRange.end) : displayItems;
  const totalHeight = itemCount * ITEM_HEIGHT;

  const handleItemClick = useCallback((index: number, e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(selectedIndices);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      onSelectedIndicesChange(next);
    } else if (e.shiftKey && selectedIndices.size > 0) {
      const lastIdx = Math.max(...selectedIndices);
      const [start, end] = lastIdx < index ? [lastIdx, index] : [index, lastIdx];
      const next = new Set(selectedIndices);
      for (let i = start; i <= end; i++) {
        next.add(i);
      }
      onSelectedIndicesChange(next);
    } else {
      onSelectedIndicesChange(new Set());
      onSelect(index, e);
    }
  }, [selectedIndices, onSelectedIndicesChange, onSelect]);

  // Scroll to top when folder changes or search query changes
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = 0;
      setScrollTop(0);
    }
  }, [currentFolder, searchQuery]);

  // Virtual scroll: track scroll position
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        setScrollTop(el.scrollTop);
        setContainerHeight(el.clientHeight);
      });
    };
    // Initial measurement
    setContainerHeight(el.clientHeight);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [currentFolder]);

  // Keep a ref of display items so the scroll effect can locate the
  // target index without adding displayItems to the dependency array.
  const displayItemsRef = useRef(displayItems);
  displayItemsRef.current = displayItems;

  useEffect(() => {
    if (!visible) return;

    if (activeRef.current) {
      const el = activeRef.current;
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      return;
    }

    // Virtual scrolling: the target item is outside the rendered window.
    // Estimate its position and jump-scroll so it gets rendered on the
    // next paint (happens during shuffle slideshow or far jumps).
    const listEl = listRef.current;
    if (!listEl || itemCount <= 100) return;

    const items = displayItemsRef.current;
    const pos = items.findIndex((it) => it.originalIndex === currentIndex);
    if (pos < 0) return;

    const targetTop = pos * ITEM_HEIGHT - listEl.clientHeight / 2 + ITEM_HEIGHT / 2;
    listEl.scrollTop = Math.max(0, targetTop);
    setScrollTop(Math.max(0, targetTop));
  }, [currentIndex, visible]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    resizing.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = widthRef.current;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!resizing.current) return;
    const delta = e.clientX - dragStartX.current;
    const newWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, dragStartWidth.current + delta));
    onWidthChange(newWidth);
  }, [onWidthChange]);

  const handlePointerUp = useCallback(() => {
    if (!resizing.current) return;
    resizing.current = false;
    try { localStorage.setItem("sidebar-width", String(widthRef.current)); } catch { /* ignore */ }
  }, []);

  if (!visible) return null;
  if (images.length === 0 && !currentFolder && recentFolders.length === 0) return null;

  return (
    <div className="sidebar" style={{ width }}>
      {/* Search input */}
      {currentFolder && images.length > 0 && (
        <div className="sidebar-search">
          <svg className="sidebar-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="sidebar-search-input"
            type="text"
            placeholder={language === "zh" ? "搜索图片…" : "Search images…"}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearchQuery("");
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          {isSearching && (
            <button className="sidebar-search-clear" onClick={() => setSearchQuery("")} title={language === "zh" ? "清除" : "Clear"}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      )}

      {!isSearching && recentFolders.length > 0 && (
        <div className={`recent-folders${!currentFolder ? " recent-folders--welcome" : ""}`}>
          <div
            className={`recent-folders-title${recentCollapsed ? " collapsed" : ""}`}
            onClick={() => setRecentCollapsed((c) => !c)}
          >
            <svg
              className="recent-folders-chevron"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points={recentCollapsed ? "6 9 12 15 18 9" : "15 18 9 12 15 6"} />
            </svg>
            <span>{t("sidebar.recentFolders", language)}</span>
          </div>
          {!recentCollapsed && (
            <div className="recent-folders-list">
              {recentFolders.map((f) => (
                <div
                  key={f.path}
                  className="recent-folder-item"
                  onClick={() => onNavigateFolder(f.path)}
                  title={f.path}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                  <span className="recent-folder-name">{f.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {currentFolder && !isSearching && (
        <div className="sidebar-folder-header">
          {parentPath && parentPath !== currentFolder && (
            <button
              className="sidebar-up-btn"
              onClick={onNavigateUp}
              title={t("sidebar.upTo", language).replace("{name}", getFolderName(parentPath))}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
          )}
          <div className="sidebar-folder-title" title={currentFolder}>
            <svg className="sidebar-folder-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <span className="sidebar-folder-name">{getFolderName(currentFolder)}</span>
          </div>
        </div>
      )}

      {subdirs.length > 0 && !isSearching && (
        <>
          <div className="sidebar-subdirs">
            {subdirs.map((dir) => (
              <div
                key={dir.path}
                className="sidebar-folder-item"
                onClick={() => onNavigateFolder(dir.path)}
                title={dir.name}
              >
                <svg className="sidebar-folder-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                <span className="sidebar-folder-name">{dir.name}</span>
              </div>
            ))}
          </div>
          <div className="sidebar-divider" />
        </>
      )}

      <div className="sidebar-list" ref={listRef}>
        {selectedIndices.size > 0 && (
          <div className="sidebar-selection-bar">
            <span className="sidebar-selection-count">
              {language === "zh"
                ? `已选 ${selectedIndices.size} 张`
                : `${selectedIndices.size} selected`}
            </span>
            <button className="sidebar-selection-delete" onClick={onBatchDelete}>
              {language === "zh" ? "删除选中" : "Delete"}
            </button>
          </div>
        )}
        {isSearching && filteredImages && filteredImages.length === 0 ? (
          <div className="sidebar-search-empty">
            <span className="sidebar-filename" style={{ color: 'var(--text-muted)', padding: '12px 8px', display: 'block' }}>
              {language === "zh" ? "无匹配结果" : "No matching images"}
            </span>
          </div>
        ) : (
          <>
            {visibleRange && <div style={{ height: visibleRange.start * ITEM_HEIGHT, flexShrink: 0 }} />}
            {virtualItems.map(({ path, originalIndex }) => (
              <div
                key={path}
                ref={originalIndex === currentIndex ? activeRef : undefined}
              >
                <ThumbnailItem
                  index={originalIndex}
                  filePath={path}
                  isActive={originalIndex === currentIndex}
                  isSelected={selectedIndices.has(originalIndex)}
                  onSelect={handleItemClick}
                />
              </div>
            ))}
            {visibleRange && <div style={{ height: totalHeight - (visibleRange.end * ITEM_HEIGHT), flexShrink: 0 }} />}
          </>
        )}
      </div>
      <div
        className="sidebar-resize-handle"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    </div>
  );
}
