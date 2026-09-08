// @vitest-environment jsdom
/**
 * The reveal toggle, which is one line of state and two ways to get it wrong:
 * leaving the input as `type="password"` after the toggle, and letting the
 * button steal the tab order between the password box and the submit button.
 */
import { Providers } from '../test/providers';
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PasswordField } from './PasswordField';

afterEach(cleanup);

function renderField(value = 'hunter2') {
  const onChange = vi.fn();
  render(
    <StrictMode>
      <Providers>
        <PasswordField
        label="Password"
        value={value}
        onChange={onChange}
          autoComplete="current-password"
        />
      </Providers>
    </StrictMode>,
  );
  return { onChange, input: screen.getByLabelText('Password') as HTMLInputElement };
}

describe('the reveal toggle', () => {
  it('starts hidden', () => {
    const { input } = renderField();

    expect(input.type).toBe('password');
    expect(screen.getByRole('button', { name: 'Show password' })).toBeTruthy();
  });

  it('shows the password, and hides it again', () => {
    const { input } = renderField();

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input.type).toBe('text');

    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input.type).toBe('password');
  });

  /// Tabbing out of the box has to land on the next thing in the form, not on
  /// the eye. It stays reachable by mouse and by screen reader.
  it('is out of the tab order', () => {
    renderField();

    expect(screen.getByRole('button', { name: 'Show password' }).getAttribute('tabindex')).toBe(
      '-1',
    );
  });

  it('does not submit the form it sits in', () => {
    renderField();

    expect(screen.getByRole('button', { name: 'Show password' }).getAttribute('type')).toBe(
      'button',
    );
  });
});

describe('the input', () => {
  it('reports what was typed', () => {
    const { onChange, input } = renderField('');

    fireEvent.change(input, { target: { value: 'a new password' } });

    expect(onChange).toHaveBeenCalledWith('a new password');
  });
});
