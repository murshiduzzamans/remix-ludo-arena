/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { COLOR_START_TRACK_INDEX, TOTAL_STEPS_TO_FINISH, TOTAL_TRACK_CELLS, YARD_STEP } from './constants';
import { PlayerColor } from './types';

export interface GridCoord {
  col: number;
  row: number;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

export const CELL_SIZE = 40; // 15 columns * 40px = 600px total board width & height
export const BOARD_SIZE = 600;

// The 52 track cells in clockwise sequence from (col:0, row:6)
export const TRACK_CELL_COORDS: GridCoord[] = [
  /* 0..5: Left-to-center horizontal arm (top lane) */
  { col: 0, row: 6 },
  { col: 1, row: 6 }, // 1: Red Start
  { col: 2, row: 6 },
  { col: 3, row: 6 },
  { col: 4, row: 6 },
  { col: 5, row: 6 },

  /* 6..11: Top vertical arm (left lane, heading up) */
  { col: 6, row: 5 },
  { col: 6, row: 4 },
  { col: 6, row: 3 },
  { col: 6, row: 2 }, // 9: Star Safe
  { col: 6, row: 1 },
  { col: 6, row: 0 },

  /* 12: Top middle peak */
  { col: 7, row: 0 },

  /* 13..18: Top vertical arm (right lane, heading down) */
  { col: 8, row: 0 },
  { col: 8, row: 1 }, // 14: Green Start
  { col: 8, row: 2 },
  { col: 8, row: 3 },
  { col: 8, row: 4 },
  { col: 8, row: 5 },

  /* 19..24: Right horizontal arm (top lane, heading right) */
  { col: 9, row: 6 },
  { col: 10, row: 6 },
  { col: 11, row: 6 },
  { col: 12, row: 6 }, // 22: Star Safe
  { col: 13, row: 6 },
  { col: 14, row: 6 },

  /* 25: Right middle peak */
  { col: 14, row: 7 },

  /* 26..31: Right horizontal arm (bottom lane, heading left) */
  { col: 14, row: 8 },
  { col: 13, row: 8 }, // 27: Yellow Start
  { col: 12, row: 8 },
  { col: 11, row: 8 },
  { col: 10, row: 8 },
  { col: 9, row: 8 },

  /* 32..37: Bottom vertical arm (right lane, heading down) */
  { col: 8, row: 9 },
  { col: 8, row: 10 },
  { col: 8, row: 11 },
  { col: 8, row: 12 }, // 35: Star Safe
  { col: 8, row: 13 },
  { col: 8, row: 14 },

  /* 38: Bottom middle peak */
  { col: 7, row: 14 },

  /* 39..44: Bottom vertical arm (left lane, heading up) */
  { col: 6, row: 14 },
  { col: 6, row: 13 }, // 40: Blue Start
  { col: 6, row: 12 },
  { col: 6, row: 11 },
  { col: 6, row: 10 },
  { col: 6, row: 9 },

  /* 45..50: Left horizontal arm (bottom lane, heading left) */
  { col: 5, row: 8 },
  { col: 4, row: 8 },
  { col: 3, row: 8 },
  { col: 2, row: 8 }, // 48: Star Safe
  { col: 1, row: 8 },
  { col: 0, row: 8 },

  /* 51: Left middle entry point */
  { col: 0, row: 7 },
];

// Colored home column coordinates (5 squares leading to the center)
export const HOME_COLUMNS: Record<PlayerColor, GridCoord[]> = {
  red: [
    { col: 1, row: 7 },
    { col: 2, row: 7 },
    { col: 3, row: 7 },
    { col: 4, row: 7 },
    { col: 5, row: 7 },
  ],
  green: [
    { col: 7, row: 1 },
    { col: 7, row: 2 },
    { col: 7, row: 3 },
    { col: 7, row: 4 },
    { col: 7, row: 5 },
  ],
  yellow: [
    { col: 13, row: 7 },
    { col: 12, row: 7 },
    { col: 11, row: 7 },
    { col: 10, row: 7 },
    { col: 9, row: 7 },
  ],
  blue: [
    { col: 7, row: 13 },
    { col: 7, row: 12 },
    { col: 7, row: 11 },
    { col: 7, row: 10 },
    { col: 7, row: 9 },
  ],
};

// Center finish points for finished tokens
export const CENTER_POINTS: Record<PlayerColor, CanvasPoint> = {
  red: { x: 265, y: 300 },
  green: { x: 300, y: 265 },
  yellow: { x: 335, y: 300 },
  blue: { x: 300, y: 335 },
};

// Yard token slots inside the 4 corners
export const YARD_TOKEN_COORDS: Record<PlayerColor, CanvasPoint[]> = {
  red: [
    { x: 80, y: 80 },
    { x: 160, y: 80 },
    { x: 80, y: 160 },
    { x: 160, y: 160 },
  ],
  green: [
    { x: 440, y: 80 },
    { x: 520, y: 80 },
    { x: 440, y: 160 },
    { x: 520, y: 160 },
  ],
  yellow: [
    { x: 440, y: 440 },
    { x: 520, y: 440 },
    { x: 440, y: 520 },
    { x: 520, y: 520 },
  ],
  blue: [
    { x: 80, y: 440 },
    { x: 160, y: 440 },
    { x: 80, y: 520 },
    { x: 160, y: 520 },
  ],
};

/**
 * Converts a grid coordinate (0..14) to SVG pixel center
 */
export function gridToCanvas(coord: GridCoord): CanvasPoint {
  return {
    x: coord.col * CELL_SIZE + CELL_SIZE / 2,
    y: coord.row * CELL_SIZE + CELL_SIZE / 2,
  };
}

/**
 * Calculates the exact (x, y) point for a token given its color, stepCount, and index.
 * stepCount:
 *  -1 : Yard
 *  0..50 : On the 52-cell track
 *  51..55 : In the 5-cell Home column
 *  56 : Center finish
 */
export function getTokenCanvasPoint(
  color: PlayerColor,
  stepCount: number,
  tokenIndex: number
): CanvasPoint {
  if (!Number.isInteger(stepCount) || stepCount < YARD_STEP || stepCount > TOTAL_STEPS_TO_FINISH) {
    throw new RangeError(`Invalid token stepCount: ${stepCount}`);
  }
  if (!Number.isInteger(tokenIndex) || tokenIndex < 0 || tokenIndex > 3) {
    throw new RangeError(`Invalid token index: ${tokenIndex}`);
  }
  if (stepCount === YARD_STEP) {
    return YARD_TOKEN_COORDS[color][tokenIndex];
  }

  if (stepCount >= 56) {
    // Spread finished tokens slightly in center
    const base = CENTER_POINTS[color];
    const offsets = [
      { x: -8, y: -8 },
      { x: 8, y: -8 },
      { x: -8, y: 8 },
      { x: 8, y: 8 },
    ];
    const off = offsets[tokenIndex % 4];
    return { x: base.x + off.x, y: base.y + off.y };
  }

  if (stepCount >= 51) {
    // Home column (51..55 -> indices 0..4)
    const homeIndex = stepCount - 51;
    const gridCoord = HOME_COLUMNS[color][homeIndex];
    return gridToCanvas(gridCoord);
  }

  // On outer track (0..50)
  const startTrackIdx = COLOR_START_TRACK_INDEX[color];
  const trackIdx = (startTrackIdx + stepCount) % TOTAL_TRACK_CELLS;
  const gridCoord = TRACK_CELL_COORDS[trackIdx];
  return gridToCanvas(gridCoord);
}

export function getStackOffsets(count: number, cellSize = CELL_SIZE): CanvasPoint[] {
  if (!Number.isInteger(count) || count < 0) throw new RangeError(`Invalid stack count: ${count}`);
  if (count === 0) return [];
  if (count === 1) return [{ x: 0, y: 0 }];
  const radius = Math.min(cellSize * 0.2, 9);
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / count;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
}

export function getStepPath(color: PlayerColor, fromStep: number, toStep: number, tokenIndex = 0): CanvasPoint[] {
  if (fromStep < YARD_STEP || toStep > TOTAL_STEPS_TO_FINISH || toStep < fromStep) {
    throw new RangeError(`Invalid token path: ${fromStep} -> ${toStep}`);
  }
  if (fromStep === YARD_STEP) {
    if (toStep !== 0) throw new RangeError('A yard exit must land on step 0.');
    return [getTokenCanvasPoint(color, YARD_STEP, tokenIndex), getTokenCanvasPoint(color, 0, tokenIndex)];
  }
  return Array.from({ length: toStep - fromStep }, (_, index) =>
    getTokenCanvasPoint(color, fromStep + index + 1, tokenIndex)
  );
}

/**
 * Returns the track cell index (0..51) for a token on the main track, or null if in yard / home path
 */
export function getTokenTrackCellIndex(color: PlayerColor, stepCount: number): number | null {
  if (stepCount < 0 || stepCount > 50) return null;
  const startTrackIdx = COLOR_START_TRACK_INDEX[color];
  return (startTrackIdx + stepCount) % TOTAL_TRACK_CELLS;
}
