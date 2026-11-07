/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PlayerColor, TeamId } from './types';

export const COLOR_ORDER: PlayerColor[] = ['red', 'green', 'yellow', 'blue'];

export const COLOR_THEMES: Record<
  PlayerColor,
  {
    name: string;
    primary: string;
    primaryDark: string;
    primaryLight: string;
    glow: string;
    border: string;
    bgYard: string;
  }
> = {
  red: {
    name: 'Red',
    primary: '#D9383A',
    primaryDark: '#B7282A',
    primaryLight: '#FCA5A5',
    glow: 'rgba(217, 56, 58, 0.4)',
    border: '#B7282A',
    bgYard: '#D9383A',
  },
  green: {
    name: 'Green',
    primary: '#2E7D32',
    primaryDark: '#1E5E24',
    primaryLight: '#A7F3D0',
    glow: 'rgba(46, 125, 50, 0.4)',
    border: '#1E5E24',
    bgYard: '#2E7D32',
  },
  yellow: {
    name: 'Yellow',
    primary: '#E5A100',
    primaryDark: '#B88200',
    primaryLight: '#FEF08A',
    glow: 'rgba(229, 161, 0, 0.4)',
    border: '#B88200',
    bgYard: '#E5A100',
  },
  blue: {
    name: 'Blue',
    primary: '#1E88E5',
    primaryDark: '#1565C0',
    primaryLight: '#BAE6FD',
    glow: 'rgba(30, 136, 229, 0.4)',
    border: '#1565C0',
    bgYard: '#1E88E5',
  },
};

export const COLOR_TEAMS: Record<PlayerColor, TeamId> = {
  red: 'team_A',
  yellow: 'team_A', // Red + Yellow are partners
  green: 'team_B',
  blue: 'team_B', // Green + Blue are partners
};

// 52 cells on the circular track (0..51)
export const TOTAL_TRACK_CELLS = 52;
export const LAST_TRACK_STEP = 50;
export const HOME_COLUMN_START = 51;
export const YARD_STEP = -1;
export const TOTAL_STEPS_TO_FINISH = 56; // 0..50 on track, 51..55 in home column, 56 = finished

// Track start indices for each color
export const COLOR_START_TRACK_INDEX: Record<PlayerColor, number> = {
  red: 1,
  green: 14,
  yellow: 27,
  blue: 40,
};

// Safe track cells where captures cannot take place (8 star squares)
// Start squares (1, 14, 27, 40) plus the 8th square after each start (9, 22, 35, 48)
export const START_TRACK_CELLS: ReadonlySet<number> = new Set([1, 14, 27, 40]);
export const STAR_TRACK_CELLS: ReadonlySet<number> = new Set([9, 22, 35, 48]);
/** @deprecated Use START_TRACK_CELLS / STAR_TRACK_CELLS with isSafeCell. */
export const SAFE_TRACK_CELLS: ReadonlySet<number> = new Set([
  ...START_TRACK_CELLS,
  ...STAR_TRACK_CELLS,
]);
