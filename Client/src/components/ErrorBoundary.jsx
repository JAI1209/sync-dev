import { Component } from "react";
import * as Sentry from "@sentry/react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error, info);
    Sentry.captureException(error, { extra: info });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, textAlign: "center" }}>
          <h2>Something went wrong</h2>
          <p>{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()}>
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
