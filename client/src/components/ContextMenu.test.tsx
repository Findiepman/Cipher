// @vitest-environment jsdom
/**
 * Regression tests for the right-click menu.
 *
 * The first version of this component dismissed itself on a capture-phase
 * `pointerdown` on the window, with the menu calling `stopPropagation` in its
 * own React handler to opt out. That does not work: React's handlers are
 * bubble-phase at the root, so the capture listener had already fired and
 * unmounted the menu before any item's `onClick` could run. Every item was
 * dead, and nothing about the code said so.
 *
 * The first test here is the one that catches it. StrictMode throughout,
 * because the listeners are registered in an effect and a double pass is what
 * exposes an unbalanced cleanup.
 */
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextMenu, MenuDivider, MenuHeading, MenuItem } from './ContextMenu';

afterEach(cleanup);

function renderMenu(onClose = vi.fn(), onPick = vi.fn()) {
  render(
    <StrictMode>
      <ContextMenu anchor={{ x: 40, y: 60 }} onClose={onClose} label="Actions for teto">
        <MenuHeading>teto</MenuHeading>
        <MenuItem label="Add nickname" onClick={onPick} />
        <MenuDivider />
        <MenuItem danger label="Block" onClick={vi.fn()} />
      </ContextMenu>
    </StrictMode>,
  );
  return { onClose, onPick };
}

describe('picking an item', () => {
  it('runs the item, not the dismiss handler', () => {
    const { onClose, onPick } = renderMenu();

    const item = screen.getByRole('menuitem', { name: 'Add nickname' });
    // A real press is pointerdown then click. The bug lived entirely in the gap
    // between the two, so firing only `click` would not have caught it.
    fireEvent.pointerDown(item);
    fireEvent.click(item);

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('dismissing', () => {
  it('closes on a pointer press outside itself', () => {
    const { onClose } = renderMenu();

    fireEvent.pointerDown(document.body);

    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    const { onClose } = renderMenu();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });

  it('closes on a right-click somewhere else', () => {
    const { onClose } = renderMenu();

    fireEvent.contextMenu(document.body);

    expect(onClose).toHaveBeenCalled();
  });

  it('stays open on a right-click on itself, which only suppresses the browser menu', () => {
    const { onClose } = renderMenu();

    fireEvent.contextMenu(screen.getByRole('menu'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('drops every listener when it unmounts', () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <StrictMode>
        <ContextMenu anchor={{ x: 0, y: 0 }} onClose={onClose} label="Actions">
          <MenuItem label="Only" onClick={vi.fn()} />
        </ContextMenu>
      </StrictMode>,
    );

    unmount();
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('placement', () => {
  it('is portalled to the body, so a scroller cannot clip it', () => {
    renderMenu();

    const menu = screen.getByRole('menu');
    expect(menu.parentElement).toBe(document.body);
  });
});
