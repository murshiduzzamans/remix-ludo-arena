/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGameTimer } from '../useGameTimer';

describe('useGameTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts a timeout and executes callback after delay', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useGameTimer());
    const id = result.current.start(callback, 1000);
    expect(callback).not.toHaveBeenCalled();
    expect(result.current.getActiveCount()).toBe(1);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(result.current.getActiveCount()).toBe(0);
  });

  it('starts an interval and executes callback repeatedly', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useGameTimer());
    result.current.start(callback, 100, 'interval');
    expect(result.current.getActiveCount()).toBe(1);

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(callback).toHaveBeenCalledTimes(2); // at 100ms and 200ms
  });

  it('cancels a specific timer', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useGameTimer());
    const id = result.current.start(callback, 1000);
    result.current.cancelTimer(id);
    expect(result.current.getActiveCount()).toBe(0);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(callback).not.toHaveBeenCalled();
  });

  it('cancels all timers on cancelAll', () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();
    const { result } = renderHook(() => useGameTimer());
    result.current.start(callback1, 500);
    result.current.start(callback2, 1000);
    expect(result.current.getActiveCount()).toBe(2);

    act(() => {
      result.current.cancelAll();
    });
    expect(result.current.getActiveCount()).toBe(0);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(callback1).not.toHaveBeenCalled();
    expect(callback2).not.toHaveBeenCalled();
  });

  it('cleans up all timers on unmount', () => {
    const callback = vi.fn();
    const { result, unmount } = renderHook(() => useGameTimer());
    result.current.start(callback, 1000);
    expect(result.current.getActiveCount()).toBe(1);

    unmount();
    expect(result.current.getActiveCount()).toBe(0);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(callback).not.toHaveBeenCalled();
  });

  it('prevents stale state callbacks by using latest callback', () => {
    const callback = vi.fn();
    const { result, rerender } = renderHook(
      ({ cb }) => {
        const { start } = useGameTimer();
        return { start, cb };
      },
      { initialProps: { cb: callback } }
    );
    result.current.start(() => result.current.cb(), 500);

    const callback2 = vi.fn();
    rerender({ cb: callback2 });

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(callback2).toHaveBeenCalledTimes(1);
    expect(callback).not.toHaveBeenCalled();
  });

  it('returns correct activeCount', () => {
    const { result } = renderHook(() => useGameTimer());
    expect(result.current.getActiveCount()).toBe(0);

    result.current.start(vi.fn(), 100);
    expect(result.current.getActiveCount()).toBe(1);

    result.current.start(vi.fn(), 200, 'interval');
    expect(result.current.getActiveCount()).toBe(2);
  });
});
