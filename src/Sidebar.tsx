import { useRef, useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";

interface SubdirInfo {
  name: string;
  path: string;
}

const thumbnailPathCache = new Map<string, string>();
const pendingRequests = new Map<string, Promise<string>>();

const THUMBNAIL_SIZE = 128;
const MIN_SIDEBAR_WIDTH = 140;
const MAX_SIDEBAR_WIDTH = 500;
const DEFAULT_SIDEBAR_WIDTH = 200;

function loadStoredWidth(): number {
  try {
    const stored = localStorage.getItem("sidebar-width");
    if (stored) {
      const v = parseInt(stored, 10);
      if (v >= MIN_SIDEBAR_WIDTH && v <= MAX_SIDEBAR_WIDTH) return v;
    }
  } catch { /* localStorage unavailable */ }
  return DEFAULT_SIDEBAR_WIDTH;
}

async function loadThumbnailPath(filePath: string): Promise<string> {
  const cached = thumbnailPathCache.get(filePath);
  if (cached) return cached;

  const pending = pendingRequests.get(filePath);
  if (pending) return pending;

  const promise = invoke<string>("get_thumbnail", {
    filePath,
    maxSize: THUMBNAIL_SIZE,
  }).then((cachePath) => {
    thumbnailPathCache.set(filePath, cachePath);
    pendingRequests.delete(filePath);
    return cachePath;
  }).catch((err) => {
    pendingRequests.delete(filePath);
    throw err;
  });

  pendingRequests.set(filePath, promise);
  return promise;
}

function CachedThumbnail({ filePath }: { filePath: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!shouldLoad) return;
    let cancelled = false;
    loadThumbnailPath(filePath).then((cachePath) => {
      if (!cancelled) setSrc(convertFileSrc(cachePath));
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => { cancelled = true; };
  }, [filePath, shouldLoad]);

  if (failed) {
    return <div className="sidebar-thumbnail sidebar-thumbnail-error">!</div>;
  }

  if (!src) {
    return <div ref={containerRef} className="sidebar-thumbnail sidebar-thumbnail-loading" />;
  }

  return (
    <div ref={containerRef} className="sidebar-thumbnail">
      <img src={src} alt="" />
    </div>
  );
}

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
}: SidebarProps) {
  const activeRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState(loadStoredWidth);
  const resizing = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  // Scroll to top when folder changes
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [currentFolder]);

  useEffect(() => {
    if (visible && activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [currentIndex, visible]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    resizing.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = sidebarWidth;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [sidebarWidth]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!resizing.current) return;
    const delta = e.clientX - dragStartX.current;
    const newWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, dragStartWidth.current + delta));
    setSidebarWidth(newWidth);
  }, []);

  const handlePointerUp = useCallback(() => {
    if (!resizing.current) return;
    resizing.current = false;
    const finalWidth = sidebarWidth;
    try { localStorage.setItem("sidebar-width", String(finalWidth)); } catch { /* ignore */ }
  }, [sidebarWidth]);

  if (!visible) return null;
  if (images.length === 0 && !currentFolder) return null;

  return (
    <div className="sidebar" style={{ width: sidebarWidth }}>
      {currentFolder && (
        <div className="sidebar-folder-header">
          {parentPath && parentPath !== currentFolder && (
            <button
              className="sidebar-up-btn"
              onClick={onNavigateUp}
              title={`Up to ${getFolderName(parentPath)}`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
          )}
          <div className="sidebar-folder-title" title={currentFolder}>
            <svg className="sidebar-folder-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                <svg className="sidebar-folder-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
