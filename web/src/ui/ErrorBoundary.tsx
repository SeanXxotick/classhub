import { Component, lazy, type ComponentType, type ReactNode } from 'react';

/*
 * Keeps a crash from blanking the whole app. Without this, an error while drawing a screen removes
 * everything, the top bar and Back included, and the user is left with an empty page.
 */

const RELOADED_AT = 'classhub.chunkReloadAt';

/**
 * Reloads the page once when a part of the app that loads later (the PDF viewer) cannot be fetched. Each
 * deploy renames those files, so an app left open from before a deploy asks for a file that no longer
 * exists; reloading picks up the current version. Returns false when it already reloaded in the last
 * 30 seconds, so a connection that keeps failing does not reload forever.
 */
function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOADED_AT) ?? 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(RELOADED_AT, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

/** React.lazy that reloads the page once when the file cannot be fetched, then gives up with an error. */
export function lazyWithReload<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load().catch((e) => {
      // While the page reloads, wait instead of showing the error for a moment.
      if (reloadOnce()) return new Promise<{ default: T }>(() => {});
      throw e;
    }),
  );
}

export class ErrorBoundary extends Component<{ fallback: (reset: () => void) => ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('Screen error:', String((error as Error)?.message ?? error));
  }

  render() {
    return this.state.failed ? this.props.fallback(() => this.setState({ failed: false })) : this.props.children;
  }
}

/** The whole-app fallback: a message with a way out, instead of an empty page. */
export function AppCrashed() {
  return (
    <div className="stack" style={{ maxWidth: 420, margin: '15vh auto 0', padding: 16, textAlign: 'center' }}>
      <h1 style={{ fontSize: 20, margin: 0 }}>Something went wrong</h1>
      <p className="muted" style={{ margin: 0 }}>
        ClassHub could not show this screen. Reloading usually fixes it, especially right after ClassHub is updated.
      </p>
      <button type="button" className="btn solid block" onClick={() => window.location.reload()}>
        Reload
      </button>
      <a className="btn outline block" href="/">
        Go to My classes
      </a>
    </div>
  );
}
