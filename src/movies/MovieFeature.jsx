import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, Film, Heart, Play, Search, Server, Sparkles, X, Tv, RefreshCw } from 'lucide-react';
import { createMovieFeature } from './movieServices.js';
import { movieService } from './movieServices.js';
import { moviesForCategory } from './movieCatalog.js';
import { searchMovieSources } from './movieServices.js';
import { getCategoryIdByLabel } from './movieCatalog.js';
import { usePageState, pageStateStore } from '../core__state__pageStateStore.js';
import { SmartImage, EmptyState } from '../shared__components__StateViews.jsx';
import { MovieCarousel } from '../shared__components__media__MovieCarousel.jsx';
import { MovieCard } from '../shared__components__media__MovieCard.jsx';
import { MovieSourcePill } from './MovieSourcePill.jsx';
import { HomePage } from '../home/HomePage.jsx';
import { MoviePlaybackPage } from './MoviePlaybackPage.jsx';
import { OtherSourceSearchDialog, MovieSearchList } from './OtherSourceSearchDialog.jsx';

export function MovieFeature(props){
 const { route,tab,selected,movies=[],channels=[],history,progress,selectedSources={},sources=[],favorites,onMovie,onPlay,onTab,onBack,onLive,recordSearch,toggleFavorite,onSelectMovieSource,movieCategories=[],movieActiveCategory=null,movieCategoryLoading=false,onLoadMovieCategory,onLoadMoreCategory,onFilterSearch }=props;
 const page=usePageState(); const movieState=page.movies;
 useEffect(()=>{
  const pageKey=route==='search'?'search':tab==='movies'?'movies':'home';
  const saved=page[pageKey]?.scrollTop??0;
  requestAnimationFrame(()=>window.scrollTo(0,saved));
  const save=()=>pageStateStore.patch(pageKey,{scrollTop:window.scrollY});
  window.addEventListener('scroll',save,{passive:true});
  return()=>window.removeEventListener('scroll',save);
 },[route,tab]);
 const feature=useMemo(()=>createMovieFeature({movies,history,progress}),[movies,history]);
 if(route==='search') return <MovieSearch movies={movies} sources={sources} initial={page.search.query} recordSearch={recordSearch} onMovie={onMovie} onPlay={onPlay} onBack={onBack} onQuery={query=>pageStateStore.patch('search',{query})}/>;
 if(route==='detail'){const movie=(selected?.metadata?.movie) || feature.getDetail(selected?.contentId??selected) || (selected?.contentId ? selected : (typeof selected === 'object' && selected?.title ? selected : null));if(!movie)return <MovieEmpty text="影视内容不存在" onBack={onBack}/>;return <MovieDetail movie={movie} movies={movies} sources={sources} selectedSourceId={selectedSources?.movie} onMovie={onMovie} favorite={favorites.some(i=>i.targetType==='content'&&i.targetId===movie.contentId)} progress={progress} history={history} onBack={onBack} onPlay={onPlay} onFavorite={()=>toggleFavorite('content',movie.contentId)}/>;}
 if(route==='movie-play') return <MoviePlaybackPage request={selected} movies={movies} sources={sources} favorites={favorites} toggleFavorite={toggleFavorite} onBack={onBack} onEpisode={onPlay} onMovie={onMovie} onTab={onTab}/>;
 if(tab==='movies') return <MovieCatalog movies={movies} sources={sources} selectedSourceId={selectedSources?.movie} onSelectMovieSource={onSelectMovieSource} state={movieState} setState={patch=>pageStateStore.patch('movies',patch)} movieCategories={movieCategories} movieActiveCategory={movieActiveCategory} movieCategoryLoading={movieCategoryLoading} onLoadMovieCategory={onLoadMovieCategory} onLoadMoreCategory={onLoadMoreCategory} onMovie={onMovie} onPlay={onPlay} onSearch={(query)=>onFilterSearch?onFilterSearch(query):onMovie(null,'search')} recordSearch={recordSearch}/>;
 return <HomePage movies={movies} history={history} progress={progress} channels={channels} sources={sources} selectedSourceId={selectedSources?.movie} movieCategories={movieCategories} movieActiveCategory={movieActiveCategory} movieCategoryLoading={movieCategoryLoading} onLoadMovieCategory={onLoadMovieCategory} onLoadMoreCategory={onLoadMoreCategory} onSelectMovieSource={onSelectMovieSource} onTab={onTab} onMovie={onMovie} onPlay={onPlay} onLive={onLive} onSearch={()=>onMovie(null,'search')}/>;
}


