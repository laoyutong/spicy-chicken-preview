import { useRef, useEffect, useState, useCallback } from "react";
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
  onSelect: (index: number) => void;
}

function ThumbnailItem({ index, filePath, isActive, onSelect }: ThumbnailItemProps) {
  const fileName = filePath.split(/[/\\]/).pop() || filePath;

  return (
    <div
      className={`sidebar-item${isActive ? " active" : ""}`}
      onClick={() => onSelect(index)}
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
  onSelect: (index: number) => void;
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
}: SidebarProps) {
  const activeRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [recentCollapsed, setRecentCollapsed] = useState(false);
  const resizing = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const widthRef = useRef(width);
  widthRef.current = width;

  // Scroll to top when folder changes
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [currentFolder]);

  useEffect(() => {
    if (visible && activeRef.current) {
      const el = activeRef.current;
      // Defer to next frame so layout-forcing scrollIntoView doesn't block the paint
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
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
      {recentFolders.length > 0 && (
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
      {currentFolder && (
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

      {subdirs.length > 0 && (
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
        {images.map((filePath, index) => (
          <div
            key={filePath}
            ref={index === currentIndex ? activeRef : undefined}
          >
            <ThumbnailItem
              index={index}
              filePath={filePath}
              isActive={index === currentIndex}
              onSelect={onSelect}
            />
          </div>
        ))}
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
