import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            gap: 20,
            fontFamily:
              "'SF Mono', 'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
            background: "#080808",
            color: "#e4e0d8",
            padding: 40,
            textAlign: "center",
          }}
        >
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#b85c5c"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div style={{ fontSize: 18, fontFamily: "Georgia, serif", fontStyle: "italic", color: "#b85c5c" }}>
            Something went wrong
          </div>
          <div style={{ fontSize: 12, color: "#58544c", maxWidth: 400, lineHeight: 1.6 }}>
            {this.state.error?.message || "An unexpected error occurred"}
          </div>
          <button
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
            style={{
              marginTop: 8,
              padding: "8px 20px",
              border: "1px solid #282828",
              borderRadius: 6,
              background: "transparent",
              color: "#c4956a",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 13,
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
