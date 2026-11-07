/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Download, Share2, X } from 'lucide-react';
import React, { useState } from 'react';
import { usePWAInstall } from './usePWAInstall';

export const PWAInstallBanner: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (isInstalled || dismissed) {
    return null;
  }

  return (
    <>
      {isInstallable && (
        <button
          onClick={install}
          className="min-h-[44px] flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-colors whitespace-nowrap cursor-pointer touch-manipulation active:scale-95"
          title="Install Ludo Arena as an app"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Install App</span>
        </button>
      )}

      {isIOS && !isInstallable && (
        <>
          <button
            onClick={() => setShowIOSGuide(true)}
            className="min-h-[44px] flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-colors whitespace-nowrap cursor-pointer touch-manipulation active:scale-95"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Install on iOS</span>
          </button>

          {showIOSGuide && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
              <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-amber-500/30 p-6 shadow-2xl">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <h3 className="text-base font-bold text-slate-100">
                    Install Ludo Arena on iOS
                  </h3>
                  <button
                    onClick={() => setShowIOSGuide(false)}
                    className="p-1 text-slate-400 hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="mt-4 space-y-3 text-xs text-slate-300 leading-relaxed">
                  <p>
                    1. Tap the <strong className="text-amber-400">Share</strong> icon in the Safari navigation bar.
                  </p>
                  <p>
                    2. Scroll down and choose <strong className="text-amber-400">Add to Home Screen</strong>.
                  </p>
                  <p>
                    3. Launch from your home screen for full-screen standalone gameplay.
                  </p>
                </div>
                <button
                  onClick={() => setShowIOSGuide(false)}
                  className="mt-6 w-full py-2.5 rounded-xl bg-amber-500 font-bold text-slate-950 text-xs hover:bg-amber-400 transition"
                >
                  Got It
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  React.useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div className="fixed bottom-3 left-3 z-50 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/90 text-slate-950 font-bold text-xs shadow-lg backdrop-blur">
      <span className="w-2 h-2 rounded-full bg-slate-950 animate-pulse" />
      <span>Offline Mode — Pure Local Engine Active</span>
    </div>
  );
};
