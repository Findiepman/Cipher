import { describe, expect, it } from 'vitest';
import { MIN_PASSWORD_LENGTH, checkPassword } from './passwordPolicy';

describe('checkPassword', () => {
  it('accepts a decent passphrase', () => {
    const result = checkPassword('marmalade tuesday brick');
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it('rejects anything under the server minimum', () => {
    const result = checkPassword('short1!');
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain(String(MIN_PASSWORD_LENGTH));
  });

  it('rejects long-but-common passwords', () => {
    expect(checkPassword('password12345').ok).toBe(false);
    expect(checkPassword('correcthorsebatterystaple').ok).toBe(false);
  });

  it('rejects repetition and sequences that pass the length check', () => {
    expect(checkPassword('aaaaaaaaaaaaaaa').ok).toBe(false);
    expect(checkPassword('abcdefghijklmn').ok).toBe(false);
  });

  it('rejects a password built from the account it protects', () => {
    const result = checkPassword('samuelsamuel99', { email: 'samuel@example.com' });
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/email/);
  });

  it('scores length above variety, for a meter', () => {
    expect(checkPassword('').score).toBe(0);
    expect(checkPassword('short').score).toBe(0);
    // A long all-lowercase passphrase must not score below a short password
    // with a symbol in it, or the meter is teaching the wrong lesson.
    expect(checkPassword('marmalade tuesday brick etcetera').score).toBe(4);
    expect(checkPassword('marmalade tuesday brick').score).toBe(3);
    expect(checkPassword('Sh0rt!Passw0rd').score).toBeLessThan(
      checkPassword('marmalade tuesday brick etcetera').score,
    );
  });
});
