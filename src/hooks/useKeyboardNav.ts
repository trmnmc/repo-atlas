/**
 * useKeyboardNav — j/k (and arrow) index movement + Enter select over a
 * flat list of `itemCount` items. Ignores keystrokes while an input or
 * textarea (or any contenteditable element) has focus, so it never steals
 * keystrokes from a search box or filter field elsewhere on the page.
 */
import { useEffect, useRef, useState } from 'react';

export interface UseKeyboardNavOptions {
  itemCount: number;
  onSelect: (index: number) => void;
}

export interface UseKeyboardNavResult {
  activeIndex: number;
  setActiveIndex: (index: number) => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

export function useKeyboardNav({ itemCount, onSelect }: UseKeyboardNavOptions): UseKeyboardNavResult {
  const [activeIndex, setActiveIndex] = useState(0);

  // Refs so the keydown listener can read the latest index/callback without
  // being torn down and rebound every render (and without calling onSelect
  // from inside a setState updater, which React may invoke more than once).
  const indexRef = useRef(activeIndex);
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    indexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // Keep the active index in range when the list shrinks/grows.
  useEffect(() => {
    setActiveIndex((i) => (itemCount <= 0 ? 0 : Math.min(i, itemCount - 1)));
  }, [itemCount]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;
      if (itemCount <= 0) return;

      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, itemCount - 1));
      } else if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        onSelectRef.current(indexRef.current);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [itemCount]);

  return { activeIndex, setActiveIndex };
}
