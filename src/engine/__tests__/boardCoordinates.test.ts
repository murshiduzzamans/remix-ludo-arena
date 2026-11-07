import { describe, expect, it } from 'vitest';
import { COLOR_ORDER, COLOR_START_TRACK_INDEX, STAR_TRACK_CELLS, START_TRACK_CELLS, TOTAL_STEPS_TO_FINISH } from '../constants';
import { CENTER_POINTS, getStackOffsets, getStepPath, getTokenCanvasPoint, TRACK_CELL_COORDS } from '../boardCoordinates';

const manhattan = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

describe('board geometry', () => {
  it('has 52 unique track cells inside the 15 by 15 board', () => {
    expect(TRACK_CELL_COORDS).toHaveLength(52);
    expect(new Set(TRACK_CELL_COORDS.map(({ col, row }) => `${col},${row}`)).size).toBe(52);
    for (const { col, row } of TRACK_CELL_COORDS) {
      expect(col).toBeGreaterThanOrEqual(0); expect(col).toBeLessThanOrEqual(14);
      expect(row).toBeGreaterThanOrEqual(0); expect(row).toBeLessThanOrEqual(14);
    }
  });

  it('documents the canonical diagonal corner joins and checks all other track joins', () => {
    const diagonalJoins = new Set([5, 18, 31, 44]);
    for (let index = 0; index < TRACK_CELL_COORDS.length; index += 1) {
      const a = TRACK_CELL_COORDS[index];
      const b = TRACK_CELL_COORDS[(index + 1) % TRACK_CELL_COORDS.length];
      const distance = Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
      expect(distance).toBe(diagonalJoins.has(index) ? 2 : 1);
    }
  });

  it('keeps each color path aligned to the canonical track and home columns', () => {
    for (const color of COLOR_ORDER) {
      let diagonalJoins = 0;
      for (let step = 0; step < 55; step += 1) {
        const distance = manhattan(getTokenCanvasPoint(color, step, 0), getTokenCanvasPoint(color, step + 1, 0));
        if (distance === 80) diagonalJoins += 1;
        else expect(distance).toBe(40);
      }
      expect(diagonalJoins).toBe(4);
    }
  });

  it('preserves the canonical start and star cell indices', () => {
    expect([...START_TRACK_CELLS].sort((a, b) => a - b)).toEqual([1, 14, 27, 40]);
    expect([...STAR_TRACK_CELLS].sort((a, b) => a - b)).toEqual([9, 22, 35, 48]);
    expect(COLOR_ORDER.map((color) => COLOR_START_TRACK_INDEX[color]).sort((a, b) => a - b)).toEqual([1, 14, 27, 40]);
  });

  it('guards invalid positions and returns every step in an animation path', () => {
    expect(() => getTokenCanvasPoint('red', -2, 0)).toThrow(RangeError);
    expect(() => getTokenCanvasPoint('red', TOTAL_STEPS_TO_FINISH + 1, 0)).toThrow(RangeError);
    expect(getStepPath('red', -1, 0)).toHaveLength(2);
    expect(getStepPath('green', 4, 9)).toHaveLength(5);
    expect(getTokenCanvasPoint('red', 56, 0)).toEqual({ x: CENTER_POINTS.red.x - 8, y: CENTER_POINTS.red.y - 8 });
  });

  it('returns distinct offsets for stacked tokens', () => {
    for (const count of [2, 3, 4]) {
      const offsets = getStackOffsets(count);
      expect(offsets).toHaveLength(count);
      expect(new Set(offsets.map(({ x, y }) => `${x.toFixed(3)},${y.toFixed(3)}`)).size).toBe(count);
    }
  });
});
