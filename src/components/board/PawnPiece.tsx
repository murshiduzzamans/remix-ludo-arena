/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { COLOR_THEMES } from '../../engine/constants';
import { PlayerColor, TokenState } from '../../engine/types';

interface PawnPieceProps {
  token: TokenState;
  color: PlayerColor;
  /** Pawn anchor in board (600x600) coordinates */
  x: number;
  y: number;
  isPlayable: boolean;
  isSelected?: boolean;
  /** True while this pawn is hopping along its path */
  isAnimating?: boolean;
  /** Fades a captured pawn before it returns to its yard */
  isBeingCaptured?: boolean;
  /** Changes every square so the hop animation restarts for each step */
  stepKey: number;
  /** Board rotation in degrees; the pawn counter-rotates to stay upright */
  boardRotation?: number;
  blockCount?: number;
  onClick?: () => void;
}

/**
 * One pawn. Layout is driven by an inline CSS transform on the outer group, which
 * glides between squares. Decorative animations live on inner groups so they never
 * fight with positioning or the upright counter-rotation.
 */
export const PawnPiece: React.FC<PawnPieceProps> = ({
  token,
  color,
  x,
  y,
  isPlayable,
  isSelected = false,
  isAnimating = false,
  isBeingCaptured = false,
  stepKey,
  boardRotation = 0,
  blockCount = 0,
  onClick,
}) => {
  const theme = COLOR_THEMES[color];

  const handleActivate = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    if (isPlayable) onClick?.();
  };

  return (
    <g
      style={{
        transform: `translate(${x}px, ${y}px)`,
        transition: isAnimating
          ? 'transform 220ms linear, opacity 240ms ease-out'
          : 'transform 280ms cubic-bezier(0.3, 0.7, 0.4, 1), opacity 240ms ease-out',
        opacity: isBeingCaptured ? 0.15 : 1,
        pointerEvents: isPlayable ? 'all' : 'none',
        cursor: isPlayable ? 'pointer' : 'default',
      }}
      onClick={isPlayable ? handleActivate : undefined}
      onKeyDown={
        isPlayable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleActivate(e);
              }
            }
          : undefined
      }
      role={isPlayable ? 'button' : undefined}
      tabIndex={isPlayable ? 0 : undefined}
      aria-label={`${color} token ${token.index + 1}${isPlayable ? ' (playable - tap to move)' : ''}`}
    >
      {/* Generous but bounded hit target so neighbouring pawns stay easy to tap */}
      <circle cx={0} cy={-6} r={20} fill="#000" fillOpacity={0} />

      {/* Upright layer: counter-rotates against the board so pawns never appear upside down */}
      <g transform={`rotate(${-boardRotation})`}>
        {/* Ground shadow */}
        <ellipse
          cx={0}
          cy={8.5}
          rx={13}
          ry={5}
          fill="rgba(0, 0, 0, 0.45)"
          className={isPlayable && !isAnimating ? 'svg-shadow-pulse' : undefined}
        />

        {/* Playable marker: spinning dashed ring, ping ring and a tap arrow */}
        {isPlayable && (
          <g>
            <circle
              cx={0}
              cy={7.5}
              r={17}
              fill="none"
              stroke="#FFD200"
              strokeWidth={2.5}
              strokeDasharray="4 3"
              className="svg-spin"
            />
            <circle
              cx={0}
              cy={7.5}
              r={13}
              fill="none"
              stroke="#FBBF24"
              strokeWidth={1.5}
              className="svg-ping"
            />
            <path
              d="M -5 -31 L 5 -31 L 0 -25 Z"
              fill="#FFD200"
              stroke="#B45309"
              strokeWidth={1}
              className="pawn-bob"
            />
          </g>
        )}

        {blockCount >= 2 && (
          <g transform="translate(13 -18)" aria-label={`${blockCount} token block`}>
            <circle r="8" fill="#0F172A" stroke="#FFFFFF" strokeWidth="1.5" />
            <text y="3" textAnchor="middle" fill="#FFFFFF" fontSize="7" fontWeight="900">×{blockCount}</text>
          </g>
        )}

        {/* Base socket ring */}
        <circle cx={0} cy={7.5} r={10.5} fill={theme.primary} stroke="#FFFFFF" strokeWidth={2} />

        {/* Body. Keyed by step so the hop animation restarts on every square. */}
        <g
          key={stepKey}
          className={isAnimating ? 'pawn-hop' : isPlayable ? 'pawn-bob' : undefined}
        >
          {/* Outer white contour */}
          <path
            d="M 0 -22 C -11 -22 -14 -11 0 7 C 14 -11 11 -22 0 -22 Z"
            fill="#FFFFFF"
            stroke="#94A3B8"
            strokeWidth={1.2}
          />

          {/* Coloured core */}
          <path d="M 0 -20 C -8 -20 -10 -11 0 4.5 C 10 -11 8 -20 0 -20 Z" fill={theme.primary} />

          {/* Specular highlight */}
          <ellipse cx={-2.5} cy={-14.5} rx={3.5} ry={1.8} fill="#FFFFFF" fillOpacity={0.7} />

          {/* Centre eye */}
          <circle cx={0} cy={-11.5} r={4.2} fill="#FFFFFF" />

          {isSelected && (
            <circle
              cx={0}
              cy={-11.5}
              r={7}
              fill="none"
              stroke="#FFD200"
              strokeWidth={2}
              strokeDasharray="3 2"
              className="svg-spin"
            />
          )}
        </g>
      </g>
    </g>
  );
};
