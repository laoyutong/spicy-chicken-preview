import { useState, useEffect, useCallback, type MutableRefObject } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

interface UseFullscreenParams {
  draw: () => void;
  fullscreenTransitioningRef: MutableRefObject<boolean>;
}

export function useFullscreen({ draw, fullscreenTransitioningRef }: UseFullscreenParams) {
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const [isImmersive, setIsImmersive] = useState(false);

  // Sync fullscreen state with Tauri native window
  useEffect(() => {
    const win = getCurrentWebviewWindow();
    const setup = async () => {
      try {
        const initial = await win.isFullscreen();
        setIsNativeFullscreen(initial);
        let lastFullscreen = initial;

        let resizeTimer: ReturnType<typeof setTimeout> | null = null;
        const unlisten = await win.listen("tauri://resize", async () => {
          if (resizeTimer) return;
          resizeTimer = setTimeout(async () => {
            resizeTimer = null;
            const fs = await win.isFullscreen();
            if (fs !== lastFullscreen) {
              lastFullscreen = fs;
              fullscreenTransitioningRef.current = true;
              setIsNativeFullscreen(fs);
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  fullscreenTransitioningRef.current = false;
                  draw();
                });
              });
            }
          }, 80);
        });
        return unlisten;
      } catch (e) {
        console.error("Fullscreen setup error:", e);
      }
    };
    const promise = setup();
    return () => {
      promise.then((unlisten) => unlisten?.());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleNativeFullscreen = useCallback(async () => {
    try {
      const win = getCurrentWebviewWindow();
      const current = await win.isFullscreen();
      fullscreenTransitioningRef.current = true;
      await win.setFullscreen(!current);
      setIsNativeFullscreen(!current);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fullscreenTransitioningRef.current = false;
          draw();
        });
      });
    } catch (e) {
      console.error("Toggle fullscreen error:", e);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleImmersive = useCallback(() => {
    setIsImmersive((v) => {
      const next = !v;
      if (next) {
        // Entering immersive: lock canvas to CSS-scale BEFORE React re-renders,
        // so the draw triggered by UI-hide layout change doesn't resize the buffer.
        fullscreenTransitioningRef.current = true;
        (async () => {
          try {
            const win = getCurrentWebviewWindow();
            const fs = await win.isFullscreen();
            if (!fs) {
              await win.setFullscreen(true);
              // tauri://resize handler will sync isNativeFullscreen, unlock, and redraw.
            } else {
              // Already fullscreen: no resize event will fire.
              // Unlock after UI-hide layout change settles.
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  fullscreenTransitioningRef.current = false;
                  draw();
                });
              });
            }
          } catch {
            fullscreenTransitioningRef.current = false;
          }
        })();
      }
      return next;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    isNativeFullscreen,
    setIsNativeFullscreen,
    isImmersive,
    setIsImmersive,
    toggleNativeFullscreen,
    toggleImmersive,
  };
}
