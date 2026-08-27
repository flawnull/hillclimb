"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

interface UseModalDialogOptions {
  /** Called when the modal should close (Escape key). */
  onClose: () => void;
  /**
   * Ref to the element that should receive focus when the modal opens.
   * Falls back to the first focusable element inside the panel.
   */
  initialFocusRef?: React.RefObject<HTMLElement>;
}

/**
 * Shared behaviour for the app's fixed-overlay modals: role="dialog" +
 * aria-modal wiring, Escape-to-close, a simple Tab/Shift+Tab focus trap,
 * initial focus on open, and focus restoration to whatever was focused
 * before the modal opened.
 *
 * The page's global keydown handler already ignores events that originate
 * from inputs/textareas/selects/contentEditable (so typing a driver name
 * doesn't trigger shortcuts). Escape from within a text input still bubbles
 * here since that guard only filters letter-key shortcuts, not this hook —
 * this listener is scoped to the modal panel itself via a capture-free
 * document listener, so it never fights that guard.
 */
export function useModalDialog({ onClose, initialFocusRef }: UseModalDialogOptions) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const toFocus =
      initialFocusRef?.current ??
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
      panelRef.current;
    toFocus?.focus();

    return () => {
      previouslyFocused.current?.focus?.();
    };
    // Only run on mount/unmount — we don't want to re-focus on unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === "Tab") {
        const panel = panelRef.current;
        if (!panel) return;
        const focusable = Array.from(
          panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        ).filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;

        if (e.shiftKey) {
          if (active === first || !panel.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last || !panel.contains(active)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  return { panelRef };
}
