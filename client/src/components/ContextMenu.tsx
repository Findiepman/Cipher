/**
 * The right-click menu.
 *
 * Rendered at fixed coordinates in a portal rather than inside the row that
 * opened it, because a conversation row lives in a scroller with
 * `overflow: hidden` on one axis and a menu anchored inside it would be
 * clipped. The trade is that the menu does not follow its row when the list
 * scrolls, so scrolling closes it.
 *
 * It closes on anything that means "I have moved on": Escape, a click anywhere,
 * a scroll, a resize and a second right-click somewhere else. Losing a menu is
 * cheap; a menu that will not go away is not.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import '../styles/context-menu.css';

export type MenuAnchor = { x: number; y: number };

type Props = {
  anchor: MenuAnchor;
  onClose: () => void;
  children: ReactNode;
  /** Names the menu for screen readers, e.g. the person it acts on. */
  label: string;
};

/** Kept off the viewport edges so a menu opened near one is still readable. */
const EDGE_GAP = 8;

export function ContextMenu({ anchor, onClose, children, label }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<MenuAnchor>(anchor);

  // Measured after paint, because the flip depends on how tall the menu turned
  // out to be. Placing it first and correcting is one frame of being slightly
  // wrong; guessing the height would be wrong for longer.
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element) return;

    const { width, height } = element.getBoundingClientRect();
    setPosition({
      x: Math.min(anchor.x, window.innerWidth - width - EDGE_GAP),
      y: Math.min(anchor.y, window.innerHeight - height - EDGE_GAP),
    });
  }, [anchor]);

  useEffect(() => {
    /**
     * Listening in the capture phase means a click on something that stops
     * propagation still closes the menu. It also means this runs *before*
     * React's own handlers, which are bubble-phase at the root: without the
     * containment check, pressing a menu item would unmount the menu on
     * pointerdown and the item's onClick would never fire at all.
     */
    function dismiss(event: Event) {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    window.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('contextmenu', dismiss, true);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('contextmenu', dismiss, true);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      aria-label={label}
      tabIndex={-1}
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({
  icon,
  label,
  onClick,
  danger = false,
  disabled = false,
}: {
  icon?: ReactNode;
  label: string;
  onClick: () => void;
  /** Destructive actions are red and sit at the bottom, behind a divider. */
  danger?: boolean;
  /**
   * Still drawn, still says what it is, does nothing. For an action that has
   * run out of room rather than one that does not apply: an item that
   * disappeared instead would look like the menu had lost it.
   */
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`context-menu__item${danger ? ' context-menu__item--danger' : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      {icon && <span className="context-menu__icon">{icon}</span>}
      {label}
    </button>
  );
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return <div className="context-menu__heading">{children}</div>;
}

export function MenuDivider() {
  return <div className="context-menu__divider" role="separator" />;
}
