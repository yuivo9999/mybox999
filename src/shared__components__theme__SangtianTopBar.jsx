import React, { useState } from 'react';
import { Menu, MoreVertical, Check, Copy, Settings, RotateCcw, Search, ListVideo, ChevronLeft } from 'lucide-react';

export function SangtianTopBar({
  title,
  subTitle,
  onHamburger,
  onWorkspace,
  onSearchSameName,
  currentTheme = 'sangtian',
  onSelectTheme,
  onCopyLink,
  onReload,
  onOpenSettings,
  onBack,
}) {
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [copiedToast, setCopiedToast] = useState(false);

  const handleCopy = () => {
    if (onCopyLink) {
      onCopyLink();
      setCopiedToast(true);
      setTimeout(() => setCopiedToast(false), 2000);
      setShowMoreMenu(false);
    }
  };

  return (
    <header className="sangtian-topbar">
      {/* 1. 左侧：图标三条横线 */}
      <div className="sangtian-topbar-left">
        <button
          className="sangtian-icon-btn"
          aria-label="打开菜单"
          onClick={onHamburger}
          title="功能菜单"
          type="button"
        >
          <Menu size={20} />
        </button>
      </div>

      {/* 2. 中间：片名与集数 */}
      <div
        className="sangtian-topbar-center-title"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          margin: '0 12px',
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontSize: '16px',
            fontWeight: 700,
            color: '#fef3c7',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '100%',
            letterSpacing: '0.04em',
          }}
        >
          {title || '正在播放'}
        </span>
        {subTitle && (
          <span
            style={{
              fontSize: '11px',
              color: '#9a8c7d',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '100%',
              marginTop: '1px',
            }}
          >
            {subTitle}
          </span>
        )}
      </div>

      {/* 3. 右侧：三个竖的点 */}
      <div className="sangtian-topbar-right">
        <button
          className="sangtian-icon-btn"
          aria-label="更多操作"
          onClick={() => setShowMoreMenu(v => !v)}
          title="更多选项"
          type="button"
        >
          <MoreVertical size={20} />
        </button>

        {showMoreMenu && (
          <div className="sangtian-dropdown-menu">
            {onWorkspace && (
              <button
                className="dropdown-item"
                onClick={() => {
                  onWorkspace();
                  setShowMoreMenu(false);
                }}
                type="button"
              >
                <ListVideo size={15} />
                <span>选集与换源</span>
              </button>
            )}

            {onSearchSameName && (
              <button
                className="dropdown-item"
                onClick={() => {
                  onSearchSameName();
                  setShowMoreMenu(false);
                }}
                type="button"
              >
                <Search size={15} />
                <span>全网搜同名</span>
              </button>
            )}

            <div className="dropdown-divider" />

            <div className="dropdown-section-title">主题选择</div>
            <div className="theme-options">
              <button
                className={`theme-option ${currentTheme === 'sangtian' ? 'active' : ''}`}
                onClick={() => { onSelectTheme?.('sangtian'); setShowMoreMenu(false); }}
                type="button"
              >
                <span>✦ 桑田山河</span>
                {currentTheme === 'sangtian' && <Check size={14} />}
              </button>
              <button
                className={`theme-option ${currentTheme === 'dark' ? 'active' : ''}`}
                onClick={() => { onSelectTheme?.('dark'); setShowMoreMenu(false); }}
                type="button"
              >
                <span>🌑 极夜深色</span>
                {currentTheme === 'dark' && <Check size={14} />}
              </button>
              <button
                className={`theme-option ${currentTheme === 'light' ? 'active' : ''}`}
                onClick={() => { onSelectTheme?.('light'); setShowMoreMenu(false); }}
                type="button"
              >
                <span>☀️ 素白浅色</span>
                {currentTheme === 'light' && <Check size={14} />}
              </button>
            </div>

            <div className="dropdown-divider" />

            {onCopyLink && (
              <button className="dropdown-item" onClick={handleCopy} type="button">
                <Copy size={15} />
                <span>复制当前直链</span>
              </button>
            )}

            {onReload && (
              <button className="dropdown-item" onClick={() => { onReload(); setShowMoreMenu(false); }} type="button">
                <RotateCcw size={15} />
                <span>重新加载播放</span>
              </button>
            )}

            {onOpenSettings && (
              <button className="dropdown-item" onClick={() => { onOpenSettings(); setShowMoreMenu(false); }} type="button">
                <Settings size={15} />
                <span>偏好与设置</span>
              </button>
            )}

            {onBack && (
              <>
                <div className="dropdown-divider" />
                <button className="dropdown-item" onClick={() => { onBack(); setShowMoreMenu(false); }} type="button">
                  <ChevronLeft size={15} />
                  <span>返回上一页</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {copiedToast && (
        <div className="sangtian-toast">
          ✓ 播放链接已复制到剪贴板
        </div>
      )}
    </header>
  );
}
