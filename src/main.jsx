import React from 'react';
import { createRoot } from 'react-dom/client';
import './app.css';
import { AppRoot } from './App.jsx';

function renderBootError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : '';
  const root = document.getElementById('root') || document.body;
  if (!root) return;
  root.innerHTML = `
    <main style="box-sizing:border-box;min-height:100vh;padding:32px;background:#0b0d12;color:#fff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center">
      <section style="width:min(720px,100%);border:1px solid #343944;border-radius:16px;padding:24px;background:#151821">
        <h1 style="margin:0 0 12px;font-size:22px">应用启动失败</h1>
        <p style="margin:0 0 16px;color:#c9ced8;line-height:1.6">React 应用在启动阶段发生异常。请保留下面的信息用于定位，不需要清除应用数据。</p>
        <pre style="white-space:pre-wrap;word-break:break-word;margin:0;padding:16px;border-radius:10px;background:#0b0d12;color:#ffb4ab;font-size:13px;line-height:1.5">${escapeHtml(message)}${stack ? '\n\n' + escapeHtml(stack) : ''}</pre>
      </section>
    </main>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

window.addEventListener('error', (event) => {
  if (event.error) renderBootError(event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  renderBootError(event.reason);
});

let isMounted = false;

function boot() {
  if (isMounted) return;
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    if (document.readyState === 'loading') return;
    setTimeout(boot, 16);
    return;
  }
  isMounted = true;
  try {
    createRoot(rootElement).render(<AppRoot />);
  } catch (error) {
    renderBootError(error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
