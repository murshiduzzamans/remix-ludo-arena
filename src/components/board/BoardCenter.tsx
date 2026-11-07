/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { COLOR_THEMES } from '../../engine/constants';
import { Player } from '../../engine/types';

interface BoardCenterProps {
  players: Player[];
}

export const BoardCenter: React.FC<BoardCenterProps> = () => {
  // Generate 5-point subtle center star points around (300, 300)
  const starPoints = [];
  const outerR = 12;
  const innerR = 5.2;
  for (let i = 0; i < 10; i++) {
    const angle = (i * Math.PI) / 5 - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    starPoints.push(`${300 + r * Math.cos(angle)},${300 + r * Math.sin(angle)}`);
  }

  return (
    <g id="ludo-center-triumph">
      {/* 1. Base Box */}
      <rect x="240" y="240" width="120" height="120" fill="#FFFFFF" />

      {/* 2. Four Color Triangles Meeting at (300, 300) */}
      {/* Red Triangle (Left) */}
      <polygon
        points="240,240 300,300 240,360"
        fill={COLOR_THEMES.red.primary}
        stroke="#FFFFFF"
        strokeWidth="1.5"
      />

      {/* Green Triangle (Top) */}
      <polygon
        points="240,240 360,240 300,300"
        fill={COLOR_THEMES.green.primary}
        stroke="#FFFFFF"
        strokeWidth="1.5"
      />

      {/* Yellow Triangle (Right) */}
      <polygon
        points="360,240 360,360 300,300"
        fill={COLOR_THEMES.yellow.primary}
        stroke="#FFFFFF"
        strokeWidth="1.5"
      />

      {/* Blue Triangle (Bottom) */}
      <polygon
        points="240,360 300,300 360,360"
        fill={COLOR_THEMES.blue.primary}
        stroke="#FFFFFF"
        strokeWidth="1.5"
      />

      {/* Center Junction White Divider Lines */}
      <line x1="240" y1="240" x2="360" y2="360" stroke="#FFFFFF" strokeWidth="1.5" />
      <line x1="240" y1="360" x2="360" y2="240" stroke="#FFFFFF" strokeWidth="1.5" />

      {/* 3. Subtle White Star in the Middle */}
      <circle cx="300" cy="300" r="16" fill="rgba(255, 255, 255, 0.22)" />
      <polygon
        points={starPoints.join(' ')}
        fill="#FFFFFF"
        fillOpacity="0.95"
        stroke="#FFFFFF"
        strokeWidth="0.5"
        strokeLinejoin="round"
      />
    </g>
  );
};
