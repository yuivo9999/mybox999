import React, { useEffect, useState } from 'react';
import { Search, X, ChevronRight, Film } from 'lucide-react';
import { searchMovieSources } from './movieServices.js';
import { SmartImage } from '../shared__components__StateViews.jsx';

export function MovieSearchList({ movies = [], onMovie }) {
  return (
    <div className="movie-search-list">
      {movies.map((movie, index) => (
        <button
          className="movie-search-list-item"
          key={`${movie.contentId || movie.episodeId || movie.sourceId || 'movie'}_${index}`}
          type="button"
          onClick={() => onMovie?.(movie)}
        >
          <span className="movie-search-list-poster">
            <SmartImage src={movie.poster} alt="" fallback={<div className="image-placeholder"><Film size={18} /></div>} />
          </span>
          <span className="movie-search-list-copy">
            <b>{movie.title || '未命名'}</b>
            <small>{movie.year || '—'} · {movie.category || '—'}{movie.episodeCount ? ` · ${movie.episodeCount}集` : ''}</small>
          </span>
          <ChevronRight size={17} />
        </button>
      ))}
    </div>
  );
}

export function OtherSourceSearchDialog({ title, currentSourceId, sources = [], onClose, onMovie, onPlay }) {
  const [state, setState] = useState({ results: [], failed: [], loading: true, completed: 0, total: 0, error: '' });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const otherSources = sources.filter(source => source?.sourceType === 'movie' && source?.enabled !== false);
    setState({ results: [], failed: [], loading: true, completed: 0, total: otherSources.length, error: '' });
    if (!otherSources.length) {
      setState({ results: [], failed: [], loading: false, completed: 0, total: 0, error: '暂无其他已启用影视源可搜索' });
      return () => {
        active = false;
        controller.abort();
      };
    }
    searchMovieSources(otherSources, title, {
      signal: controller.signal,
      pageSize: 12,
      timeoutMs: 4500,
      onSourceResult: (entry, meta) => {
        if (!active) return;
        setState(current => ({
          ...current,
          results: entry.status === 'fulfilled' ? [...current.results, entry] : current.results,
          failed: entry.status === 'rejected' ? [...current.failed, entry] : current.failed,
          completed: meta?.completed ?? current.completed,
        }));
      },
    }).then(result => {
      if (!active) return;
      setState(current => ({
        ...current,
        loading: false,
        results: result.results ?? current.results,
        failed: result.failed ?? current.failed,
        completed: result.completed ?? current.completed,
      }));
    }).catch(err => {
      if (!active || err?.name === 'AbortError') return;
      setState(current => ({ ...current, loading: false, error: err?.message || '搜索失败' }));
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [title, currentSourceId, sources]);

  const total = state.results.reduce((sum, item) => sum + (item.items?.length ?? 0), 0);
  return (
    <div className="android-search-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="android-search-dialog" role="dialog" aria-modal="true" aria-label="全网搜同名">
        <div className="android-search-header">
          <div><b>全网搜同名</b><small>《{title}》 · 逐个影视源搜索</small></div>
          <button className="icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="android-search-status">
          <Search size={15} />
          <span>{state.loading ? `正在逐源搜索 · ${state.completed}/${state.total}` : `搜索完成 · ${total} 条结果`}</span>
          {state.loading && <span className="android-search-live-dot" aria-label="流式显示中">流式</span>}
        </div>
        <div className="android-search-results">
          {state.results.filter(group => (group.items?.length ?? 0) > 0).map((group, idx) => (
            <section className="android-search-source-group" key={`${group.sourceId || 'src'}_${idx}`}>
              <div className="android-search-source-title"><b>{group.sourceName}</b><span>{group.items.length} 条</span></div>
              <MovieSearchList movies={group.items} onMovie={item => {
                if (onPlay) onPlay(item, 0, item?.sourceId, 'detail');
                else onMovie?.(item);
                onClose?.();
              }} />
            </section>
          ))}
          {state.loading && state.results.length === 0 && (
            <div className="android-search-empty"><Search size={20} /><span>正在搜索第一个影视源，结果会逐个出现…</span></div>
          )}
          {!state.loading && state.error && (
            <div className="android-search-empty"><span>{state.error}</span></div>
          )}
          {!state.loading && !state.error && !total && (
            <div className="android-search-empty"><span>没有找到《{title}》的其他来源</span></div>
          )}
          {state.failed.length > 0 && (
            <div className="android-search-failed">另有 {state.failed.length} 个源未返回结果，已自动跳过。</div>
          )}
        </div>
        <div className="android-search-footer">
          <span>{state.loading ? '不会并行请求全部源，不会阻塞当前页面。' : '点击任一结果可直接进入该来源播放。'}</span>
          <button className="secondary" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
