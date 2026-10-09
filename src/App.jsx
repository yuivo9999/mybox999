import React, { useEffect, useRef, useState } from 'react';
import { Home, Film, Radio, Heart, User } from 'lucide-react';
import { contentService } from './core__services__contentService.js';
import { playbackService } from './core__services__playbackService.js';
import { cacheService } from './core__services__cacheService.js';
import { sourceManagementService } from './me/sourceManagement.js';
import { usePersistentState } from './core__state__usePersistentState.js';
import { useSessionState } from './core__state__useSessionState.js';
import { sessionStateStore } from './core__state__sessionStateStore.js';
import { pageStateStore } from './core__state__pageStateStore.js';
import { MovieFeature } from './movies/MovieFeature.jsx';
import { globalLiveCache } from './live/LiveFeature.jsx';
import { ErrorBoundary } from './shared__components__ErrorBoundary.jsx';
import { webViewRuntime } from './core__runtime__webViewRuntime.js';
import { TabPageRouter } from './TabPageRouter.jsx';
import { HomePage } from './home/HomePage.jsx';
import { ErrorState } from './shared__components__StateViews.jsx';
import { getFontById } from './me/preferences.js';
import { ensureFont } from './me/preferences.js';
import { getGestureDirection, getTopLevelSwipeTarget, getParentForRoute, isSwipeExcludedTarget } from './navigationGesture.js';
import { STATIC_MOVIES, STATIC_LIVE_CHANNELS, STATIC_MOVIE_CATEGORIES } from './home/homeData.js';
import { getMoreCategoryItems } from './movies/movieCatalog.js';

function deduplicateMovies(existing = [], incoming = []) {
  const seenIds = new Set();
  const seenTitles = new Map();
  const normalize = (t) => String(t || '').trim().toLowerCase().replace(/[\s\-_:：·（）\(\)\[\]【】]/g, '');

  const result = [];
  for (const m of existing) {
    if (!m) continue;
    const id = m.contentId || m.id;
    const titleKey = normalize(m.title);
    if (id) seenIds.add(String(id));
    if (titleKey) seenTitles.set(titleKey, m.category || '');
    result.push(m);
  }

  for (const m of incoming) {
    if (!m) continue;
    const id = m.contentId || m.id;
    const titleKey = normalize(m.title);
    if (id && seenIds.has(String(id))) continue;
    if (titleKey && seenTitles.has(titleKey)) continue;

    if (id) seenIds.add(String(id));
    if (titleKey) seenTitles.set(titleKey, m.category || '');
    result.push(m);
  }

  return result;
}

