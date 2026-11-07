/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { YARD_TOKEN_COORDS } from '../../engine/boardCoordinates';
import { COLOR_THEMES } from '../../engine/constants';
import { PlayerColor } from '../../engine/types';

interface BoardQuadrantProps {
  color: PlayerColor;
  x: number;
  y: number;
  width: number;
  height: number;
}

export const BoardQuadrant: React.FC<BoardQuadrantProps> = ({
  color,
  x,
  y,
  width,
  height,
}) => {
  const theme = COLOR_THEMES[color];
  const slots = YARD_TOKEN_COORDS[color];

  // Inner white panel dimensions matching uploaded image
  const pad = 28;
  const innerX = x + pad;
  const innerY = y + pad;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  return (
    <g id={`quadrant-${color}`}>
      {/* 1. Solid Vibrant Quadrant Background */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={theme.primary}
        stroke="#1E293B"
        strokeWidth="1.5"
      />

      {/* 2. Crisp White Inner Panel matching uploaded image */}
      <rect
        x={innerX}
        y={innerY}
        width={innerW}
        height={innerH}
        rx={18}
        fill="#FFFFFF"
        stroke="#E2E8F0"
        strokeWidth="1"
        filter="drop-shadow(0 2px 6px rgba(0,0,0,0.18))"
      />

      {/* 3. Four Colored Base Discs for the Yard Pawns */}
      {slots.map((slot, idx) => (
        <g key={`slot-${color}-${idx}`}>
          {/* Subtle outer shadow ring */}
          <circle
            cx={slot.x}
            cy={slot.y}
            r="23"
            fill="rgba(0, 0, 0, 0.08)"
          />

          {/* Solid Color Base Disc matching uploaded image */}
          <circle
            cx={slot.x}
            cy={slot.y}
            r="21"
            fill={theme.primary}
            stroke="#FFFFFF"
            strokeWidth="2.5"
          />

          {/* Subtle inner highlight */}
          <circle
            cx={slot.x}
            cy={slot.y}
            r="17"
            fill={theme.primary}
            fillOpacity="0.85"
          />
        </g>
      ))}

      {/* 4. Little Gift Emblem at quadrant inner corner (as in uploaded screenshot) */}
      <g
        transform={`translate(${
          color === 'red'
            ? x + width - 18
            : color === 'green'
            ? x + 18
            : color === 'yellow'
            ? x + 18
            : x + width - 18
        }, ${
          color === 'red'
            ? y + height - 18
            : color === 'green'
            ? y + height - 18
            : color === 'yellow'
            ? y + 18
            : y + 18
        })`}
      >
        <circle r="11" fill="#FEF08A" stroke="#CA8A04" strokeWidth="1.5" />
        <text y="3.5" textAnchor="middle" fontSize="11" className="select-none">
          🎁
        </text>
      </g>
    </g>
  );
};
