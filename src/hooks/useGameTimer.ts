/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';

interface TimerEntry {
  id: number;
  type: 'timeout' | 'interval';
}

/**
 * Centralized timer management hook to prevent memory leaks and stale callbacks.
 *
 * All timers created through this hook are automatically cleaned up on:
 * - Component unmount
 * - Manual cancellation via cancelAll()
 *
 * Use this for bot execution timers, dice animation timers, token movement timers,
 * turn timers, match duration timers, and rematch timers.
 *
 * @returns { start, cancelAll, cancelTimer, activeCount }
 *   - start(delay, callback, type) - creates a timer and returns its numeric id
 *   - cancelAll() - cancels every pending timer
 *   - cancelTimer(id) - cancels a specific timer
 *   - activeCount - number of currently pending timers
 */
export function useGameTimer() {
  const timersRef = useRef<Map<number, TimerEntry>>(new Map());

  /**
   * Starts a timeout or interval timer.
   * Returns the timer id (numeric).
   */
  const start = (
    callback: () => void,
    delay: number,
    type: 'timeout' | 'interval' = 'timeout'
  ): number => {
    let timerId: number;
    if (type === 'timeout') {
      timerId = window.setTimeout(() => {
        timersRef.current.delete(timerId);
        callback();
      }, delay);
    } else {
      timerId = window.setInterval(callback, delay);
    }
    timersRef.current.set(timerId, { id: timerId, type });
    return timerId;
  };

  /**
   * Cancels a specific timer by its id.
   */
  const cancelTimer = (id: number): void => {
    const entry = timersRef.current.get(id);
    if (!entry) return;
    if (entry.type === 'timeout') {
      window.clearTimeout(id);
    } else {
      window.clearInterval(id);
    }
    timersRef.current.delete(id);
  };

  /**
   * Cancels all pending timers.
   */
  const cancelAll = (): void => {
    timersRef.current.forEach((entry, id) => {
      if (entry.type === 'timeout') {
        window.clearTimeout(id);
      } else {
        window.clearInterval(id);
      }
    });
    timersRef.current.clear();
  };

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => cancelAll();
  }, []);

  return {
    start,
    cancelTimer,
    cancelAll,
    getActiveCount: () => timersRef.current.size,
  };
}

export default useGameTimer;
