import { Component, type ErrorInfo, type ReactNode } from 'react';
import { HiOutlineExclamationTriangle } from 'react-icons/hi2';

interface Props {
  children: ReactNode;
  title: string;
  body: string;
  reloadLabel: string;
  homeLabel: string;
}

/** Catches render errors per route so one broken view never takes down the whole app. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ui] render error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto flex max-w-md flex-col items-center px-6 py-20 text-center">
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-danger-soft text-2xl text-danger">
          <HiOutlineExclamationTriangle aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold">{this.props.title}</h1>
        <p className="mt-1 text-sm text-ink-2">{this.props.body}</p>
        <div className="mt-5 flex gap-2">
          <button type="button" className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-fg" onClick={() => window.location.reload()}>
            {this.props.reloadLabel}
          </button>
          <a className="rounded-xl border border-border px-4 py-2 text-sm font-medium" href="/dashboard">
            {this.props.homeLabel}
          </a>
        </div>
      </div>
    );
  }
}
