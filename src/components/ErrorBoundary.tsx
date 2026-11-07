/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Catches rendering errors in child components and shows a professional fallback UI.
 *
 * - Does not erase the player's existing profile (state outside this component is untouched).
 * - Logs useful debugging info in development via console.error.
 * - In production, only shows a generic "Something went wrong" message without exposing internals.
 * - Provides Retry and Return to Lobby buttons.
 *
 * Usage: wrap routes/screens, not every tiny component.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, errorInfo: null };
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: ErrorBoundaryState): ErrorBoundaryState {
    // If a fallback was provided and we're not in an error state, return null to let children render
    if (!state.hasError) return state;
    return state;
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log in development only; never expose stack traces to end users
    if (process.env.NODE_ENV === 'development') {
      console.error('[ErrorBoundary] Caught error:', error);
      console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
    }
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const isDev = process.env.NODE_ENV === 'development';
      const errorMessage = isDev ? this.state.error?.message ?? 'Unknown error' : undefined;
      const componentStack = isDev ? this.state.errorInfo?.componentStack : undefined;

      return (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900 text-slate-100"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="error-title"
        >
          <div className="max-w-md w-full rounded-2xl bg-[#090D16] border border-slate-700 shadow-2xl p-6">
            <div className="flex items-start gap-2 mb-3">
              <span className="text-2xl">⚠️</span>
              <h2 id="error-title" className="text-lg font-bold text-amber-400">
                Something went wrong
              </h2>
            </div>
            <p className="text-sm text-slate-300 mb-4">
              A rendering error occurred in Ludo Arena. Your profile and match progress are safe.
            </p>
            {errorMessage && (
              <div className="mb-4 p-2 rounded-lg bg-slate-800/50 border border-slate-700 text-xs font-mono text-red-300 overflow-hidden whitespace-pre-wrap">
                {errorMessage}
              </div>
            )}
            {componentStack && (
              <details className="mb-4 text-xs text-slate-500">
                <summary className="cursor-pointer hover:text-slate-300">Show details</summary>
                <pre className="mt-1 p-2 rounded bg-slate-950 text-red-300 overflow-x-auto">
                  {componentStack}
                </pre>
              </details>
            )}
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={this.handleRetry}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-bold text-xs uppercase tracking-wider cursor-pointer hover:from-amber-400 hover:to-amber-500 active:scale-95 transition-all"
                aria-label="Retry"
              >
                Retry
              </button>
              <button
                onClick={() => window.location.reload()}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-slate-300 font-bold text-xs uppercase tracking-wider cursor-pointer hover:bg-slate-700 active:scale-95 transition-all"
                aria-label="Return to Lobby"
              >
                Return to Lobby
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

interface PropsWithErrorBoundary {
  children: ReactNode;
}

/**
 * Simple wrapper without custom fallback — uses the default ErrorBoundary UI.
 */
export function withErrorBoundary({ children }: PropsWithErrorBoundary): ReactNode {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}
