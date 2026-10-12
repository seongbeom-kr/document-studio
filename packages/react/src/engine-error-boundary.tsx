import { Component, type ReactNode } from "react";
export class EngineErrorBoundary extends Component<
  { children: ReactNode; onError(error: Error): void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? (
      <p className="ds-loading">
        편집기를 열지 못했습니다. 다른 문서를 선택해 주세요.
      </p>
    ) : (
      this.props.children
    );
  }
}
