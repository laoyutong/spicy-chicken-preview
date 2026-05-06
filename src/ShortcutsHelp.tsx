import { useEffect, useRef, useCallback } from "react";
import { t, translate, type Language } from "./i18n";
import "./ShortcutsHelp.css";

interface ShortcutsHelpProps {
  open: boolean;
  onClose: () => void;
  language: Language;
}

interface ShortcutEntry {
  keys: string[];
  descriptionKey: string;
}

const SHORTCUTS: ShortcutEntry[] = [
  { keys: ["\u2190", "\u2192"], descriptionKey: "shortcuts.prevNext" },
  { keys: ["Space"], descriptionKey: "shortcuts.toggleSlideshow" },
  { keys: ["F"], descriptionKey: "shortcuts.toggleFullscreen" },
  { keys: ["Cmd", "+", "=/+"], descriptionKey: "shortcuts.zoomIn" },
  { keys: ["Cmd", "+", "-"], descriptionKey: "shortcuts.zoomOut" },
  { keys: ["0", "/", "Cmd", "+", "0"], descriptionKey: "shortcuts.resetZoom" },
  { keys: ["Cmd", "+", "B"], descriptionKey: "shortcuts.toggleSidebar" },
  { keys: ["Cmd", "+", "C"], descriptionKey: "shortcuts.copyImage" },
  { keys: ["R"], descriptionKey: "shortcuts.rotateCw" },
  { keys: ["Shift", "+", "R"], descriptionKey: "shortcuts.rotateCcw" },
  { keys: ["Delete", "/", "Backspace"], descriptionKey: "shortcuts.moveToTrash" },
  { keys: ["Esc"], descriptionKey: "shortcuts.exitImmersive" },
  { keys: ["Double-click"], descriptionKey: "shortcuts.toggleImmersive" },
  { keys: ["?"], descriptionKey: "shortcuts.showHelp" },
];

export default function ShortcutsHelp({ open, onClose, language }: ShortcutsHelpProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Tab" && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeBtn = modalRef.current?.querySelector<HTMLButtonElement>(".shortcuts-close-btn");
    closeBtn?.focus();
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  const modifierLabel = t("shortcuts.modifier", language);

  return (
    <div className="shortcuts-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="shortcuts-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("shortcuts.title", language)}
      >
        <div className="shortcuts-header">
          <span className="shortcuts-title">{t("shortcuts.title", language)}</span>
          <button
            className="shortcuts-close-btn"
            onClick={onClose}
            aria-label={t("shortcuts.close", language)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="shortcuts-section-label">{t("shortcuts.navigation", language)}</div>
        <div className="shortcuts-list">
          {SHORTCUTS.map((entry) => (
            <div key={entry.descriptionKey} className="shortcuts-row">
              <div className="shortcuts-keys">
                {entry.keys.map((k, i) => {
                  if (k === "+") {
                    return <span key={i} className="shortcuts-plus">+</span>;
                  }
                  if (k === "/") {
                    return <span key={i} className="shortcuts-or">/</span>;
                  }
                  const label = k === "Cmd" ? modifierLabel : k;
                  return <kbd key={i}>{label}</kbd>;
                })}
              </div>
              <span className="shortcuts-desc">{translate(entry.descriptionKey, language)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
