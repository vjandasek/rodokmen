import { describe, expect, it } from 'vitest';
import { boxesOverlap, findOverlaps, segmentCrossesBox } from '../src/geometry.ts';

const box = (cx: number, cy: number, width: number, height: number) => ({ cx, cy, width, height });

describe('overlap detection', () => {
  it('detects overlapping and separate boxes', () => {
    expect(boxesOverlap(box(0, 0, 10, 10), box(5, 5, 10, 10))).toBe(true);
    expect(boxesOverlap(box(0, 0, 10, 10), box(20, 0, 10, 10))).toBe(false);
    expect(boxesOverlap(box(0, 0, 10, 10), box(5, 20, 10, 10))).toBe(false);
  });

  it('treats touching edges as not overlapping', () => {
    expect(boxesOverlap(box(0, 0, 10, 10), box(10, 0, 10, 10))).toBe(false);
  });

  it('findOverlaps reports each overlapping pair once', () => {
    expect(findOverlaps([box(0, 0, 10, 10), box(4, 0, 10, 10), box(100, 0, 10, 10)])).toHaveLength(1);
  });
});

describe('segment crossing', () => {
  it('detects a segment through a box and ignores one passing by', () => {
    expect(segmentCrossesBox(-20, 0, 20, 0, box(0, 0, 10, 10))).toBe(true);
    expect(segmentCrossesBox(-20, 8, 20, 8, box(0, 0, 10, 10))).toBe(false);
  });

  it('detects a segment ending inside, ignores one ending at the edge', () => {
    expect(segmentCrossesBox(-20, 0, 0, 0, box(0, 0, 10, 10))).toBe(true);
    expect(segmentCrossesBox(-20, 0, -5, 0, box(0, 0, 10, 10))).toBe(false);
  });

  it('handles diagonal segments clipping only a corner region', () => {
    // Line x + y = 11 stays outside the corner (5,5); x + y = 9 cuts through it.
    expect(segmentCrossesBox(0, 11, 11, 0, box(0, 0, 10, 10))).toBe(false);
    expect(segmentCrossesBox(0, 9, 9, 0, box(0, 0, 10, 10))).toBe(true);
  });
});
