import React from 'react';
import { SangtianPlayerWindowCore } from '../shared__components__theme__SangtianPlayerConsole.jsx';

// Live feature player block
/**
 * Live 专属播放器功能区块。
 * 这里是 LiveFeature 对播放器内核的唯一业务入口。
 * “沉浸播放”仍由同一个 core 实例通过 isImmersive 切换展示状态，不创建第二个播放器。
 */
export function LivePlayerBlock({
  isImmersive = false,
  children,
  ...props
}) {
  return (
    <section
      className={'player-feature-block player-feature-block-live' + (isImmersive ? ' player-feature-block-live-immersive' : '')}
      data-player-block="live"
      data-player-mode={isImmersive ? 'immersive' : 'embedded'}
    >
      <SangtianPlayerWindowCore
        {...props}
        isLive
        isImmersive={isImmersive}
        playerScope="live"
      >
        {children}
      </SangtianPlayerWindowCore>
    </section>
  );
}

// VOD playback page player block
/**
 * PlaybackPage/VOD 专属播放器功能区块。
 * 与 Live 播放器使用不同的业务入口、DOM 命名空间和 scope。
 */
export function PlaybackPagePlayerBlock({
  children,
  ...props
}) {
  return (
    <section
      className="player-feature-block player-feature-block-playback"
      data-player-block="playback-page"
    >
      <SangtianPlayerWindowCore
        {...props}
        playerScope="playback-page"
      >
        {children}
      </SangtianPlayerWindowCore>
    </section>
  );
}

// TV1 live player block
/**
 * TV1 专属播放器功能区块。
 * 实际播放生命周期统一交给 playbackController；这里仅保留 TV1 的
 * DOM/scope 隔离，避免 Live 与 TV1 的业务状态互相污染。
 * “沉浸播放”也只切换当前播放器的展示层，不重建播放连接。
 */
export function Tv1LivePlayerBlock({
  children,
  ...props
}) {
  return (
    <section
      className="player-feature-block player-feature-block-tv1-live"
      data-player-block="tv1-live"
    >
      <SangtianPlayerWindowCore
        {...props}
        isLive
        playerScope="tv1-live"
      >
        {children}
      </SangtianPlayerWindowCore>
    </section>
  );
}
