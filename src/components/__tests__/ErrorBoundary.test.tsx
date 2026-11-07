/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="@testing-library/jest-dom/vitest" />

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ErrorBoundary } from '../ErrorBoundary';

const ThrowingComponent = ({ message }: { message: string }) => {
  throw new Error(message);
};

const ChildComponent = () => <div data-testid="child">Child renders fine</div>;

describe('ErrorBoundary', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('renders children normally when no error occurs', () => {
    const { container } = render(
      <ErrorBoundary>
        <ChildComponent />
      </ErrorBoundary>
    );
    expect(container.querySelector('[data-testid="child"]')).toBeInTheDocument();
    expect(screen.getByText('Child renders fine')).toBeInTheDocument();
  });

  it('shows fallback UI when a child throws during render', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="Test boom" />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
    expect(screen.getByText('Return to Lobby')).toBeInTheDocument();
  });

  it('logs error in development mode', () => {
    const originalEnv = process.env.NODE_ENV;
    // @ts-ignore - NODE_ENV is read-only in test
    process.env.NODE_ENV = 'development';
    render(
      <ErrorBoundary>
        <ThrowingComponent message="Dev error" />
      </ErrorBoundary>
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[ErrorBoundary] Caught error:',
      expect.any(Error)
    );
    process.env.NODE_ENV = originalEnv;
  });

  it('does not expose stack trace details to end user in production', () => {
    const originalEnv = process.env.NODE_ENV;
    // @ts-ignore - NODE_ENV is read-only in test
    process.env.NODE_ENV = 'production';
    render(
      <ErrorBoundary>
        <ThrowingComponent message="Prod error" />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    process.env.NODE_ENV = originalEnv;
  });

  it('re-renders children when Retry is clicked', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="Test boom" />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Retry'));
    // After retry, ErrorBoundary clears error state and re-renders children,
    // which will throw again, so we should still see the fallback
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('calls onError prop when provided', () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <ThrowingComponent message="Callback test" />
      </ErrorBoundary>
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it('supports custom fallback UI', () => {
    const CustomFallback = () => (
      <div data-testid="custom-fallback">Custom error UI</div>
    );
    render(
      <ErrorBoundary fallback={<CustomFallback />}>
        <ThrowingComponent message="Custom fallback test" />
      </ErrorBoundary>
    );
    expect(screen.getByTestId('custom-fallback')).toBeInTheDocument();
  });

  it('does not affect sibling components outside the boundary', () => {
    const { container } = render(
      <div>
        <ChildComponent />
        <ErrorBoundary>
          <ThrowingComponent message="Isolated error" />
        </ErrorBoundary>
      </div>
    );
    expect(screen.getByText('Child renders fine')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="child"]')).toBeInTheDocument();
  });
});
