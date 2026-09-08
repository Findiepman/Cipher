import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings/types';
import { describeIncoming, isMuted, shouldNotify } from './notifications';

const on = { ...DEFAULT_SETTINGS.notifications, desktop: true };

const base = {
  settings: on,
  permission: 'granted' as const,
  authorId: 'u-nova',
  selfId: 'u-me',
  focused: false,
};

describe('shouldNotify', () => {
  it('notifies for a message from someone else in a conversation not on screen', () => {
    expect(shouldNotify(base)).toBe(true);
  });

  it('stays quiet unless desktop notifications are on and permitted', () => {
    expect(shouldNotify({ ...base, settings: { ...on, desktop: false } })).toBe(false);
    expect(shouldNotify({ ...base, permission: 'denied' })).toBe(false);
    expect(shouldNotify({ ...base, permission: 'default' })).toBe(false);
  });

  it('stays quiet while paused, and wakes up when the pause runs out', () => {
    const now = Date.parse('2026-09-08T12:00:00.000Z');
    const later = new Date(now + 60_000).toISOString();
    const earlier = new Date(now - 60_000).toISOString();

    expect(shouldNotify({ ...base, now, settings: { ...on, mutedUntil: later } })).toBe(false);
    expect(shouldNotify({ ...base, now, settings: { ...on, mutedUntil: 'forever' } })).toBe(false);
    expect(shouldNotify({ ...base, now, settings: { ...on, mutedUntil: earlier } })).toBe(true);
  });

  it('never announces your own message, from whichever device it came', () => {
    expect(shouldNotify({ ...base, authorId: 'u-me' })).toBe(false);
  });

  it('never announces the conversation you are looking at', () => {
    expect(shouldNotify({ ...base, focused: true })).toBe(false);
  });
});

describe('isMuted', () => {
  it('treats a malformed instant as not muted rather than muted forever', () => {
    expect(isMuted('not a date')).toBe(false);
    expect(isMuted(null)).toBe(false);
  });
});

describe('describeIncoming', () => {
  it('names nobody and quotes nothing with the preview off', () => {
    const described = describeIncoming({ preview: false }, 'nova', 'the launch codes');
    expect(described.title).toBe('New message');
    expect(described.body).not.toContain('nova');
    expect(described.body).not.toContain('launch');
  });

  it('carries the sender and the text with the preview on, trimmed to a line', () => {
    expect(describeIncoming({ preview: true }, 'nova', 'hi there')).toEqual({
      title: 'nova',
      body: 'hi there',
    });
    const long = 'x'.repeat(400);
    const described = describeIncoming({ preview: true }, 'nova', long);
    expect(described.body.length).toBeLessThanOrEqual(140);
    expect(described.body.endsWith('…')).toBe(true);
  });

  it('says a message could not be opened rather than showing nothing', () => {
    expect(describeIncoming({ preview: true }, 'nova', null).body).toMatch(/cannot open/);
  });
});
