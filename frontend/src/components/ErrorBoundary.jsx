import { Component } from "react";

// Without this, any error while drawing the screen unmounts the whole app and leaves only the dotted background.
// Instead show what happened and a way back in.
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Screen crashed:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="auth">
        <div className="card" role="alert" style={{ maxWidth: 420, width: "100%" }}>
          <h2 style={{ margin: "0 0 6px" }}>Something went wrong</h2>
          <p className="muted" style={{ margin: "0 0 12px" }}>Your journal is safe. Reload to carry on.</p>
          <p className="muted" style={{ margin: "0 0 14px", fontSize: 12, overflowWrap: "anywhere" }}>{String(this.state.error?.message || this.state.error)}</p>
          <div className="actions">
            <button type="button" className="btn primary" onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      </div>
    );
  }
}
