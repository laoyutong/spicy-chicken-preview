import { useEffect, useRef, useCallback } from "react";
import { t, type Language } from "./i18n";
import "./SettingsModal.css";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  theme: "dark" | "light";
  onThemeChange: (theme: "dark" | "light") => void;
  language: Language;
  onLanguageChange: (lang: Language) => void;
  slideshowInterval: number;
  onSlideshowIntervalChange: (interval: number) => void;
}

const SLIDESHOW_INTERVALS = [2, 3, 5, 10] as const;

export default function SettingsModal({
  open,
  onClose,
  theme,
  onThemeChange,
  language,
  onLanguageChange,
  slideshowInterval,
  onSlideshowIntervalChange,
}: SettingsModalProps) {
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
    // Focus the close button on open
    const closeBtn = modalRef.current?.querySelector<HTMLButtonElement>(".settings-close-btn");
    closeBtn?.focus();
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div className="settings-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="settings-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.title", language)}
      >
        <div className="settings-header">
          <span className="settings-title">{t("settings.title", language)}</span>
          <button
            className="settings-close-btn"
            onClick={onClose}
            aria-label={t("settings.close", language)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="settings-section">
          <span className="settings-section-label">{t("settings.theme", language)}</span>
          <div className="settings-btn-group" role="radiogroup" aria-label={t("settings.theme", language)}>
            {(["dark", "light"] as const).map((value) => (
              <button
                key={value}
                className={`settings-seg-btn${theme === value ? " selected" : ""}`}
                onClick={() => onThemeChange(value)}
                role="radio"
                aria-checked={theme === value}
              >
                {t(`settings.theme.${value}`, language)}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-section">
          <span className="settings-section-label">{t("settings.language", language)}</span>
          <div className="settings-btn-group" role="radiogroup" aria-label={t("settings.language", language)}>
            {(["en", "zh"] as const).map((value) => (
              <button
                key={value}
                className={`settings-seg-btn${language === value ? " selected" : ""}`}
                onClick={() => onLanguageChange(value)}
                role="radio"
                aria-checked={language === value}
              >
                {t(`settings.language.${value}`, language)}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-section">
          <span className="settings-section-label">{t("settings.slideshow", language)}</span>
          <div className="settings-btn-group" role="radiogroup" aria-label={t("settings.slideshow", language)}>
            {SLIDESHOW_INTERVALS.map((value) => (
              <button
                key={value}
                className={`settings-seg-btn${slideshowInterval === value ? " selected" : ""}`}
                onClick={() => onSlideshowIntervalChange(value)}
                role="radio"
                aria-checked={slideshowInterval === value}
              >
                {t(`settings.slideshow.${value}s`, language)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
