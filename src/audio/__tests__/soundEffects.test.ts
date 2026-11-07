import { afterEach, describe, expect, it, vi } from 'vitest';
import { sound } from '../soundEffects';

describe('haptic feedback', () => {
  afterEach(() => { sound.setHapticsEnabled(false); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('does not vibrate when disabled, including through gameplay sound effects', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    sound.setHapticsEnabled(false);
    sound.triggerHaptic(15);
    sound.playDiceRoll();
    sound.playMove();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('uses vibration when enabled and supported', () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal('navigator', { vibrate });
    sound.setHapticsEnabled(true);
    sound.triggerHaptic(15);
    expect(vibrate).toHaveBeenCalledWith(15);
  });
});
