import { useEffect, useRef } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";

const KEY = "window-state";

interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
}

function loadState(): WindowState | null {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return null;
}

function saveState(state: WindowState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

export function useWindowState(): void {
  const restored = useRef(false);

  useEffect(() => {
    const win = getCurrentWebviewWindow();
    const saved = loadState();

    // Restore window size/position on first mount
    if (saved && !restored.current) {
      restored.current = true;
      const { x, y, width, height } = saved;
      if (width >= 400 && height >= 300) {
        Promise.all([
          win.setPosition(new PhysicalPosition(x, y)),
          win.setSize(new PhysicalSize(width, height)),
        ]).catch(() => {});
      }
    }

    // Debounced save helper
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const save = async () => {
      try {
        const pos = await win.outerPosition();
        const size = await win.outerSize();
        const fs = await win.isFullscreen();
        if (!fs) {
          saveState({ x: pos.x, y: pos.y, width: size.width, height: size.height });
        }
      } catch { /* ignore */ }
    };

    const debouncedSave = () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 300);
    };

    let unlistenMoved: (() => void) | undefined;
    let unlistenResized: (() => void) | undefined;

    (async () => {
      try {
        unlistenMoved = await win.onMoved(debouncedSave);
        unlistenResized = await win.onResized(debouncedSave);
      } catch { /* ignore */ }
    })();

    return () => {
      if (saveTimer) clearTimeout(saveTimer);
      save(); // Save final state on unmount
      unlistenMoved?.();
      unlistenResized?.();
    };
  }, []);
}