export function App(){
 const session=useSessionState(); const persistent=usePersistentState(); const {tab,route,selected}=session;
 const [contentState,setContentState]=useState(()=>({
   status:'success',
   movies:STATIC_MOVIES,
   channels:STATIC_LIVE_CHANNELS,
   error:null,
   sourceLoading:false,
   movieCategories:STATIC_MOVIE_CATEGORIES,
   movieActiveCategory:{id:'movie',name:'电影'},
   movieSourceId:null,
   movieCategoryLoading:false
 }));
 const [sourceErrorDismissed,setSourceErrorDismissed]=useState(false);
 const reloadGenerationRef=useRef(0);
 const applySourceResult=(result,generation=reloadGenerationRef.current)=>{
   if(generation!==reloadGenerationRef.current)return;
   const currentSources=persistent.sources||[];
   const hasSources=currentSources.length>0;
   const incomingMovies=hasSources?contentService.getMovies(result.movies):[];
   const failed=result.results.filter(item=>item.status==='rejected');
   const selectedMovieSourceId=persistent.selectedSources?.movie ?? persistent.settings?.defaultMovieSource ?? null;
   const resultMovieSourceId=result.results.find(item=>item.status==='fulfilled'&&item.sourceId)?.sourceId ?? selectedMovieSourceId ?? null;
   setContentState(state=>{
     const isSourceChanged = resultMovieSourceId !== state.movieSourceId;
     const movies=hasSources?(isSourceChanged ? incomingMovies : deduplicateMovies(state.movies??[],incomingMovies??[])):[];
     const categories=hasSources?(isSourceChanged ? (result.movieCategories ?? []) : [...(state.movieCategories??[]),...(result.movieCategories??[])]):[];
     const seen=new Set();
     const uniqueCategories=categories.filter(item=>{const key=String(item.name||item.id||'').trim();if(seen.has(key))return false;seen.add(key);return true;});
     return {
       status:'success',
       movies,
       channels:hasSources&&(result.channels?.length)?result.channels:[],
       error:failed.length?failed:null,
       sourceLoading:false,
       movieCategories:hasSources?(uniqueCategories.length?uniqueCategories:state.movieCategories):[],
       movieActiveCategory:isSourceChanged ? (uniqueCategories[0] ?? {id:'movie',name:'电影'}) : (state.movieActiveCategory??{id:'movie',name:'电影'}),
       movieSourceId:hasSources?resultMovieSourceId:null,
       movieCategoryLoading:false
     };
   });
   persistent.reload?.();
 };
  const reloadSources=async(movieSourceIdOverride=undefined,{background=false,includeMovie=true,includeLive=!background,liveSourceIds=null,movieCategoryId=null,movieCategoryName='',movieKeyword='',moviePage=1,moviePageSize=24}={})=>{
    const generation=++reloadGenerationRef.current;
    setSourceErrorDismissed(false);
    if(!background) setContentState(state=>({...state,sourceLoading:false}));
    else setContentState(state=>({...state,error:null,sourceLoading:true,movieCategoryLoading:includeMovie}));
    try{
      const selectedMovieSourceId = movieSourceIdOverride !== undefined
        ? movieSourceIdOverride
        : (persistent.selectedSources?.movie ?? persistent.settings?.defaultMovieSource ?? null);
      const result=await sourceManagementService.reload({
        movieSourceId: selectedMovieSourceId,
        includeMovie,
        includeLive,
        liveSourceIds,
        movieCategoryId,
        movieCategoryName,
        movieKeyword,
        moviePage,
        moviePageSize,
      });
     applySourceResult(result,generation);
   }catch(error){
     if(generation!==reloadGenerationRef.current)return;
     setContentState(state=>({status:'success',movies:state.movies,channels:state.channels,error,sourceLoading:false,movieCategoryLoading:false}));
   }
 };
 const appInitRef = useRef(false);
 useEffect(() => {
   if (appInitRef.current) return;
   appInitRef.current = true;
   cacheService.prune();
   if (!persistent.settings?.initialized) {
     persistent.saveSettings?.({ ...persistent.settings, initialized: true, initializedAt: Date.now() });
   }
   // 启动阶段不发起任何网络请求，保持 100% 本地离线即时启动
 }, []);

 const liveSourcesCount = (persistent.sources || []).filter(s => s.sourceType === 'live' && s.enabled !== false).length;
 useEffect(() => {
   if (tab !== 'live' || contentState.channels.length !== 0 || contentState.status === 'loading') return;
   const hasReloadableLive = persistent.sources?.some(source => (
     source.sourceType === 'live'
     && source.liveMode !== 'tv1'
     && source.enabled !== false
     && Boolean(source.sourceRef || source.url)
   ));
   if (hasReloadableLive) void reloadSources(undefined, { background: true });
 }, [tab, contentState.channels.length, contentState.status, liveSourcesCount]);
 useEffect(()=>webViewRuntime.mount({onBack:()=>{
   if(typeof document!=='undefined'&&document.fullscreenElement){void webViewRuntime.setFullscreen(false);return true}
   if(tab==='live'&&globalLiveCache.isImmersive&&globalLiveCache.exitImmersive){globalLiveCache.exitImmersive();return true}
   if(route==='movie-play'){const nextRoute=selected?.metadata?.returnRoute||'detail';sessionStateStore.patch({route:nextRoute,selected:nextRoute==='detail'?(selected?.metadata?.movie||selected):null});return true}   if(route==='live-play'){handleLiveBack();return true}
   if(route==='detail'||route==='live-channel'||route==='search'){sessionStateStore.patch({route:null,selected:null});return true}
   return false;
 },onAppStateChange:(state)=>{if(state==='foreground'&&(route==='movie-play'||route==='live-play'))webViewRuntime.call('getAppState')} }),[route,tab]);

 const openMovie=(movie,routeOverride=null)=>{
   if(routeOverride==='search'){sessionStateStore.patch({tab:'movies',route:'search',selected:null});return}
   if(!movie)return;
   if(movie.contentId) persistent.touchFavorite?.('content', movie.contentId);
   sessionStateStore.patch({selected:movie,route:'detail',tab:'movies'});
 };
 const playMovie=(movie,episodeIndex=0,sourceId=null,returnRoute='detail')=>{
   if(!movie)return;
   const episodes=(Array.isArray(movie.episodes)&&movie.episodes.length>0)
     ? movie.episodes
     : (Array.isArray(movie.metadata?.episodes) && movie.metadata.episodes.length > 0)
     ? movie.metadata.episodes
     : [{
         episodeId: `${movie.contentId || 'movie'}:ep:1`,
         title: '正片',
         episodeNumber: 1,
         playbackCandidates: movie.playbackCandidates || (movie.playUrl ? [{ mediaUrl: movie.playUrl, label: '默认线路' }] : []),
       }];
   const episode=episodes[episodeIndex]??episodes[0]; if(!episode)return;
   const progress=persistent.progress.find((item)=>item.contentId===movie.contentId&&item.episodeId===episode.episodeId);
   const preferredSource=sourceId||persistent.selectedSources?.movie||persistent.settings?.defaultMovieSource||null;
   const fullMovie={...movie,episodes};
   const request=playbackService.createVODRequest({content:fullMovie,episode,episodeIndex,preferredSource,metadata:{title:movie.title,poster:movie.poster,episodeTitle:episode.title??'',sourceId:preferredSource,returnRoute,movie:fullMovie,episodes,startPositionSeconds:persistent.settings?.autoplayResume?(progress?.completed?0:(progress?.positionSeconds??0)):0}});
   if(preferredSource){const sourceCandidates=request.candidates.filter(candidate=>candidate.sourceId===preferredSource);if(sourceCandidates.length)request.candidates=sourceCandidates;sourceManagementService.touchUsage(preferredSource);}
   sessionStateStore.patch({selected:request,route:'movie-play',tab:'movies'}); persistent.recordMoviePlay(fullMovie,episodeIndex,sourceId);
 };
 const testSource=async(source)=>{
   if(!source?.sourceId)return;
   const current=persistent.sources;
   const mark=(status)=>{sourceManagementService.updateStatus(source.sourceId,status);persistent.reload?.();};
   mark('测试中');
   try{
     const result=await sourceManagementService.test(source);
     mark(result.ok?'可用':'不可用');
     if(result.ok) void reloadSources();
   }catch{
     mark('不可用');
   }
 };
 const saveSources=async(next)=>{const validIds=new Set(next.map(source=>source.sourceId));const current=persistent.settings||{};const patch={};if(current.defaultMovieSource&&!validIds.has(current.defaultMovieSource))patch.defaultMovieSource=null;if(current.defaultLiveSource&&!validIds.has(current.defaultLiveSource))patch.defaultLiveSource=null;const result=await sourceManagementService.save(next);if(Object.keys(patch).length)persistent.updateSettings(patch);else persistent.reload?.();applySourceResult(result);};
 const setSourceEnabled=async(id,enabled)=>{
   const source=persistent.sources.find(item=>item.sourceId===id);
   const result=await sourceManagementService.setEnabled(id,enabled);
   const patch={};
   if(!enabled&&source?.sourceType==='movie'&&persistent.settings?.defaultMovieSource===id)patch.defaultMovieSource=null;
   if(!enabled&&source?.sourceType==='live'&&persistent.settings?.defaultLiveSource===id)patch.defaultLiveSource=null;
   if(!enabled&&source?.sourceType==='live'&&route==='live-play'){
     const invalid=selected?.candidates?.length
       ? selected.candidates.every(candidate=>candidate.sourceId===id)
       : selected?.metadata?.sourceId===id;
     if(invalid) sessionStateStore.patch({route:'live-channel',selected:null});
   }
   if(Object.keys(patch).length)persistent.updateSettings(patch);else persistent.reload?.();
   applySourceResult(result);
 };
 const setSourceActive=async(id)=>{
   const source=persistent.sources.find(item=>item.sourceId===id);
   await sourceManagementService.setActive(id);
   persistent.reload?.();
   if(source?.sourceType==='movie'){
     void reloadSources(id,{background:true,includeMovie:true,includeLive:false});
   }else if(source?.sourceType==='live'){
     void reloadSources(undefined,{background:true,includeMovie:false,includeLive:true,liveSourceIds:[id]});
   }
 };
 const removeSource=async(id)=>{
   const source=persistent.sources.find(item=>item.sourceId===id);
   const result=await sourceManagementService.remove(id);
   const patch={};
   if(source?.sourceType==='movie'&&persistent.settings?.defaultMovieSource===id)patch.defaultMovieSource=null;
   if(source?.sourceType==='live'&&persistent.settings?.defaultLiveSource===id)patch.defaultLiveSource=null;
   if(source?.sourceType==='live'&&route==='live-play'){
     const invalid=selected?.candidates?.length
       ? selected.candidates.every(candidate=>candidate.sourceId===id)
       : selected?.metadata?.sourceId===id;
     if(invalid) sessionStateStore.patch({route:'live-channel',selected:null});
   }
   if(Object.keys(patch).length)persistent.updateSettings(patch);else persistent.reload?.();
   applySourceResult(result);
 };
 const clearAllSources=async()=>{
   const result=await sourceManagementService.clearAll();
   persistent.updateSettings({defaultMovieSource:null,defaultLiveSource:null});
   setContentState({
     status:'success',
     movies:[],
     channels:[],
     error:null,
     sourceLoading:false,
     movieCategories:[],
     movieActiveCategory:{id:'movie',name:'电影'},
     movieSourceId:null,
     movieCategoryLoading:false
   });
   persistent.reload?.();
   applySourceResult(result);
 };
 const nav=(key)=>sessionStateStore.patch({tab:key,route:null,selected:null});

 // 全局 Android 风格横向导航：顶层五页使用左右切页；下一级页面右滑返回父级。
 const swipeRef = useRef({active:false,startX:0,startY:0,pointerId:null,blocked:false});
 const handleSwipePointerDown = (event) => {
   if (event.pointerType === 'mouse' || event.isPrimary === false) return;
   swipeRef.current = {active:true,startX:event.clientX,startY:event.clientY,pointerId:event.pointerId,blocked:isSwipeExcludedTarget(event.target)};
 };
 const handleSwipePointerUp = (event) => {
   const gesture = swipeRef.current;
   swipeRef.current = {active:false,startX:0,startY:0,pointerId:null,blocked:false};
   if (!gesture.active || event.pointerId !== gesture.pointerId || gesture.blocked || isSwipeExcludedTarget(event.target)) return;
   const direction = getGestureDirection(event.clientX - gesture.startX, event.clientY - gesture.startY);
   if (!direction) return;

   // 直播沉浸播放期间，横向滑动属于播放器操作，不切换页面
   if (tab === 'live' && globalLiveCache.isImmersive) return;

   // 全屏/播放器状态优先退出全屏，不触发页面切换。
   if (typeof document !== 'undefined' && document.fullscreenElement) {
     const exitFullscreen = document.exitFullscreen?.();
     exitFullscreen?.catch?.(() => {});
     return;
   }

   // 子页面只把“右滑”定义为 Android 返回手势；左滑不改变页面层级。
   if (route) {
     if (direction !== 'right') return;
     if (route === 'movie-play') {
       const nextRoute = selected?.metadata?.returnRoute || 'detail';
       sessionStateStore.patch({route: nextRoute, selected: nextRoute === 'detail' ? (selected?.metadata?.movie || selected) : null});
     } else if (route === 'detail' || route === 'search') {
       sessionStateStore.patch({route:null,selected:null});
     } else if (route === 'live-play') {
       sessionStateStore.patch({route:'live-channel',selected:contentState.channels.find(c => c.channelId === selected?.channelId) ?? null});
     } else if (route === 'live-channel') {
       sessionStateStore.patch({route:null,selected:null});
     }
     return;
   }

   // 管理页同样属于应用导航栈：右滑回到所属的上一级页面。
   if (direction === 'right') {
     const parentTab = getParentForRoute({tab, route:null, selected});
     if (parentTab) {
       nav(parentTab);
       return;
     }
   }

   // 顶层五页统一为 Android 横向分页：左滑下一页，右滑上一页。
   const targetTab = getTopLevelSwipeTarget(tab, direction);
   if (targetTab) nav(targetTab);
 };
 const openSearchHistory=(keyword)=>{pageStateStore.patch('search',{query:keyword});sessionStateStore.patch({tab:'movies',route:'search',selected:null});};
 const handleFilterSearch=(keyword)=>{
   if(keyword) openSearchHistory(keyword);
   else sessionStateStore.patch({tab:'movies',route:'search',selected:null});
 };
 const playLive=(channel,streamId=null)=>{
   if(!channel)return;
   persistent.touchFavorite?.('channel', channel.channelId);
   persistent.recordLivePlay(channel, streamId);
   globalLiveCache.selectedChannelId = channel.channelId;
   let streamIdx = 0;
   if (streamId != null && Array.isArray(channel.streams)) {
     const idx = channel.streams.findIndex(s => s.streamId === streamId || s.url === streamId);
     if (idx >= 0) streamIdx = idx;
     else if (typeof streamId === 'number' && streamId >= 0 && streamId < channel.streams.length) streamIdx = streamId;
   }
   globalLiveCache.activeStreamIndex = streamIdx;
   pageStateStore.patch('live', { channelId: channel.channelId, category: channel.category || '全部', streamIndex: streamIdx });
   sessionStateStore.patch({ tab: 'live', route: null, selected: null });
 };
 const openLiveChannel=(channel)=>{
   playLive(channel);
 };
 const handleLiveBack = () => {
   sessionStateStore.patch({ route: null, selected: null, tab: 'live' });
 };
 const movieActive=['detail','movie-play','search'].includes(route)||tab==='home'||tab==='movies';
 const isManagementTab = ['sources', 'settings', 'appearance', 'me', 'about', 'data-management', 'history', 'search-history'].includes(tab);

 useEffect(()=>{ void ensureFont(getFontById(persistent.settings?.fontFamily)); },[persistent.settings?.fontFamily]);

 const handleLoadMoreCategory=(category,nextPage=2)=>{
   const activeCat = category || { id: 'movie', name: '电影' };
   setContentState(state=>({...state,movieCategoryLoading:true}));

   const appendFreshBatch = () => {
     setContentState(state => {
       const moreItems = getMoreCategoryItems(activeCat, state.movies, 14);
       const merged = deduplicateMovies(state.movies, moreItems);
       return {
         ...state,
         movies: merged,
         movieCategoryLoading: false,
       };
     });
   };

   reloadSources(undefined,{background:true,includeMovie:true,includeLive:false,movieCategoryId:activeCat?.id??null,movieCategoryName:activeCat?.name??'电影',moviePage:nextPage,moviePageSize:24})
     .then(appendFreshBatch)
     .catch(appendFreshBatch);
 };

 const selectedFont=getFontById(persistent.settings?.fontFamily);
 const appearanceClass=`theme-${persistent.settings?.theme||'sangtian'} font-${persistent.settings?.fontSize||'medium'} app-font-${persistent.settings?.fontFamily||'noto-sans-sc'} cards-${persistent.settings?.cardStyle||'poster'} density-${persistent.settings?.density||'comfortable'}`;

 const mainPageProps = {
   tab,
   movies: contentState.movies,
   channels: contentState.channels,
   favorites: persistent.favorites,
   history: persistent.history,
   progress: persistent.progress,
   settings: persistent.settings,
   sources: persistent.sources,
   searches: persistent.searches,
   onTab: nav,
   onMovie: openMovie,
   onLive: playLive,
   onLiveChannel: openLiveChannel,
   onSearchHistory: openSearchHistory,
   toggleFavorite: persistent.toggleFavorite,
   onClearData: persistent.clearUserData,
   onClearHistory: persistent.clearHistory,
   onClearSearches: persistent.clearSearches,
   onRemoveSearch: persistent.removeSearch,
   onClearCache: persistent.clearCache,
   onSourceEnabled: setSourceEnabled,
   onSourceActive: setSourceActive,
   onUpdateSettings: persistent.updateSettings,
   onTestSource: testSource,
   onSaveSources: saveSources,
   onRemoveSource: removeSource,
   onClearAllSources: clearAllSources,
 };
 const movieFeatureProps = {
   route,
   tab,
   selected,
   movies: contentState.movies,
   channels: contentState.channels,
   history: persistent.history,
   progress: persistent.progress,
   selectedSources: persistent.selectedSources,
   sources: persistent.sources,
   movieCategories: contentState.movieCategories,
   movieActiveCategory: contentState.movieActiveCategory,
   movieCategoryLoading: contentState.movieCategoryLoading,
   onLoadMovieCategory: (category) => {
     setContentState(state => ({ ...state, movieActiveCategory: category ?? state.movieActiveCategory }));
     handleLoadMoreCategory(category, 1);
   },
   onLoadMoreCategory: handleLoadMoreCategory,
   onSelectMovieSource: setSourceActive,
   favorites: persistent.favorites,
   onMovie: openMovie,
   onPlay: playMovie,
   onTab: nav,
   onBack: () => sessionStateStore.patch({
     route: route === 'movie-play' ? (selected?.metadata?.returnRoute || 'detail') : null,
     selected: route === 'movie-play' ? (selected?.metadata?.movie || selected) : null,
   }),
   onLive: playLive,
   recordSearch: persistent.recordSearch,
   toggleFavorite: persistent.toggleFavorite,
 };
 const renderMovieView = () => (tab === 'home' && !route)
   ? <HomePage {...movieFeatureProps} />
   : <MovieFeature {...movieFeatureProps} />;

 let pageContent;
 if (isManagementTab) {
   pageContent = <TabPageRouter {...mainPageProps} />;
 } else if (contentState.status === 'error') {
   pageContent = <>
     {movieActive ? renderMovieView() : <TabPageRouter {...mainPageProps} />}
     {!sourceErrorDismissed && <ErrorState text="无法加载源" onClose={() => setSourceErrorDismissed(true)} />}
   </>;
 } else {
   pageContent = movieActive ? renderMovieView() : <TabPageRouter {...mainPageProps} />;
 }

 return (
  <div className={`app-shell ${appearanceClass}`} style={{'--app-font-family':`"${selectedFont.family}",Inter,ui-sans-serif,system-ui,sans-serif`}} onPointerDown={handleSwipePointerDown} onPointerUp={handleSwipePointerUp} onPointerCancel={() => { swipeRef.current = {active:false,startX:0,startY:0,pointerId:null}; }}>
    <div className="screen">
      {pageContent}
      {!route && <BottomNav tab={tab} onTab={nav}/>}
    </div>
  </div>
 );
}

