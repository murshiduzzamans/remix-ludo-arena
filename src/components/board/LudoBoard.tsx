/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { getStackOffsets, getTokenCanvasPoint, getTokenTrackCellIndex } from '../../engine/boardCoordinates';
import { GameState, PlayerColor, TokenState } from '../../engine/types';
import { BoardCenter } from './BoardCenter';
import { BoardQuadrant } from './BoardQuadrant';
import { BoardTrack } from './BoardTrack';
import { PawnPiece } from './PawnPiece';

export interface AnimatingTokenInfo {
  color: PlayerColor;
  tokenIndex: number;
  currentStep: number;
  isHopping: boolean;
}

interface LudoBoardProps {
  gameState: GameState;
  onTokenClick?: (tokenIndex: number, color?: PlayerColor) => void;
  selectedTokenIndex?: number | null;
  /** Colour the local player controls this turn; null means no tokens are tappable (bot turns) */
  interactiveColor?: PlayerColor | null;
  animatingToken?: AnimatingTokenInfo | null;
  rotationDegrees?: number;
}

function getUniversalPositionKey(color: PlayerColor, step: number): string | null {
  if (step < 0) return null; // Yard has dedicated slots
  if (step >= 56) return null; // Center finish has dedicated quadrant spread
  if (step >= 51) return `home-${color}-${step}`; // Colored home path is player-specific
  const trackIdx = getTokenTrackCellIndex(color, step);
  return trackIdx !== null ? `track-${trackIdx}` : null;
}

export const LudoBoard: React.FC<LudoBoardProps> = ({
  gameState,
  onTokenClick,
  selectedTokenIndex = null,
  interactiveColor = null,
  animatingToken = null,
  rotationDegrees = 0,
}) => {
  const { players, currentTurnColor, phase, legalMoves } = gameState;

  // Only the controlling player's turn makes tokens tappable (supports partner-assist moves too)
  const isTurnInteractive = interactiveColor !== null && currentTurnColor === interactiveColor;
  const playableActions =
    phase === 'moving' && isTurnInteractive && !animatingToken
      ? legalMoves
      : [];

  // Group tokens sitting on the exact same board position to apply clean micro-offsets (including safe stars)
  const positionGroups = new Map<string, Array<{ color: PlayerColor; token: TokenState }>>();

  for (const player of players) {
    for (const token of player.tokens) {
      const step =
        animatingToken &&
        animatingToken.color === player.color &&
        animatingToken.tokenIndex === token.index
          ? animatingToken.currentStep
          : token.stepCount;

      const key = getUniversalPositionKey(player.color, step);
      if (key && !token.isHome) {
        const existing = positionGroups.get(key) || [];
        existing.push({ color: player.color, token });
        positionGroups.set(key, existing);
      }
    }
  }

  return (
    <div className="relative w-full max-w-[min(92vw,440px)] aspect-square mx-auto p-1 rounded-2xl bg-white border-4 border-[#072B6B] shadow-2xl shadow-black/80 select-none overflow-hidden">
      {/* Dynamic Smooth Board Rotation Wrapper */}
      <div
        className="w-full h-full rounded-xl overflow-hidden"
        style={{
          transform: `rotate(${rotationDegrees}deg)`,
          transformOrigin: 'center center',
          transition: 'transform 0.6s cubic-bezier(0.25, 0.9, 0.45, 1)',
        }}
      >
        <svg
          viewBox="0 0 600 600"
          className="w-full h-full select-none block"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Board Background Field (Flat White) */}
          <rect width="600" height="600" fill="#FFFFFF" />

          {/* 1. Four Corner Yards / Bases (Large Circles with 2x2 Slots) */}
          <BoardQuadrant color="red" x={0} y={0} width={240} height={240} />
          <BoardQuadrant color="green" x={360} y={0} width={240} height={240} />
          <BoardQuadrant color="yellow" x={360} y={360} width={240} height={240} />
          <BoardQuadrant color="blue" x={0} y={360} width={240} height={240} />

          {/* 2. Perimeter Track & Colored Home Columns */}
          <BoardTrack />

          {/* 3. Center Triumph Zone with subtle white star */}
          <BoardCenter players={players} />

          {/* 4. Active Pawns */}
          <g id="ludo-pawns-layer">
            {players.map((player) => {
              return (
                <g key={`pawns-${player.color}`}>
                  {player.tokens.map((token) => {
                    const isThisAnimating =
                      animatingToken !== null &&
                      animatingToken.color === player.color &&
                      animatingToken.tokenIndex === token.index;

                    const stepToUse = isThisAnimating
                      ? animatingToken.currentStep
                      : token.stepCount;

                    const basePoint = getTokenCanvasPoint(player.color, stepToUse, token.index);

                    // Apply micro-offset if multiple tokens are stacked on the same tile (e.g. safe star cell)
                    let offsetX = 0;
                    let offsetY = 0;
                    const key = getUniversalPositionKey(player.color, stepToUse);
                    let blockCount = 0;
                    if (key && !token.isHome) {
                      const group = positionGroups.get(key) || [];
                      if (group.length > 1) {
                        const idxInGroup = group.findIndex(
                          (g) => g.color === player.color && g.token.index === token.index
                        );
                        const offsets = getStackOffsets(group.length);
                        const off = offsets[idxInGroup >= 0 ? idxInGroup : 0];
                        offsetX = off.x;
                        offsetY = off.y;
                      }
                      blockCount = group.filter((entry) => entry.color === player.color).length;
                    }

                    const isPlayable = playableActions.some(
                      (m) =>
                        (m.tokenColor || currentTurnColor) === player.color &&
                        m.tokenIndex === token.index
                    );
                    const isSelected = selectedTokenIndex === token.index && isPlayable;

                    return (
                      <PawnPiece
                        key={token.id}
                        token={token}
                        color={player.color}
                        x={basePoint.x + offsetX}
                        y={basePoint.y + offsetY}
                        isPlayable={isPlayable}
                        isSelected={isSelected}
                        isAnimating={isThisAnimating}
                        stepKey={stepToUse}
                        boardRotation={rotationDegrees}
                        blockCount={gameState.rules.blocksEnabled ? blockCount : 0}
                        onClick={() => onTokenClick?.(token.index, player.color)}
                      />
                    );
                  })}
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
};
