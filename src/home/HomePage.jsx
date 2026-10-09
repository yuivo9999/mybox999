import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Film, Play, RefreshCw, Search, Sparkles } from 'lucide-react';
import { SmartImage } from '../shared__components__StateViews.jsx';
import { MovieCard } from '../shared__components__media__MovieCard.jsx';
import { MovieCarousel } from '../shared__components__media__MovieCarousel.jsx';
import { MovieSourcePill } from '../movies/MovieSourcePill.jsx';
import { createMovieFeature } from '../movies/movieServices.js';
import { moviesForCategory } from '../movies/movieCatalog.js';
import { usePageState, pageStateStore } from '../core__state__pageStateStore.js';

export function HomePage({movies=[],history=[],progress=[],channels=[],sources=[],selectedSourceId,movieCategories=[],movieActiveCategory,movieCategoryLoading,onLoadMovieCategory,onLoadMoreCategory,onSelectMovieSource,onTab,onMovie,onPlay,onLive,onSearch}){
 const page = usePageState();
 useEffect(() => {
   const saved = page.home?.scrollTop ?? 0;
   requestAnimationFrame(() => window.scrollTo(0, saved));
   const save = () => pageStateStore.patch('home', { scrollTop: window.scrollY });
   window.addEventListener('scroll', save, { passive: true });
   return () => window.removeEventListener('scroll', save);
 }, []);
 const feature = useMemo(() => createMovieFeature({ movies, history, progress }), [movies, history, progress]);
 const home=feature.getHome();
 const movieSources=sources.filter(source=>source.sourceType==='movie'&&source.enabled!==false);
 const selectedSource=sources.find(s=>s.sourceId===selectedSourceId) || movieSources[0] || null;

 // 首页以“电影”为第一位，排序保证电影始终排在最前面
 const PREFERRED_CATEGORIES = ['电影', '电视剧', '动漫', '综艺', '短剧', '全部'];
 const categoryItems = useMemo(() => {
   const rawCategories = movieCategories.filter(item => !item.sourceId || item.sourceId === selectedSourceId);
   const pool = [...rawCategories];
   if (!pool.some(c => c.name === '全部' || c.id === 'all')) {
     pool.push({ id: 'all', name: '全部', sourceId: selectedSourceId });
   }
   const result = [];
   const seen = new Set();
   for (const name of PREFERRED_CATEGORIES) {
     const match = pool.find(c => c.name === name);
     if (match) {
       result.push(match);
       seen.add(match.name);
     } else if (name !== '全部') {
       result.push({ id: name, name });
       seen.add(name);
     }
   }
   for (const c of pool) {
     if (!seen.has(c.name)) {
       result.push(c);
       seen.add(c.name);
     }
   }
   return result;
 }, [movieCategories, selectedSourceId]);

 const active = useMemo(() => {
   if (movieActiveCategory) {
     const found = categoryItems.find(c => c.name === movieActiveCategory.name || c.id === movieActiveCategory.id);
     if (found) return found;
   }
   return categoryItems.find(c => c.name === '电影') || categoryItems[0] || { id: 'movie', name: '电影' };
 }, [movieActiveCategory, categoryItems]);

 const [categoryPage, setCategoryPage] = useState(1);
 useEffect(() => {
   setCategoryPage(1);
 }, [active?.name, active?.id]);

 const isAllCategory = !active || active.id === 'all' || active.name === '全部';
 const currentMovies = isAllCategory ? movies : moviesForCategory(movies, active);

 const heroMovie = currentMovies[0] || movies[0] || null;

 // Sub-sections when "全部" is active (Ensures no content is omitted)
 const movieSectionList = useMemo(() => isAllCategory ? moviesForCategory(movies, { name: '电影' }) : [], [movies, isAllCategory]);
 const seriesSectionList = useMemo(() => isAllCategory ? moviesForCategory(movies, { name: '电视剧' }) : [], [movies, isAllCategory]);
 const animeSectionList = useMemo(() => isAllCategory ? moviesForCategory(movies, { name: '动漫' }) : [], [movies, isAllCategory]);
 const varietySectionList = useMemo(() => isAllCategory ? moviesForCategory(movies, { name: '综艺' }) : [], [movies, isAllCategory]);
 const shortDramaList = useMemo(() => isAllCategory ? moviesForCategory(movies, { name: '短剧' }) : [], [movies, isAllCategory]);

 if(!movieSources.length && !movies.length) return (
   <Page>
     <header className="top-header">
       <div>
         <span className="eyebrow">TVBOX 4K</span>
         <h2>首页</h2>
       </div>
       <button className="icon-button" aria-label="搜索" onClick={onSearch}><Search size={18}/></button>
     </header>
     <div className="empty state-view">
       <Film size={24}/>
       <b>暂无影视源</b>
       <span>请在源管理中配置或启用中国影视源</span>
       <button className="primary" onClick={()=>onTab('sources')}>去源管理</button>
     </div>
   </Page>
 );

 return <Page>
  {/* 精致顶部栏：左侧标题与来源，右侧快速切源胶囊与搜索 */}
  <header className="top-header" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
    <div>
      <span className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <Sparkles size={11} color="#f59e0b" /> TVBOX 4K 影音
      </span>
      <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: -0.5 }}>精选首页</h2>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <MovieSourcePill
        sources={movieSources}
        selectedSource={selectedSource}
        onChange={onSelectMovieSource}
      />
      <button className="icon-button" aria-label="搜索影视" onClick={onSearch} title="全源搜索">
        <Search size={18}/>
      </button>
    </div>
  </header>

  {/* 焦点精选 Hero Banner */}
  {heroMovie && (
    <section className="movie-home-hero" aria-label="本周焦点推荐">
      <SmartImage
        src={heroMovie.backdrop || heroMovie.poster}
        alt={heroMovie.title}
        className="movie-home-hero-bg"
        priority
      />
      <div className="movie-home-hero-gradient" aria-hidden="true" />
      <div className="movie-home-hero-content">
        <div className="movie-home-hero-tags">
          <span>● 今日焦点</span>
          <span>·</span>
          <span>{heroMovie.category || '4K超清'}</span>
          {heroMovie.year && <><span>·</span><span>{heroMovie.year}</span></>}
          {heroMovie.updateInfo && <><span>·</span><span>{heroMovie.updateInfo}</span></>}
        </div>
        <h3 className="movie-home-hero-title">{heroMovie.title}</h3>
        {heroMovie.description && <p className="movie-home-hero-desc">{heroMovie.description}</p>}
        <div className="movie-home-hero-actions">
          <button className="movie-home-hero-btn-play" type="button" onClick={() => onPlay(heroMovie, 0)}>
            <Play size={15} fill="currentColor" /> 立即播放
          </button>
          <button className="movie-home-hero-btn-detail" type="button" onClick={() => onMovie(heroMovie)}>
            查看详情
          </button>
        </div>
      </div>
    </section>
  )}

  {/* 继续观看 Row */}
  {home.continueWatching.length > 0 && (
    <>
      <SectionTitle title="继续观看" />
      <div className="continue-row">
        {home.continueWatching.map(({movie, episodeIndex, history: item}) => (
          <div className="continue" key={item.historyId} onClick={() => onPlay(movie, episodeIndex)}>
            <SmartImage src={movie.poster} fallback={<div className="image-placeholder"><Film size={18}/></div>}/>
            <div>
              <b>{movie.title}</b>
              <small>{movie.episodes?.[episodeIndex]?.title ?? '继续观看'} · {Math.floor((item.positionSeconds ?? 0) / 60)} 分钟</small>
            </div>
          </div>
        ))}
      </div>
    </>
  )}

  {/* 分类快捷筛选栏 */}
  <SectionTitle
    title="内容专区"
    action="影视库全览 >"
    onAction={() => {
      if (active && active.id !== 'all') pageStateStore.patch('movies', { category: active.name, page: 1 });
      onTab('movies');
    }}
  />
  <div className="category-chip-bar" role="tablist" aria-label="影视分类">
    {categoryItems.map((category, index) => {
      const isSelected = active?.id === category.id || (!active && category.id === 'all');
      return (
        <button
          key={`${category.sourceId || ''}:${category.id || ''}:${category.name || ''}:${index}`}
          className={'category-chip' + (isSelected ? ' active' : '')}
          disabled={movieCategoryLoading}
          role="tab"
          aria-selected={isSelected}
          onClick={() => onLoadMovieCategory?.(category)}
        >
          {category.name}
        </button>
      );
    })}
  </div>

  {/* 页面内容：分专区有效展示，绝不遗漏内容 */}
  {movieCategoryLoading ? (
    <div className="empty compact"><span>正在从影视源抓取“{active?.name || '分类内容'}”…</span></div>
  ) : isAllCategory ? (
    <>
      {/* 热门精选 6张优质卡片 */}
      <div className="section-title" style={{ marginTop: 8, marginBottom: 8 }}>
        <h3>🔥 热门精选</h3>
        <span style={{ fontSize: 12, color: '#8f9aaa' }}>{currentMovies.length} 部内容</span>
      </div>
      <div className="movie-grid">
        {currentMovies.slice(0, 6).map((movie, index) => (
          <MovieCard key={movie.contentId ? `${movie.contentId}_${index}` : `hero_${index}`} movie={movie} onClick={onMovie} priority />
        ))}
      </div>

      {/* 🎬 电影精选专区 (若有电影) */}
      {movieSectionList.length > 0 && (
        <>
          <SectionTitle
            title="🎬 院线与高清电影"
            action="查看全部电影 >"
            onAction={() => {
              pageStateStore.patch('movies', { category: '电影', page: 1 });
              onTab('movies');
            }}
          />
          <MovieCarousel movies={movieSectionList.slice(0, 10)} onMovie={onMovie} ariaLabel="电影精选" />
        </>
      )}

      {/* 📺 热门剧集专区 (若有剧集) */}
      {seriesSectionList.length > 0 && (
        <>
          <SectionTitle
            title="📺 同步热播剧集"
            action="查看全部剧集 >"
            onAction={() => {
              pageStateStore.patch('movies', { category: '电视剧', page: 1 });
              onTab('movies');
            }}
          />
          <MovieCarousel movies={seriesSectionList.slice(0, 10)} onMovie={onMovie} ariaLabel="热播剧集" />
        </>
      )}

      {/* 🎨 动漫天地 (若有动漫) */}
      {animeSectionList.length > 0 && (
        <>
          <SectionTitle
            title="🎨 热血与国创动漫"
            action="查看全部动漫 >"
            onAction={() => {
              pageStateStore.patch('movies', { category: '动漫', page: 1 });
              onTab('movies');
            }}
          />
          <MovieCarousel movies={animeSectionList.slice(0, 10)} onMovie={onMovie} ariaLabel="动漫精选" />
        </>
      )}

      {/* 🎤 综艺精选 (若有综艺) */}
      {varietySectionList.length > 0 && (
        <>
          <SectionTitle
            title="🎤 欢笑综艺娱乐"
            action="查看全部综艺 >"
            onAction={() => {
              pageStateStore.patch('movies', { category: '综艺', page: 1 });
              onTab('movies');
            }}
          />
          <MovieCarousel movies={varietySectionList.slice(0, 10)} onMovie={onMovie} ariaLabel="热播综艺" />
        </>
      )}

      {/* ⚡ 爽文短剧 (若有短剧) */}
      {shortDramaList.length > 0 && (
        <>
          <SectionTitle
            title="⚡ 爆款热门短剧"
            action="查看全部短剧 >"
            onAction={() => {
              pageStateStore.patch('movies', { category: '短剧', page: 1 });
              onTab('movies');
            }}
          />
          <MovieCarousel movies={shortDramaList.slice(0, 10)} onMovie={onMovie} ariaLabel="爆款短剧" />
        </>
      )}

      {/* 全部影片一览 (完整呈现剩余抓取内容，绝不遗漏) */}
      {currentMovies.length > 6 && (
        <>
          <SectionTitle title="✨ 更多内容推荐" />
          <div className="movie-grid">
            {currentMovies.slice(6).map((movie, index) => (
              <MovieCard key={movie.contentId ? `${movie.contentId}_more_${index}` : `more_${index}`} movie={movie} onClick={onMovie} />
            ))}
          </div>
        </>
      )}

      <div style={{ textAlign: 'center', margin: '12px 0 24px' }}>
        <button
          className="secondary"
          style={{ width: '100%', justifyContent: 'center', padding: '12px 16px' }}
          onClick={() => {
            pageStateStore.patch('movies', { category: '全部', page: 1 });
            onTab('movies');
          }}
        >
          进入影视库查看完整海报墙与分页 ({movies.length} 部)
        </button>
      </div>
      <div className="continuous-load-section">
        <button
          type="button"
          className="continuous-load-btn"
          disabled={movieCategoryLoading}
          onClick={() => onLoadMoreCategory?.({ name: '电影', id: 'movie' }, Math.floor(movies.length / 12) + 2)}
        >
          <RefreshCw size={16} className={movieCategoryLoading ? 'spin' : ''} />
          <span>{movieCategoryLoading ? '正在抓取新内容…' : '持续加载更多电影大片 (严格去重)'}</span>
        </button>
      </div>
    </>
  ) : currentMovies.length > 0 ? (() => {
      const categoryTotal = currentMovies.length;
      const displayMovies = currentMovies; // 首页“持续加载下一批”的功能是保留已经加载的内容，保留并显示全量内容

      return (
        <>
          <div className="section-title" style={{ marginTop: 8, marginBottom: 8 }}>
            <h3>{active?.name}</h3>
            <span style={{ fontSize: 12, color: '#8f9aaa' }}>
              {`已加载共 ${categoryTotal} 部影视内容`}
            </span>
          </div>

          <div className="movie-grid">
            {displayMovies.map((movie, index) => (
              <MovieCard key={movie.contentId ? `${movie.contentId}_cat_${index}` : `cat_${index}`} movie={movie} onClick={onMovie} />
            ))}
          </div>

          {/* 持续加载按钮：保留已经加载的内容，后续抓取添加进来新的，加载进来的都不能动 */}
          <div className="continuous-load-section" style={{ marginTop: 16 }}>
            <button
              type="button"
              className="continuous-load-btn"
              disabled={movieCategoryLoading}
              onClick={() => {
                onLoadMoreCategory?.(active, Math.floor(categoryTotal / 12) + 2);
              }}
            >
              <RefreshCw size={16} className={movieCategoryLoading ? 'spin' : ''} />
              <span>
                {movieCategoryLoading
                  ? '正在持续抓取新内容…'
                  : `持续加载“${active.name}”更多内容 (累计已载入 ${categoryTotal} 部)`}
              </span>
            </button>
            <p className="continuous-load-tip">
              点击持续加载同类别全新内容，严格去重，加载进来的内容均会保留在当前视图，不会发生位移或隐藏
            </p>
          </div>

          <div style={{ textAlign: 'center', margin: '4px 0 24px' }}>
            <button
              className="secondary"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => {
                pageStateStore.patch('movies', { category: active.name, page: 1 });
                onTab('movies');
              }}
            >
              在影视库中按年份与地区筛选“{active.name}”
            </button>
          </div>
        </>
      );
    })() : (
    <HomeEmpty compact text={`“${active?.name || '当前分类'}”暂无内容，正在连接影视源`} />
  )}

  {/* Live 快捷入口 */}
  <SectionTitle title="Live 直播电视" />
  <div className="live-banner" onClick={() => onTab('live')}>
    <span>
      <b>电视直播中心</b>
      <small>{channels.length} 个实时直播频道 · 央视卫视全覆盖</small>
    </span>
    <ChevronLeft className="flip" />
  </div>
  {channels[0] && (
    <button className="movie-live-entry" onClick={() => onLive(channels[0])}>
      <Play size={15} /> 快速打开 {channels[0].name}
    </button>
  )}
 </Page>;
}

const Page = ({ children }) => <main className="page">{children}</main>;
const SectionTitle = ({ title, action, onAction }) => <div className="section-title"><h3>{title}</h3>{action && <button onClick={onAction}>{action}</button>}</div>;
const HomeEmpty = ({ text, compact = false }) => <div className={compact ? 'empty compact' : 'empty'}><Film size={22} /><span>{text}</span></div>;
