import React from 'react';
import { ImageOff, LoaderCircle } from 'lucide-react';
export function LoadingState({ text = '正在加载…', compact = false }) {
  return <div className={compact ? 'empty compact state-view' : 'empty state-view'}><LoaderCircle className="spin" size={22} /><span>{text}</span></div>;
}
export function EmptyState({ text = '暂无数据', icon: Icon = ImageOff }) {
  return <div className="empty state-view"><Icon size={22} /><span>{text}</span></div>;
}
export function ErrorState({ text = '无法加载源', onClose }) {
  return (
    <div className="source-error-backdrop" role="dialog" aria-modal="true" aria-label={text}>
      <div className="source-error-popup">
        <span>{text}</span>
        <button className="source-error-close" type="button" onClick={onClose} aria-label="关闭窗口" title="关闭窗口">×</button>
      </div>
    </div>
  );
}
export function SmartImage({ src, alt = '', fallback = null, priority = false, ...props }) {
  const [state, setState] = React.useState(src ? 'loading' : 'error');
  React.useEffect(() => setState(src ? 'loading' : 'error'), [src]);
  if (state === 'error') return fallback ?? <div className="image-placeholder" aria-label={alt}><ImageOff size={20} /></div>;
  return (
    <img
      loading={priority ? 'eager' : 'lazy'}
      {...props}
      src={src}
      alt={alt}
      onLoad={() => setState('loaded')}
      onError={() => setState('error')}
    />
  );
}
