/**
 * The crop maths, which is the part of the avatar editor that can be wrong
 * without looking wrong: an off-by-a-fraction clamp shows as a sliver of empty
 * canvas down one edge of a 128px picture, and only on some photos.
 *
 * Everything here is pure (no canvas, no bitmap), which is why it is worth
 * testing at all. `renderAvatar` is a `drawImage` call over these numbers.
 */
import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, centredCrop, clampCrop, coverSize } from './avatarImage';

const landscape = { width: 4000, height: 3000 }; // 4:3, wider than tall
const portrait = { width: 1080, height: 1920 }; // a phone photo
const square = { width: 512, height: 512 };

describe('coverSize', () => {
  it('spans the square exactly on the shorter edge at zoom 1', () => {
    expect(coverSize(landscape, 1).height).toBeCloseTo(1);
    expect(coverSize(landscape, 1).width).toBeCloseTo(4 / 3);

    expect(coverSize(portrait, 1).width).toBeCloseTo(1);
    expect(coverSize(portrait, 1).height).toBeCloseTo(16 / 9);
  });

  it('scales both edges with zoom', () => {
    const { width, height } = coverSize(square, 2);
    expect(width).toBeCloseTo(2);
    expect(height).toBeCloseTo(2);
  });
});

describe('centredCrop', () => {
  it('takes the middle square, losing the same amount from each side', () => {
    const crop = centredCrop(landscape);
    expect(crop.zoom).toBe(1);
    // A 4:3 picture is 1/3 wider than the square, so a sixth goes off each end.
    expect(crop.x).toBeCloseTo(-1 / 6);
    expect(crop.y).toBeCloseTo(0);
  });

  it('leaves a square picture alone', () => {
    expect(centredCrop(square)).toEqual({ zoom: 1, x: 0, y: 0 });
  });

  it('survives its own clamp, which is what the editor opens on', () => {
    for (const source of [landscape, portrait, square]) {
      expect(clampCrop(source, centredCrop(source))).toEqual(centredCrop(source));
    }
  });
});

describe('clampCrop', () => {
  it('will not let the picture pull away from the left or top edge', () => {
    const crop = clampCrop(landscape, { zoom: 1, x: 0.4, y: 0.4 });
    expect(crop.x).toBe(0);
    expect(crop.y).toBe(0);
  });

  it('will not let it pull away from the right or bottom edge', () => {
    // Dragged far past the end: the far edge lands flush, never inside.
    const crop = clampCrop(landscape, { zoom: 1, x: -5, y: -5 });
    expect(crop.x).toBeCloseTo(1 - coverSize(landscape, 1).width);
    expect(crop.y).toBe(0); // No vertical slack at zoom 1 on a wide photo.
  });

  it('pins the axis that has no slack, whichever one it is', () => {
    expect(clampCrop(portrait, { zoom: 1, x: -0.3, y: -0.2 }).x).toBe(0);
    expect(clampCrop(portrait, { zoom: 1, x: -0.3, y: -0.2 }).y).toBeCloseTo(-0.2);
  });

  it('keeps zoom inside the range the slider offers', () => {
    expect(clampCrop(square, { zoom: 0.2, x: 0, y: 0 }).zoom).toBe(1);
    expect(clampCrop(square, { zoom: 99, x: 0, y: 0 }).zoom).toBe(MAX_ZOOM);
  });

  it('gives a zoomed square picture slack on both axes', () => {
    const crop = clampCrop(square, { zoom: 2, x: -0.5, y: -0.5 });
    expect(crop.x).toBeCloseTo(-0.5);
    expect(crop.y).toBeCloseTo(-0.5);
    // ...but not more than the picture actually covers.
    expect(clampCrop(square, { zoom: 2, x: -2, y: -2 }).x).toBeCloseTo(-1);
  });
});
