import React from 'react';
import { errorService } from './core__services__errorService.js';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
    this.lastRecoverySignature = null;
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    errorService.report(error, {
      scope: 'ui',
      route: this.props.route ?? null,
      componentStack: info?.componentStack ?? '',
    });

    const signature = [
      error?.name ?? 'Error',
      error?.message ?? String(error),
      this.props.route ?? '',
    ].join('|');

    // 只针对同一种页面渲染异常自动恢复一次；若再次失败，直接显示诊断页，
    // 避免 ErrorBoundary 返回 null 导致用户看到无法定位原因的纯黑屏。
    if (signature !== this.lastRecoverySignature) {
      this.lastRecoverySignature = signature;
      this.props.onReset?.();
      setTimeout(() => {
        this.setState({ hasError: false, error: null });
      }, 0);
    }
  }

  reset = () => {
    this.lastRecoverySignature = null;
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    const message = this.state.error instanceof Error
      ? this.state.error.message
      : String(this.state.error ?? '未知渲染错误');

    return (
      <main style={{
        boxSizing: 'border-box',
        minHeight: '100vh',
        padding: 24,
        background: '#0b0d12',
        color: '#fff',
        fontFamily: 'system-ui, sans-serif',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <section style={{
          width: 'min(680px, 100%)',
          border: '1px solid #343944',
          borderRadius: 16,
          padding: 24,
          background: '#151821',
          boxShadow: '0 18px 50px rgba(0,0,0,.28)',
        }}>
          <div style={{ fontSize: 12, letterSpacing: '.08em', color: '#8f9aaa', marginBottom: 8 }}>
            TVBOX REACT · RENDER ERROR
          </div>
          <h1 style={{ margin: '0 0 10px', fontSize: 22 }}>页面渲染失败</h1>
          <p style={{ margin: '0 0 16px', color: '#c9ced8', lineHeight: 1.6 }}>
            当前页面发生了运行时异常。已避免黑屏，并保留错误信息方便定位。
          </p>
          <pre style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            margin: 0,
            padding: 14,
            borderRadius: 10,
            background: '#0b0d12',
            color: '#ffb4ab',
            fontSize: 13,
            lineHeight: 1.5,
          }}>{message}</pre>
          <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={this.reset}
              style={{
                border: '1px solid #596273',
                borderRadius: 10,
                padding: '10px 14px',
                background: '#242a35',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              重试当前页面
            </button>
          </div>
        </section>
      </main>
    );
  }
}