function MovieCatalog({movies=[],sources=[],selectedSourceId,onSelectMovieSource,state,setState,onMovie,onPlay,onSearch,recordSearch,movieCategories=[],movieActiveCategory,movieCategoryLoading,onLoadMovieCategory,onLoadMoreCategory}){
 const home=useMemo(()=>movieService.getHome({movies}),[movies]);
 const movieSources=sources.filter(source=>source.sourceType==='movie'&&source.enabled!==false);
 const selectedSource=sources.find(s=>s.sourceId===selectedSourceId) || movieSources[0] || null;

 const PREFERRED_CAT_ORDER = ['电影', '电视剧', '动漫', '综艺', '短剧', '全部'];
 const rawCategories = movieCategories.filter(item=>!item.sourceId||item.sourceId===selectedSourceId);
 const categoriesPool = rawCategories.some(c=>c.name==='全部'||c.id==='all')
   ? rawCategories
   : [{ id:'all', name:'全部', sourceId:selectedSourceId }, ...rawCategories];

 const categories = useMemo(() => {
   const list = [];
   const seen = new Set();
   for (const name of PREFERRED_CAT_ORDER) {
     const match = categoriesPool.find(c => c.name === name);
     if (match) { list.push(match); seen.add(match.name); }
     else if (name !== '全部') { list.push({ id: name, name }); seen.add(name); }
   }
   for (const c of categoriesPool) {
     if (!seen.has(c.name)) { list.push(c); seen.add(c.name); }
   }
   return list;
 }, [categoriesPool]);

 const [queryInput,setQueryInput]=useState('');

 const [draftFilters, setDraftFilters] = useState({
   startYear: state.filters?.startYear || '',
   endYear: state.filters?.endYear || '',
   regions: state.filters?.regions || '',
   types: state.filters?.types || '',
 });
 const [appliedFilters, setAppliedFilters] = useState({
   startYear: state.filters?.startYear || '',
   endYear: state.filters?.endYear || '',
   regions: state.filters?.regions || '',
   types: state.filters?.types || '',
 });

 const handleConfirmFilter = () => {
  const filters = draftFilters;
  const parts = [];
  if (filters.startYear && filters.endYear) {
    if (filters.startYear === filters.endYear) parts.push(filters.startYear);
    else parts.push(`${filters.startYear}-${filters.endYear}`);
  } else if (filters.startYear) {
    parts.push(filters.startYear);
  } else if (filters.endYear) {
    parts.push(filters.endYear);
  }

  if (filters.regions && filters.regions !== '全部' && String(filters.regions).trim()) {
    parts.push(filters.regions);
  }
  if (filters.types && filters.types !== '全部' && String(filters.types).trim()) {
    parts.push(filters.types);
  }

  const keyword = parts.join(' ').trim();
  if (keyword) {
    pageStateStore.patch('search', { query: keyword });
    recordSearch?.(keyword);
    onSearch?.(keyword);
  } else {
    setAppliedFilters({ ...draftFilters });
    setState({
      page: 1,
      filters: { ...draftFilters },
    });
  }
 };

 const submitSearch=()=>{
  const keyword=String(queryInput||'').trim();
  if(!keyword)return;
  pageStateStore.patch('search',{query:keyword});
  recordSearch?.(keyword);
  onSearch?.(keyword);
 };

 const activeCategory = movieActiveCategory || categories.find(c => c.name === (state.category || '电影')) || categories[0] || { id: 'movie', name: '电影' };
 const isAll = !activeCategory || activeCategory.id === 'all' || activeCategory.name === '全部';

 const filteredMovies = useMemo(() => {
   let list = isAll ? movies : moviesForCategory(movies, activeCategory);
   const filters = appliedFilters || {};
   
   // 1. Year range (区间年份)
   if (filters.startYear || filters.endYear) {
     const start = Number(filters.startYear) || -Infinity;
     const end = Number(filters.endYear) || Infinity;
     list = list.filter(m => {
       const y = Number(m.year);
       if (!Number.isFinite(y)) return true;
       return y >= start && y <= end;
     });
   }

   // 2. Region (全部地区 - 默认几个和用户自定义填写一个或多个)
   if (filters.regions && String(filters.regions).trim()) {
     const regionQueries = String(filters.regions).split(/[,，\s]+/).map(r => r.trim()).filter(Boolean);
     if (regionQueries.length > 0 && !regionQueries.includes('全部')) {
       list = list.filter(m => {
         const rText = String(m.region || '');
         return regionQueries.some(q => rText.includes(q));
       });
     }
   }

   // 3. Movie Type (全部影片类型 - 默认几个和用户自定义填写一个或多个)
   if (filters.types && String(filters.types).trim()) {
     const typeQueries = String(filters.types).split(/[,，\s]+/).map(t => t.trim()).filter(Boolean);
     if (typeQueries.length > 0 && !typeQueries.includes('全部')) {
       list = list.filter(m => {
         const tText = String(m.type || m.category || '');
         return typeQueries.some(q => tText.includes(q));
       });
     }
   }

   if (state.sort === 'latest') {
     list = [...list].sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0));
   } else if (state.sort === 'popular') {
     list = [...list].sort((a,b) => (b.popularity || 0) - (a.popularity || 0));
   } else if (state.sort === 'title') {
     list = [...list].sort((a,b) => (a.title || '').localeCompare(b.title || '', 'zh'));
   }
   return list;
 }, [movies, isAll, activeCategory, appliedFilters, state.sort]);

 const pageSize = Math.max(1, state.pageSize || 40);
 const currentPage = Math.max(1, state.page || 1);
 const totalPages = Math.max(1, Math.ceil(filteredMovies.length / pageSize));
 const pagedMovies = filteredMovies; // 持续加载下一批的功能是保留已经加载的内容，保留全量内容，不分截断或隐藏先前载入的内容

 const filters=home.filters??{};
 const values=(key)=>['全部',...(filters[key]??[])];

 const handleCategoryChange = (item) => {
   setState({ category: item.name, page: 1, filters: { ...state.filters, categoryId: '' } });
   onLoadMovieCategory?.(item);
   if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
 };

 const handlePageChange = (newPage) => {
   setState({ page: newPage });
   if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
 };

 return <Page>
  <header className="top-header" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
    <div>
      <span className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <Film size={11} color="#f59e0b" /> TVBOX 4K 影音
      </span>
      <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>影视库</h2>
    </div>
    <MovieSourcePill
      sources={movieSources}
      selectedSource={selectedSource}
      onChange={onSelectMovieSource}
    />
  </header>

  <div className="searchbox">
    <Search size={18}/>
    <input value={queryInput} onChange={e=>setQueryInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')submitSearch()}} placeholder="搜索电影、电视剧、动漫、演员…"/>
    <button className="secondary search-submit" type="button" onClick={submitSearch}>搜索</button>
    {queryInput&&<button className="icon-button" aria-label="清空搜索" type="button" onClick={()=>setQueryInput('')}><X size={16}/></button>}
  </div>

  {categories.length > 0 && (
    <div className="category-chip-bar" role="tablist" aria-label="影视分类">
      {categories.map((item, index) => {
        const selected = (activeCategory?.id === item.id) || (state.category === item.name);
        return (
          <button
            key={`${item.sourceId || ''}:${item.id || ''}:${item.name || ''}:${index}`}
            className={'category-chip' + (selected ? ' active' : '')}
            disabled={movieCategoryLoading}
            role="tab"
            aria-selected={selected}
            onClick={() => handleCategoryChange(item)}
          >
            {item.name}
          </button>
        );
      })}
    </div>
  )}

  {movieCategoryLoading && <div className="empty compact"><span>正在从影视源加载“{activeCategory?.name||state.category||'当前分类'}”…</span></div>}

  <div className="catalog-filter-bar" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
    <select className="catalog-filter-select" value={state.sort || 'default'} onChange={e => { setState({ sort: e.target.value, page: 1 }); }}>
      {[['default','默认排序'],['latest','最新更新'],['popular','热门排行'],['title','片名排序']].map(([v,l])=><option value={v} key={v}>{l}</option>)}
    </select>

    {/* 全部年份区间 */}
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#151923', border: '1px solid #242a39', borderRadius: '8px', padding: '4px 8px', fontSize: '12px', color: '#c9d2e1' }}>
      <span>年份:</span>
      <input
        type="text"
        placeholder="开始"
        value={draftFilters.startYear}
        onChange={e => setDraftFilters({ ...draftFilters, startYear: e.target.value })}
        style={{ width: '55px', background: 'transparent', border: 'none', color: '#fff', fontSize: '12px', outline: 'none' }}
      />
      <span>~</span>
      <input
        type="text"
        placeholder="结束"
        value={draftFilters.endYear}
        onChange={e => setDraftFilters({ ...draftFilters, endYear: e.target.value })}
        style={{ width: '55px', background: 'transparent', border: 'none', color: '#fff', fontSize: '12px', outline: 'none' }}
      />
    </div>

    {/* 全部地区 */}
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#151923', border: '1px solid #242a39', borderRadius: '8px', padding: '4px 8px', fontSize: '12px', color: '#c9d2e1' }}>
      <span>地区:</span>
      <input
        type="text"
        placeholder="全部地区/自定"
        value={draftFilters.regions}
        onChange={e => setDraftFilters({ ...draftFilters, regions: e.target.value })}
        style={{ width: '95px', background: 'transparent', border: 'none', color: '#fff', fontSize: '12px', outline: 'none' }}
      />
    </div>

    {/* 全部影片类型 */}
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#151923', border: '1px solid #242a39', borderRadius: '8px', padding: '4px 8px', fontSize: '12px', color: '#c9d2e1' }}>
      <span>类型:</span>
      <input
        type="text"
        placeholder="全部类型/自定"
        value={draftFilters.types}
        onChange={e => setDraftFilters({ ...draftFilters, types: e.target.value })}
        style={{ width: '95px', background: 'transparent', border: 'none', color: '#fff', fontSize: '12px', outline: 'none' }}
      />
    </div>

    {/* 确认筛选按钮 */}
    <button
      type="button"
      style={{ padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', background: '#f59e0b', color: '#111', border: 'none' }}
      onClick={handleConfirmFilter}
    >
      确认筛选
    </button>
  </div>

  {/* 海报墙网格 - 一目了然展示所有抓取内容与角标 */}
  {pagedMovies.length > 0 ? (
    <>
   <div className="movie-grid">
     {pagedMovies.map((movie, index) => (
       <MovieCard key={movie.contentId ? `${movie.contentId}_paged_${index}` : `paged_${index}`} movie={movie} onClick={onMovie} />
     ))}
   </div>

   <div className="continuous-load-section" style={{ marginTop: 24 }}>
     <button
       type="button"
       className="continuous-load-btn secondary"
       disabled={movieCategoryLoading}
       onClick={() => {
         onLoadMoreCategory?.(activeCategory, Math.floor(filteredMovies.length / 12) + 2);
       }}
     >
       <RefreshCw size={16} className={movieCategoryLoading ? 'spin' : ''} />
       <span>
         {movieCategoryLoading
           ? '正在抓取新内容…'
           : `持续加载下一批“${activeCategory.name}” (源源不断精彩好片)`}
       </span>
     </button>
     <p className="continuous-load-tip">
       可一直点击持续加载，源源不断获取同一类别全新不重复内容 (当前已累计 {filteredMovies.length} 部)
     </p>
   </div>
    </>
  ) : (
    <EmptyState text={movies.length ? '当前分类或筛选条件下暂无内容' : '暂无影视内容，请检查源连接'} />
  )}
 </Page>;
}

function MovieSearch({movies,initial,recordSearch,onMovie,onPlay,onBack,onQuery,sources=[]}){
 const [query,setQuery]=useState(initial||'');
 const [submitted,setSubmitted]=useState(String(initial||'').trim());
 const submitSearch=()=>{
  const keyword=String(query||'').trim();
  if(!keyword)return;
  setSubmitted(keyword);
  onQuery?.(keyword);
  recordSearch?.(keyword);
 };
 return <Page><button className="back" onClick={onBack}><ChevronLeft/>返回</button><Header title="搜索结果"/><div className="searchbox"><Search size={18}/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')submitSearch()}} placeholder="搜索全部影视源"/><button className="secondary search-submit" type="button" onClick={submitSearch}>搜索</button>{query&&<button className="icon-button" aria-label="清空搜索" type="button" onClick={()=>setQuery('')}><X size={16}/></button>}</div>{!submitted?<EmptyState text="输入关键词后点击“搜索”"/>:<GlobalMovieSearch query={submitted} sources={sources} onMovie={onMovie} onPlay={(movie)=>onPlay?.(movie,0,movie?.sourceId,'search')}/>}</Page>;
}

function GlobalMovieSearch({query,sources=[],onMovie,onPlay}){
 const [state,setState]=useState({loading:true,groups:[],failed:[],error:'',completed:0,totalSources:0});
 const normalizedQuery=String(query||'').trim();
 useEffect(()=>{
   if(!normalizedQuery){
     setState({loading:false,groups:[],failed:[],error:'',completed:0,totalSources:0});
     return undefined;
   }
   const controller=new AbortController();
   let active=true;
   const totalSources=sources.filter(source=>source?.sourceType==='movie'&&source?.enabled!==false).length;
   setState({loading:true,groups:[],failed:[],error:'',completed:0,totalSources});
   searchMovieSources(sources,normalizedQuery,{signal:controller.signal,pageSize:20,timeoutMs:5000,onSourceResult:(entry,meta)=>{
     if(!active)return;
     setState(current=>({...current,
       groups:entry.status==='fulfilled'?[...current.groups,entry]:current.groups,
       failed:entry.status==='rejected'?[...current.failed,entry]:current.failed,
       completed:meta?.completed??current.completed,
     }));
   }}).then(result=>{
     if(!active)return;
     setState(current=>({...current,loading:false,groups:result.results??current.groups,failed:result.failed??current.failed,completed:result.completed??current.completed}));
   }).catch(error=>{
     if(!active||error?.name==='AbortError')return;
     setState(current=>({...current,loading:false,error:error?.message||'搜索失败'}));
   });
   return()=>{active=false;controller.abort();};
 },[normalizedQuery,sources]);
 const total=state.groups.reduce((sum,group)=>sum+(group.items?.length??0),0);
 if(!normalizedQuery)return <EmptyState text="输入关键词后点击“搜索”"/>;
 if(state.loading)return <div><div className="empty state-view"><Search size={22}/><b>正在逐源搜索</b><span>已完成 {state.completed} / {state.totalSources} 个影视源，结果会持续显示。</span></div>{state.groups.filter(group=>(group.items?.length??0)>0).map(group=><section key={group.sourceId}><div className="section-title" style={{marginBottom:8}}><h3>{group.sourceName}</h3><span style={{fontSize:12,color:'#8f9aaa'}}>{group.items.length} 条</span></div><MovieSearchList movies={group.items} onMovie={onPlay||onMovie}/></section>)}</div>;
 if(state.error)return <EmptyState text={state.error}/>;
 if(!total&&!state.failed.length)return <EmptyState text={<>没有找到“{query}”的同名影视剧</>}/>;
 return <div><SectionTitle title="全源搜索结果" action={String(total)+' 条'}/><div style={{display:'grid',gap:18}}>{state.groups.filter(group=>(group.items?.length??0)>0).map(group=><section key={group.sourceId}><div className="section-title" style={{marginBottom:8}}><h3>{group.sourceName}</h3><span style={{fontSize:12,color:'#8f9aaa'}}>{group.items.length} 条</span></div><MovieSearchList movies={group.items} onMovie={onPlay||onMovie}/></section>)}</div>{state.failed.length>0&&<div style={{fontSize:11,color:'#8f9aaa',marginTop:12}}>另有 {state.failed.length} 个源未返回结果，已跳过，不影响其他源。</div>}</div>;
}


function MovieDetail({movie,movies,sources=[],selectedSourceId,onMovie,onBack,onPlay,favorite,onFavorite,progress=[],history=[]}){
  const [otherSourceSearchOpen,setOtherSourceSearchOpen]=useState(false);
  const [descExpanded,setDescExpanded]=useState(false);
  const sourceIds=[...new Set([
    ...(movie.sourceRefs??[]).map(ref=>ref.sourceId),
    movie.sourceId,
    selectedSourceId,
  ].filter(Boolean))];
  const sourceMap=new Map(sources.map(source=>[source.sourceId,source.name]));
  const [sourceId,setSourceId]=useState(()=>{
    if(selectedSourceId&&sourceIds.includes(selectedSourceId))return selectedSourceId;
    if(movie.sourceId&&sourceIds.includes(movie.sourceId))return movie.sourceId;
    return sourceIds[0]||selectedSourceId||'';
  });
  const [episodePage,setEpisodePage]=useState(0);
  const related=movieService.getRelated({movies,movie});

  const episodes = useMemo(() => {
    if (Array.isArray(movie.episodes) && movie.episodes.length > 0) return movie.episodes;
    return [{
      episodeId: `${movie.contentId || 'movie'}:ep:1`,
      title: '正片',
      episodeNumber: 1,
      playbackCandidates: movie.playbackCandidates || (movie.playUrl ? [{ mediaUrl: movie.playUrl, label: '默认线路' }] : []),
    }];
  }, [movie]);

  const movieProgress = useMemo(() => {
    if (!movie?.contentId || !Array.isArray(progress)) return null;
    return progress.find(item => item.contentId === movie.contentId) || null;
  }, [movie?.contentId, progress]);

  const lastWatchedEpisodeIndex = useMemo(() => {
    if (!movieProgress?.episodeId || !episodes.length) return 0;
    const idx = episodes.findIndex(e => e.episodeId === movieProgress.episodeId);
    return idx >= 0 ? idx : 0;
  }, [movieProgress, episodes]);

  const hasWatchProgress = movieProgress && movieProgress.positionSeconds > 5 && !movieProgress.completed;
  const watchedPercent = movieProgress?.duration ? Math.min(100, Math.round((movieProgress.positionSeconds / movieProgress.duration) * 100)) : 0;

  const groups=[];for(let i=0;i<episodes.length;i+=50)groups.push(episodes.slice(i,i+50));
  const currentEpisodes=groups[episodePage]??episodes;
  const updateInfo=movie.updateInfo||movie.remarks||movie.vod_remarks||'';
  const is4K=/4k|2160p|超清|蓝光/i.test(`${movie.title} ${updateInfo}`);
  const descText=movie.description||'暂无视频简介。';
  const hasLongDesc=descText.length>80;

  return <Page>
    <button className="back" onClick={onBack} aria-label="返回上一页"><ChevronLeft size={18}/>返回</button>
    
    <div className="detail-hero">
      <div className="detail-hero-poster-wrap" style={{ position: 'relative', width: 130, flexShrink: 0 }}>
        <SmartImage
          src={movie.poster}
          alt={movie.title}
          fallback={<div className="image-placeholder"><Film size={28}/></div>}
          priority
        />
        {is4K && <span className="movie-card-quality-tag" aria-hidden="true">4K</span>}
        {movie.rating && Number(movie.rating) > 0 && (
          <span className="movie-card-rating" aria-label={`评分 ${movie.rating}`}>★ {movie.rating}</span>
        )}
        {updateInfo && <span className="movie-card-badge" title={updateInfo}>{updateInfo}</span>}
      </div>
      <div className="detail-hero-info">
        <span className="eyebrow">{movie.category || '4K影音'}{movie.year ? ` · ${movie.year}` : ''}{movie.region ? ` · ${movie.region}` : ''}</span>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '4px 0 8px', lineHeight: 1.25 }}>{movie.title}</h1>
        <div className="detail-meta">
          <span>年份：{movie.year || '未知'}</span>
          {movie.region && <span>地区：{movie.region}</span>}
          <span>类型：{movie.category || '综合'}</span>
          {movie.director && <span>导演：{movie.director}</span>}
          {movie.actors?.length > 0 && <span>主演：{movie.actors.slice(0, 4).join('、')}</span>}
        </div>
        <div className="detail-desc-wrap" style={{ marginTop: 6, fontSize: 13, color: '#9ba5b5', lineHeight: 1.45 }}>
          <p style={{ margin: 0, display: descExpanded ? 'block' : '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {descText}
          </p>
          {hasLongDesc && (
            <button type="button" onClick={() => setDescExpanded(!descExpanded)} style={{ background: 'none', border: 'none', color: '#f59e0b', fontSize: 12, padding: '2px 0', cursor: 'pointer' }}>
              {descExpanded ? '收起简介 ▲' : '展开全文 ▼'}
            </button>
          )}
        </div>
        <div className="actions" style={{ marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
          <button
            className="primary"
            onClick={() => onPlay(movie, lastWatchedEpisodeIndex, sourceId)}
            style={{ padding: '9px 18px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Play size={16} fill="currentColor"/>
            {hasWatchProgress ? `继续播放 ${episodes[lastWatchedEpisodeIndex]?.title || `第${lastWatchedEpisodeIndex+1}集`}${watchedPercent ? ` (${watchedPercent}%)` : ''}` : '立即播放'}
          </button>
          {hasWatchProgress && (
            <button
              className="secondary"
              onClick={() => onPlay(movie, 0, sourceId)}
              title="从第一集重新播放"
            >
              从头播放
            </button>
          )}
          <button className={favorite ? 'secondary active-fav' : 'secondary'} onClick={onFavorite}>
            <Heart size={16} fill={favorite ? 'currentColor' : 'none'}/> {favorite ? '已收藏' : '收藏'}
          </button>
          <button className="secondary" onClick={() => setOtherSourceSearchOpen(true)} title="全网同名搜索">
            <Search size={15}/> 搜同名
          </button>
        </div>
      </div>
    </div>

    {/* 剧集选集专区 */}
    <div className="section-title" style={{ marginTop: 16 }}>
      <h3>剧集列表 {episodes.length > 0 && <small style={{ fontWeight: 400, color: '#8f9aaa', fontSize: 12 }}>({episodes.length} 集{updateInfo ? ` · ${updateInfo}` : ''})</small>}</h3>
      {episodes.length > 1 && <span style={{ fontSize: 12, color: '#f59e0b' }}>点击直接播放</span>}
    </div>
    {groups.length > 1 && (
      <div className="chips episode-groups" style={{ marginBottom: 8 }}>
        {groups.map((_, i) => (
          <button key={i} className={episodePage === i ? 'active' : ''} onClick={() => setEpisodePage(i)}>
            {i * 50 + 1}–{Math.min((i + 1) * 50, episodes.length)}
          </button>
        ))}
      </div>
    )}
    <div className="episode-grid">
      {currentEpisodes.map((episode, index) => {
        const realIndex = episodePage * 50 + index;
        const isWatched = movieProgress && movieProgress.episodeId === episode.episodeId;
        return (
          <button
            key={episode.episodeId || index}
            className={isWatched ? 'active' : ''}
            onClick={() => onPlay(movie, realIndex, sourceId)}
            title={episode.title}
            style={{ position: 'relative' }}
          >
            <span>{episode.title}</span>
            {isWatched && (
              <span style={{ display: 'block', fontSize: 10, color: '#f59e0b', marginTop: 2 }}>
                {watchedPercent > 0 ? `已看${watchedPercent}%` : '在看'}
              </span>
            )}
          </button>
        );
      })}
    </div>

   {/* 来源切换与其它源搜索 */}
   <SectionTitle title="播放来源" action="全网搜同名 >" onAction={() => setOtherSourceSearchOpen(true)} />
   <div className="chips" style={{ marginBottom: 12 }}>
     {sourceIds.length ? sourceIds.map((id, index) => (
       <button className={sourceId === id ? 'active' : ''} key={`${id}_${index}`} onClick={() => setSourceId(id)}>
         {sourceMap.get(id) || id}
       </button>
     )) : <span>默认影视源</span>}
   </div>

   {otherSourceSearchOpen && (
     <OtherSourceSearchDialog
       title={movie.title}
       currentSourceId={sourceId}
       sources={sources}
       onClose={() => setOtherSourceSearchOpen(false)}
       onMovie={onMovie}
       onPlay={onPlay}
     />
   )}

   {/* 相关推荐 */}
   <SectionTitle title="同类精彩推荐" />
   {related.length ? <MovieCarousel movies={related} onMovie={onMovie} /> : <MovieEmpty compact text="暂无相关推荐" />}
 </Page>;
}

const Page=({children})=><main className="page">{children}</main>;
const Header=({title,action})=><header><div><span className="eyebrow">TVBOX REACT</span><h2>{title}</h2></div>{action}</header>;
const SectionTitle=({title,action,onAction})=><div className="section-title"><h3>{title}</h3>{action&&<button onClick={onAction}>{action}</button>}</div>;
const MovieEmpty=({text,compact,onBack})=><div className={compact?'empty compact':'empty'}>{onBack&&<button className="back" onClick={onBack}><ChevronLeft/>返回</button>}<Film size={22}/><span>{text}</span></div>;
