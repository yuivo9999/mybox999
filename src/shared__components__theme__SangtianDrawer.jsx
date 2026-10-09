import React from 'react';
import { X, Home, Film, Radio, Heart, Clock3, Server, Settings, Palette } from 'lucide-react';

export function SangtianDrawer({
  isOpen,
  onClose,
  onNav,
  currentTheme = 'sangtian',
  onSelectTheme,
}) {
  if (!isOpen) return null;

  return (
    <div className="sangtian-drawer-backdrop" onClick={onClose}>
      <aside className="sangtian-drawer" onClick={e => e.stopPropagation()}>
        <div className="drawer-header">
          <div className="drawer-brand">
            <span className="drawer-badge">桑田山河</span>
            <h3>TVBox React</h3>
          </div>
          <button className="drawer-close-btn" onClick={onClose}>
            <X size={19} />
          </button>
        </div>

        <div className="drawer-nav">
          <button className="drawer-nav-item" onClick={() => { onNav('home'); onClose(); }}>
            <Home size={18} />
            <span>影视首页</span>
          </button>
          <button className="drawer-nav-item" onClick={() => { onNav('movies'); onClose(); }}>
            <Film size={18} />
            <span>影视库与分类</span>
          </button>
          <button className="drawer-nav-item" onClick={() => { onNav('live'); onClose(); }}>
            <Radio size={18} />
            <span>Live 直播中心</span>
          </button>
          <button className="drawer-nav-item" onClick={() => { onNav('favorites'); onClose(); }}>
            <Heart size={18} />
            <span>我的收藏</span>
          </button>
          <button className="drawer-nav-item" onClick={() => { onNav('history'); onClose(); }}>
            <Clock3 size={18} />
            <span>播放历史</span>
          </button>
          <button className="drawer-nav-item" onClick={() => { onNav('sources'); onClose(); }}>
            <Server size={18} />
            <span>内容源配置</span>
          </button>
          <button className="drawer-nav-item" onClick={() => { onNav('settings'); onClose(); }}>
            <Settings size={18} />
            <span>系统设置</span>
          </button>
        </div>

        <div className="drawer-footer">
          <div className="drawer-section-title">
            <Palette size={14} />
            <span>切换界面主题</span>
          </div>
          <div className="drawer-theme-buttons">
            <button
              className={`drawer-theme-pill ${currentTheme === 'sangtian' ? 'active' : ''}`}
              onClick={() => onSelectTheme?.('sangtian')}
            >
              桑田山河
            </button>
            <button
              className={`drawer-theme-pill ${currentTheme === 'dark' ? 'active' : ''}`}
              onClick={() => onSelectTheme?.('dark')}
            >
              极夜深色
            </button>
            <button
              className={`drawer-theme-pill ${currentTheme === 'light' ? 'active' : ''}`}
              onClick={() => onSelectTheme?.('light')}
            >
              素白浅色
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