function AppFrame({children}){return <div className="app-shell"><div className="screen">{children}</div></div>}
function BottomNav({tab,onTab}){return <nav>{[['home',Home,'首页'],['movies',Film,'影视'],['live',Radio,'直播'],['favorites',Heart,'收藏'],['me',User,'我的']].map(([key,Icon,label])=><button className={tab===key?'active':''} onClick={()=>onTab(key)} key={key}><Icon size={21} fill={tab===key?'currentColor':'none'}/><span>{label}</span></button>)}</nav>}
export function AppRoot(){
 const {tab,route,selected}=useSessionState();
 const recoverFromPageError=()=>{
   if(route==='movie-play'){
     const returnRoute=selected?.metadata?.returnRoute||'detail';
     sessionStateStore.patch({tab:'movies',route:returnRoute,selected:returnRoute==='detail'?selected:null});
   }else if(route==='detail'||route==='search'){
     sessionStateStore.patch({tab:'movies',route:null,selected:null});
   }else if(route==='live-play'){
     sessionStateStore.patch({tab:'live',route:null,selected:null});
   }else if(route==='live-channel'){
     sessionStateStore.patch({tab:'live',route:null,selected:null});
   }else if(route==='appearance'){
     sessionStateStore.patch({tab:'settings',route:null,selected:null});
   }else if(route==='settings'||route==='sources'||route==='data-management'||route==='history'||route==='search-history'){
     sessionStateStore.patch({tab:'me',route:null,selected:null});
   }
 };
 return <ErrorBoundary route={route} onReset={recoverFromPageError}><App/></ErrorBoundary>;
}

function FirstLaunch({onLater,onSources}){return <div className="app-shell"><div className="screen"><main className="page first-launch"><div className="profile"><div className="avatar">T</div><div><span className="eyebrow">TVBOX REACT</span><h1>欢迎使用</h1><span>当前还没有配置内容源</span></div></div><div className="actions"><button className="primary" onClick={onSources}>去添加源</button><button className="secondary" onClick={onLater}>稍后设置</button></div></main></div></div>}
