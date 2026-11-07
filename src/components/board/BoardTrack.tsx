/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  CELL_SIZE,
  HOME_COLUMNS,
  TRACK_CELL_COORDS,
} from '../../engine/boardCoordinates';
import {
  COLOR_START_TRACK_INDEX,
  COLOR_THEMES,
  SAFE_TRACK_CELLS,
} from '../../engine/constants';
import { PlayerColor } from '../../engine/types';

// Clean outlined Star icon matching the uploaded screenshot
const StarIcon: React.FC<{ x: number; y: number; size?: number }> = ({ x, y, size = 12 }) => {
  const points = [];
  const innerRadius = size * 0.42;
  const outerRadius = size;
  for (let i = 0; i < 10; i++) {
    const angle = (i * Math.PI) / 5 - Math.PI / 2;
    const r = i % 2 === 0 ? outerRadius : innerRadius;
    points.push(`${x + r * Math.cos(angle)},${y + r * Math.sin(angle)}`);
  }
  return (
    <polygon
      points={points.join(' ')}
      fill="none"
      stroke="#94A3B8"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  );
};

// Directional start arrow for start squares
const StartArrow: React.FC<{ x: number; y: number; color: PlayerColor }> = ({ x, y, color }) => {
  const rotations: Record<PlayerColor, number> = {
    red: 0,
    green: 90,
    yellow: 180,
    blue: 270,
  };

  return (
    <g transform={`translate(${x}, ${y}) rotate(${rotations[color]})`}>
      <path
        d="M -7 -6 L 5 0 L -7 6"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
};

// Big Home Stretch Entry Arrow (as seen in screenshot pointing into home)
const HomeEntryArrow: React.FC<{ color: PlayerColor }> = ({ color }) => {
  // Arrow pointing into the home stretch
  // Red home entry: Col 0, Row 7 -> pointing right into Col 1, Row 7
  // Green home entry: Col 7, Row 0 -> pointing down into Col 7, Row 1
  // Yellow home entry: Col 14, Row 7 -> pointing left into Col 13, Row 7
  // Blue home entry: Col 7, Row 14 -> pointing up into Col 7, Row 13
  const theme = COLOR_THEMES[color];

  switch (color) {
    case 'red':
      return (
        <polygon
          points="2,284 38,300 2,316"
          fill={theme.primary}
          stroke={theme.border}
          strokeWidth="1"
        />
      );
    case 'green':
      return (
        <polygon
          points="284,2 300,38 316,2"
          fill={theme.primary}
          stroke={theme.border}
          strokeWidth="1"
        />
      );
    case 'yellow':
      return (
        <polygon
          points="598,284 562,300 598,316"
          fill={theme.primary}
          stroke={theme.border}
          strokeWidth="1"
        />
      );
    case 'blue':
      return (
        <polygon
          points="284,598 300,562 316,598"
          fill={theme.primary}
          stroke={theme.border}
          strokeWidth="1"
        />
      );
  }
};

export const BoardTrack: React.FC = () => {
  const colors: PlayerColor[] = ['red', 'green', 'yellow', 'blue'];

  return (
    <g id="ludo-track-layer">
      {/* 1. The 52 Outer Track Cells (White cells with clean borders) */}
      {TRACK_CELL_COORDS.map((coord, idx) => {
        const x = coord.col * CELL_SIZE;
        const y = coord.row * CELL_SIZE;
        const cx = x + CELL_SIZE / 2;
        const cy = y + CELL_SIZE / 2;

        const isSafe = SAFE_TRACK_CELLS.has(idx);

        // Check if start square for any color
        let startColor: PlayerColor | null = null;
        for (const c of colors) {
          if (COLOR_START_TRACK_INDEX[c] === idx) {
            startColor = c;
            break;
          }
        }

        const isStart = startColor !== null;
        const startTheme = startColor ? COLOR_THEMES[startColor] : null;

        return (
          <g key={`track-cell-${idx}`}>
            {/* Cell Background */}
            <rect
              x={x}
              y={y}
              width={CELL_SIZE}
              height={CELL_SIZE}
              fill={isStart && startTheme ? startTheme.primary : '#FFFFFF'}
              stroke="#CBD5E1"
              strokeWidth="1"
            />

            {/* Start Arrow if Start Cell */}
            {isStart && startColor && <StartArrow x={cx} y={cy} color={startColor} />}

            {/* Star if Safe Cell (and not start) */}
            {isSafe && !isStart && <StarIcon x={cx} y={cy} size={11} />}
          </g>
        );
      })}

      {/* 2. Four Colored Home Stretch Columns (Solid vibrant color matching screenshot) */}
      {colors.map((color) => {
        const coords = HOME_COLUMNS[color];
        const theme = COLOR_THEMES[color];

        return (
          <g key={`home-column-${color}`}>
            {coords.map((coord, stepIdx) => {
              const x = coord.col * CELL_SIZE;
              const y = coord.row * CELL_SIZE;

              return (
                <rect
                  key={`home-${color}-${stepIdx}`}
                  x={x}
                  y={y}
                  width={CELL_SIZE}
                  height={CELL_SIZE}
                  fill={theme.primary}
                  stroke="#FFFFFF"
                  strokeWidth="1"
                />
              );
            })}
          </g>
        );
      })}

      {/* 3. Big Home Stretch Entry Arrows */}
      {colors.map((color) => (
        <HomeEntryArrow key={`arrow-${color}`} color={color} />
      ))}
    </g>
  );
};
