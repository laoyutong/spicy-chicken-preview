import { useRef, useEffect, useLayoutEffect, useState, useCallback, useMemo, memo } from "react";
import { CachedThumbnail } from "./thumbnailCache";

interface FullscreenStripProps {
  images: string[];
  currentIndex: number;
  onSelect: (index: number) => void;
  slideshowActive: boolean;
  slideshowInterval: number;
  slideshowMode: "forward" | "shuffle";
  onToggleSlideshow: () => void;
  onCycleInterval: () => void;
  onCycleMode: () => void;
}

const MODE_ICONS: Record<string, string> = {
  forward: "→",
  shuffle: "⇄",
};

const ITEM_WIDTH = 62;   // 56px thumbnail + 6px gap
const THUMB_WIDTH = 56;
const OVERSCAN = 20;       // render extra items beyond visible range
const EAGER_WINDOW = 8;    // eager-load ±8 items around current index

const FullscreenStrip = memo(function FullscreenStrip({
  images, currentIndex, onSelect,
  slideshowActive, slideshowInterval, slideshowMode,
  onToggleSlideshow, onCycleInterval, onCycleMode,
}: FullscreenStripProps) {
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const visibleRef = useRef(false);
  useEffect(() => { visibleRef.current = visible; }, [visible]);

  const resetHideTimer = useCallback(() => {
    if (!visibleRef.current) setVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), 2000);
  }, []);

  const mountedRef = useRef(false);

  // ── Scroll-position-based virtualization ─────────────────────────

  const [scrollLeft, setScrollLeft] = useState(0);
  const [stripWidth, setStripWidth] = useState(0);

  // Observe strip dimensions
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const ro = new ResizeObserver(() => setStripWidth(strip.clientWidth));
    ro.observe(strip);
    return () => ro.disconnect();
  }, []);

  // Handle scroll events — rAF batched
  const scrollRafRef = useRef(0);
  const onScroll = useCallback(() => {
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      if (stripRef.current) setScrollLeft(stripRef.current.scrollLeft);
    });
  }, []);

  // Compute visible range from scroll position
  const { winStart, winEnd, visibleImages } = useMemo(() => {
    const effectiveWidth = Math.max(stripWidth, 400); // fallback
    const start = Math.max(0, Math.floor(scrollLeft / ITEM_WIDTH) - OVERSCAN);
    const end = Math.min(images.length, Math.ceil((scrollLeft + effectiveWidth) / ITEM_WIDTH) + OVERSCAN);
    const slice = images.slice(start, end);
    return { winStart: start, winEnd: end, visibleImages: slice };
  }, [images, scrollLeft, stripWidth]);

  // ── Auto-center on currentIndex ──────────────────────────────────

  // Snap to current item on mount (before paint), smooth-scroll on short jumps,
  // instant-snap on long jumps (typical in shuffle slideshow).
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;

    const target = currentIndex * ITEM_WIDTH + THUMB_WIDTH / 2 - strip.offsetWidth / 2;

    if (!mountedRef.current) {
      mountedRef.current = true;
      strip.scrollLeft = Math.max(0, target);
      setScrollLeft(strip.scrollLeft);
      return;
    }

    const start = strip.scrollLeft;
    const distance = target - start;
    if (Math.abs(distance) < 4) return;

    const stripW = strip.offsetWidth;
    // If the target is more than 2 viewport-widths away, snap instantly.
    if (Math.abs(distance) > stripW * 2) {
      strip.scrollLeft = Math.max(0, target);
      setScrollLeft(strip.scrollLeft);
      return;
    }

    const duration = 300;
    const startTime = performance.now();
    const el = strip;

    function animate(now: number) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.scrollLeft = start + distance * eased;
      setScrollLeft(el.scrollLeft);
      if (t < 1) requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
  }, [currentIndex]);

  // Show on mount, start hide timer
  useEffect(() => {
    resetHideTimer();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [resetHideTimer]);

  // Detect mouse near bottom of screen to show the strip (throttled)
  useEffect(() => {
    let lastCheck = 0;
    const handleMouseMove = (e: MouseEvent) => {
      const now = Date.now();
      if (now - lastCheck < 100) return;
      lastCheck = now;
      const threshold = 100; // px from bottom
      if (e.clientY > window.innerHeight - threshold) {
        resetHideTimer();
      }
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [resetHideTimer]);

  const fileNames = useMemo(
    () => images.map((p) => p.split(/[/\\]/).pop() || p),
    [images],
  );

  if (images.length === 0) return null;

  return (
    <div
      className={`fullscreen-strip${visible ? " visible" : ""}`}
      onMouseMove={resetHideTimer}
      onMouseEnter={() => {
        setVisible(true);
        if (hideTimer.current) clearTimeout(hideTimer.current);
      }}
      onMouseLeave={() => {
        hideTimer.current = setTimeout(() => setVisible(false), 1000);
      }}
    >
      <div className="fullscreen-strip-list" ref={stripRef} onScroll={onScroll}>
        {/* Leading spacer for virtualized items */}
        {winStart > 0 && (
          <div style={{ minWidth: winStart * ITEM_WIDTH, flexShrink: 0 }} />
        )}
        {visibleImages.map((filePath, sliceIdx) => {
          const index = winStart + sliceIdx;
          const fileName = fileNames[index];
          const dist = Math.abs(index - currentIndex);
          return (
            <div
              key={filePath}
              className={`fullscreen-strip-item${index === currentIndex ? " active" : ""}`}
              onClick={() => onSelect(index)}
              title={fileName}
            >
              <CachedThumbnail filePath={filePath} eager={dist < EAGER_WINDOW} />
              <span className="fullscreen-strip-name">{fileName}</span>
            </div>
          );
        })}
        {/* Trailing spacer for virtualized items */}
        {winEnd < images.length && (
          <div style={{ minWidth: (images.length - winEnd) * ITEM_WIDTH, flexShrink: 0 }} />
        )}
      </div>
      <div className="fullscreen-strip-controls">
        <button
          className="fullscreen-strip-btn"
          onClick={onToggleSlideshow}
          title={slideshowActive ? "Pause" : "Play"}
        >
          {slideshowActive ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <polygon points="6,3 20,12 6,21" />
            </svg>
          )}
        </button>
        <button
          className="fullscreen-strip-btn"
          onClick={onCycleMode}
          title={slideshowMode === "forward" ? "Forward" : "Shuffle"}
        >
          <span className="fullscreen-interval-label">{MODE_ICONS[slideshowMode]}</span>
        </button>
        <button
          className="fullscreen-strip-btn fullscreen-interval-btn"
          onClick={onCycleInterval}
          title="Change interval"
        >
          <span className="fullscreen-interval-label">{slideshowInterval}s</span>
        </button>
      </div>
    </div>
  );
});

export default FullscreenStrip;
