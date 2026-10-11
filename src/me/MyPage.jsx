import React, { useState } from 'react';
import { ChevronLeft, Clock3, Database, Film, Info, Radio, Search, Server, Settings, Trash2, Check, Download, Upload, X, CheckSquare, Square, Power, PowerOff, RefreshCw, Layers, MoreHorizontal, Link2 } from 'lucide-react';
import { SmartImage } from '../shared__components__StateViews.jsx';
import { sourceConfigService } from './sourceManagement.js';
import { multiRepoService } from './repositoryManagement.js';
import { MultiRepoManager } from './MultiRepoManager.jsx';
import { RepoDetailView } from './RepoDetailView.jsx';
import { FONT_CATALOG, getFontById } from './preferences.js';
import { ensureFont } from './preferences.js';
import { PLAYBACK_SCHEMES, getPlaybackScheme, getPlaybackSchemeId } from '../core__models__userData.js';
import { detectRuntimeEnv, RUNTIME_ENV } from '../core__playback__playbackStrategyDispatcher.js';

function MyPage({tab,movies,channels,favorites,history,sources,searches,progress,settings,onTab,onMovie,onLive,onLiveChannel,onSearchHistory,toggleFavorite,onClearData,onClearHistory,onSaveSources,onClearSearches,onRemoveSearch,onClearCache,onSourceEnabled,onSourceActive,onTestSource,onRemoveSource,onClearAllSources,onUpdateSettings}){
 const [fontPicker,setFontPicker]=useState(false);
 const [confirm,setConfirm]=useState(null); const [sourceForm,setSourceForm]=useState(null); const [batchMode,setBatchMode]=useState(false); const [sourceNotice,setSourceNotice]=useState('');
 const [multiRepoMode,setMultiRepoMode]=useState(false); const [inspectingRepo,setInspectingRepo]=useState(null); const [isSyncingSingle,setIsSyncingSingle]=useState(false);
 const [sourceQuery,setSourceQuery]=useState(''); const [sourceFilter,setSourceFilter]=useState('all'); const [sourceMoreOpen,setSourceMoreOpen]=useState(false);
 const normalizedSourceQuery=sourceQuery.trim().toLocaleLowerCase();
 const sourceCounts={all:sources.length,movie:sources.filter(source=>source.sourceType==='movie').length,live:sources.filter(source=>source.sourceType==='live').length,enabled:sources.filter(source=>source.enabled!==false).length};
 const filteredSources=sources.filter(source=>{
  const matchesType=sourceFilter==='all'||source.sourceType===sourceFilter;
  const searchable=[source.name,source.sourceRef,source.url,source.sourceId].filter(Boolean).join(' ').toLocaleLowerCase();
  return matchesType&&(!normalizedSourceQuery||searchable.includes(normalizedSourceQuery));
 });
 if(tab==='history'){
  const historyMovies=history.filter(i=>i.targetType==='content').map(item=>({item,movie:movies.find(m=>m.contentId===item.targetId)||null}));
  const historyChannels=history.filter(i=>i.targetType==='channel').map(i=>channels.find(c=>c.channelId===i.targetId)).filter(Boolean);
  return <Page><Header title="播放历史"/>{historyMovies.length?<div className="movie-grid">{historyMovies.filter(({movie})=>movie).map(({movie,item})=>{const ep=movie.episodes?.find(e=>e.episodeId===item.episodeId);const pct=item.durationSeconds?Math.min(100,Math.round(item.positionSeconds/item.durationSeconds*100)):0;return <article className="movie-card history-card" key={item.historyId} onClick={()=>onMovie(movie)}><SmartImage src={movie.poster} alt={movie.title}/><div><b>{movie.title}</b><span>{ep?.title??'继续观看'} · {pct}%</span><small>最近观看：{new Date(item.lastPlayedAt||Date.now()).toLocaleString()}</small></div></article>})}</div>:<Empty text="还没有播放历史"/>}{historyMovies.filter(({movie})=>!movie).map(({item})=><div className="info-card" key={item.historyId}><Database size={18}/><div><b>暂时无法找到来源</b><span>播放历史已保留：{item.targetId}</span></div></div>)}{historyChannels.length>0&&<><SectionTitle title="Live"/><div className="channel-list">{historyChannels.map(c=><button className="menu" key={c.channelId} onClick={()=>onLiveChannel(c)}><Radio size={18}/><span>{c.name}<small>{c.category}</small></span><ChevronLeft className="flip" size={17}/></button>)}</div></>}</Page>;
 }
 if(tab==='search-history') return <Page><Header title="搜索历史"/><div className="actions"><button className="secondary" disabled={!searches.length} onClick={()=>setConfirm({type:'searches'})}>清空搜索历史</button></div><div className="history-list">{searches.map(i=><div className="menu" key={i.searchId}><Search size={18}/><button className="history-keyword" onClick={()=>onSearchHistory(i.keyword)}>{i.keyword}</button><em>{i.count} 次</em><button className="icon-button" aria-label="删除历史" onClick={()=>setConfirm({type:'search',id:i.searchId})}>×</button></div>)}{!searches.length&&<Empty text="还没有搜索历史"/>}</div>{confirm&&<ConfirmDialog title={confirm.type==='searches'?'清空搜索历史？':'删除这条搜索历史？'} onCancel={()=>setConfirm(null)} onConfirm={()=>{if(confirm.type==='searches')onClearSearches();else onRemoveSearch(confirm.id);setConfirm(null)}}/>}</Page>;
 if(tab==='sources') return <Page><Header title="源管理"/>
    <p className="sources-intro">管理影视源、Live 直播源与订阅配置</p>

    <section className="source-overview" aria-label="源概览">
      <div className="source-overview-card"><span>全部源</span><b>{sourceCounts.all}</b><small>影视与 Live</small></div>
      <div className="source-overview-card"><span>已启用</span><b>{sourceCounts.enabled}</b><small>允许参与使用</small></div>
    </section>

    <section className="source-toolbar" aria-label="源管理操作">
      <div className="source-primary-actions">
        <button className="primary source-add-button" onClick={()=>{setSourceMoreOpen(false);setSourceNotice('');setSourceForm({sourceType:'live',name:''})}}>
          <span className="source-add-symbol">+</span> 添加源
        </button>
        <button className="secondary source-repo-button" onClick={()=>{setSourceMoreOpen(false);setMultiRepoMode(true)}} title="管理多仓订阅与单仓聚合">
          <Layers size={16}/> 多仓管理
        </button>
      </div>
      <div className="source-secondary-actions">
        <button className="secondary" onClick={()=>{setSourceMoreOpen(false);setBatchMode(true)}}>
          <CheckSquare size={15}/> 批量管理
        </button>
        <label className="secondary file-button source-import-button" title="导入单仓配置">
          <Upload size={15}/> 导入
          <input type="file" accept=".json,.txt,.m3u,application/json,text/plain" hidden onChange={async e=>{
            const file=e.target.files?.[0];
            if(!file)return;
            try{
              const parsed=await sourceConfigService.importFile(file);
              await onSaveSources(parsed);
              setSourceNotice(`已导入 ${parsed.length} 个源`);
            }catch(error){
              console.error(error);
              setSourceNotice(`导入失败：${error?.message||'文件格式无效'}`);
            }finally{
              e.target.value='';
            }
          }}/>
        </label>
        <div className="source-more-wrap">
          <button className="secondary" aria-haspopup="menu" aria-expanded={sourceMoreOpen} onClick={()=>setSourceMoreOpen(open=>!open)}>
            <MoreHorizontal size={17}/> 更多
          </button>
          {sourceMoreOpen&&<div className="source-more-menu" role="menu">
            <button type="button" role="menuitem" onClick={()=>{
              try{
                sourceConfigService.download(sources);
                setSourceNotice('源配置已导出');
              }catch(error){
                console.error(error);
                setSourceNotice(`导出失败：${error?.message||'未知错误'}`);
              }
              setSourceMoreOpen(false);
            }}><Download size={15}/> 导出源配置</button>
            <button type="button" role="menuitem" onClick={async ()=>{
              setSourceMoreOpen(false);
              if(!window.confirm('确定要恢复项目自带的默认源吗？这不会删除您手动添加的源。'))return;
              try{
                const defaults=sourceConfigService.getDefaultSources();
                const existing=new Set(sources.map(source=>`${source.sourceType}|${source.sourceRef||source.url||''}`));
                const additions=defaults.filter(source=>!existing.has(`${source.sourceType}|${source.sourceRef||source.url||''}`));
                await onSaveSources([...sources,...additions]);
                setSourceNotice(additions.length?`已恢复 ${additions.length} 个内置源`:'内置源已经存在，无需重复添加');
              }catch(error){
                console.error(error);
                setSourceNotice(`恢复内置源失败：${error?.message||'未知错误'}`);
              }
            }}><Database size={15}/> 恢复内置源</button>
            <div className="source-more-divider"/>
            <button type="button" role="menuitem" className="source-more-danger" onClick={()=>{setSourceMoreOpen(false);setConfirm({type:'clear-all-sources'})}}>
              <Trash2 size={15}/> 清空全部源与缓存
            </button>
          </div>}
        </div>
      </div>
    </section>

    {sourceNotice&&<div className="batch-source-notice source-main-notice" role="status">{sourceNotice}</div>}

    <div className="source-search" role="search">
      <Search size={18} aria-hidden="true"/>
      <input type="search" value={sourceQuery} onChange={event=>setSourceQuery(event.target.value)} placeholder="搜索源名称或地址" aria-label="搜索源名称或地址"/>
      {sourceQuery&&<button type="button" className="source-search-clear" aria-label="清空搜索" onClick={()=>setSourceQuery('')}><X size={16}/></button>}
    </div>

    <div className="source-filter-tabs" role="tablist" aria-label="源类型筛选">
      <button type="button" role="tab" aria-selected={sourceFilter==='all'} className={sourceFilter==='all'?'active':''} onClick={()=>setSourceFilter('all')}>全部 <span>{sourceCounts.all}</span></button>
      <button type="button" role="tab" aria-selected={sourceFilter==='movie'} className={sourceFilter==='movie'?'active':''} onClick={()=>setSourceFilter('movie')}>影视 <span>{sourceCounts.movie}</span></button>
      <button type="button" role="tab" aria-selected={sourceFilter==='live'} className={sourceFilter==='live'?'active':''} onClick={()=>setSourceFilter('live')}>Live <span>{sourceCounts.live}</span></button>
    </div>

    <div className="source-list-heading"><b>{sourceFilter==='movie'?'影视源':sourceFilter==='live'?'Live 源':'全部源'}</b><span>{filteredSources.length} 个</span></div>
    <SourceList
      sources={filteredSources}
      onEnabled={onSourceEnabled}
      onActive={onSourceActive}
      onTest={onTestSource}
      onRemove={onRemoveSource}
      emptyText={normalizedSourceQuery?'未找到匹配的源':sourceFilter==='movie'?'暂无影视源':sourceFilter==='live'?'暂无 Live 源':'暂无内容源'}
    />
    <p className="source-footer-note">支持网络 URL、JSON、M3U 与 #genre# TXT 直播源。源配置、测试结果与运行状态分别管理。</p>

    {confirm?.type==='clear-all-sources'&&<ConfirmDialog title="彻底清空所有源与缓存？" text="此操作将删除源管理中的全部影视源与 Live 直播源（包括内置源），并清理本地数据与播放缓存。该操作不可撤销。" onCancel={()=>setConfirm(null)} onConfirm={async ()=>{setConfirm(null);await onClearAllSources?.();}}/>}

    {sourceForm&&<SourceForm value={sourceForm} onCancel={()=>setSourceForm(null)} onSave={async source=>{
      const additions=Array.isArray(source)?source:[{...source,sourceId:`source_${source.sourceType}_${Date.now()}`,enabled:true,status:'未测试'}];
      try{
        await onSaveSources([...sources,...additions]);
        setSourceNotice(Array.isArray(source)?`已添加 ${source.length} 个源`:'源已添加');
        setSourceForm(null);
      }catch(error){
        console.error(error);
        setSourceNotice(`保存源失败：${error?.message||'未知错误'}`);
      }
    }}/>} 

    {batchMode&&<BatchSourceManager sources={sources} onBack={()=>setBatchMode(false)} onEnabled={onSourceEnabled} onTest={onTestSource} onRemove={onRemoveSource}/>}

    {multiRepoMode&&<MultiRepoManager
      onBack={()=>setMultiRepoMode(false)}
      onSelectRepoDetail={(repo)=>setInspectingRepo(repo)}
      onApplyAggregated={async (aggregatedConfig)=>{
        const res=await multiRepoService.applyAggregatedConfigToActiveSources(aggregatedConfig,{sourceConfigService});
        await onSaveSources(res.sources);
        return res;
      }}
      onDownloadAggregated={(aggregatedConfig)=>{
        sourceConfigService.download(aggregatedConfig,'tvbox-aggregated-single.json');
      }}
      sourceNotice={sourceNotice}
      setSourceNotice={setSourceNotice}
    />}

    {inspectingRepo&&<RepoDetailView
      repo={inspectingRepo}
      onBack={()=>setInspectingRepo(null)}
      isSyncing={isSyncingSingle}
      onSync={async (repoId)=>{
        setIsSyncingSingle(true);
        try{
          const res=await multiRepoService.syncRepo(repoId);
          if(res.ok){
            setInspectingRepo(res.repo);
            setSourceNotice(`“${res.repo.name}” 同步成功`);
          }else{
            setInspectingRepo(res.repo);
            setSourceNotice(`“${res.repo.name}” 同步失败：${res.error}`);
          }
        }finally{
          setIsSyncingSingle(false);
        }
      }}
    />}
  </Page>;
 if(tab==='settings'){
  const playback=settings?.playback??{};
  const isAndroidPlayback=detectRuntimeEnv()===RUNTIME_ENV.ANDROID;
  const updatePlayback=(patch={})=>onUpdateSettings?.({
    playback:{...playback,...patch,decoder:{...(playback.decoder??{}),...(patch.decoder??{})}},
  });
  const availableSchemes=(scope)=>isAndroidPlayback
    ? PLAYBACK_SCHEMES.filter(item => scope === 'live'
        ? ['ijk_hardware','ijk_software','exo_hardware','exo_software','html5_auto','hls_lowlatency','html5_hardware'].includes(item.id)
        : ['html5_auto','hls_worker','html5_hardware'].includes(item.id))
    : PLAYBACK_SCHEMES.filter(item=>item.platform!=='android');
  const resolveScheme=(scope)=>{
    const saved=playback[scope+'PlaybackScheme'];
    const legacy=getPlaybackSchemeId(playback[scope+'Player']||'ijk',playback.decoder?.[playback[scope+'Player']||'ijk']||'hardware');
    const allowed=availableSchemes(scope);
    const defaultAndroidScheme = scope === 'live' ? 'ijk_hardware' : 'html5_auto';
    const desired=isAndroidPlayback?(allowed.some(item=>item.id===saved)?saved:defaultAndroidScheme):(saved||legacy);
    return allowed.find(item=>item.id===desired)||allowed[0]||getPlaybackScheme('html5_auto');
  };
  const applyScheme=(scope, schemeId)=>{
    const scheme=availableSchemes(scope).find(item=>item.id===schemeId)||availableSchemes(scope)[0];
    if(!scheme)return;
    updatePlayback({[scope+'Player']:scheme.engine,[scope+'PlaybackScheme']:scheme.id,decoder:{[scheme.engine]:scheme.decoder}});
  };
  const nextScheme=(scope)=>{
    const schemes=availableSchemes(scope);
    const current=resolveScheme(scope);
    const index=schemes.findIndex(item=>item.id===current.id);
    return schemes[(index+1)%schemes.length];
  };
  const order=isAndroidPlayback?'HTML5 原生媒体 → HLS.js/MSE → MPEG-TS/备用线路':(playback.fallbackOrder??['ijk','exo','native']).join(' → ');
  const movieScheme=resolveScheme('movie');
  const liveScheme=resolveScheme('live');
  return <Page><Header title="设置"/>
   <SectionTitle title="播放设置"/>
   <SettingMenu icon={Radio} title="自动继续播放" value={settings?.autoplayResume?'开启':'关闭'} onClick={()=>onUpdateSettings?.({autoplayResume:!settings?.autoplayResume})}/>
   <SettingMenu icon={Radio} title="默认影视播放方案" value={movieScheme.label} onClick={()=>applyScheme('movie',nextScheme('movie').id)}/>
   <SettingMenu icon={Radio} title="默认直播播放方案" value={liveScheme.label} onClick={()=>applyScheme('live',nextScheme('live').id)}/>
   <SettingMenu icon={Radio} title="失败自动切换" value={playback.fallbackEnabled===false?'关闭':'开启'} onClick={()=>updatePlayback({fallbackEnabled:playback.fallbackEnabled===false})}/>
   {!isAndroidPlayback&&<SettingMenu icon={Radio} title="切换顺序" value={order} onClick={()=>updatePlayback({fallbackOrder:rotateOrder(playback.fallbackOrder)})}/>}
   <InfoCard title="可选播放方案" text={isAndroidPlayback
     ? 'Android Live 可使用独立 IJKPlayer / ExoPlayer，并分别选择硬件或软件解码；HTML5 自动适配、HLS.js/MSE 与 HTML5 原生媒体仍可作为直播备选。影视点播继续使用页面内 HTML 视频播放路径。'
     : PLAYBACK_SCHEMES.filter(item=>item.platform!=='android').map(item=>item.label).join(' · ') + '。普通手机浏览器使用 HLS.js 或 HTML5 原生媒体，不调用 Android 原生视频引擎。'}/>
   <SectionTitle title="解码设置"/>
   <InfoCard title={isAndroidPlayback?'Live 与点播解码范围':'浏览器播放方案'} text={isAndroidPlayback
     ? 'Android Live 播放器与解码方式请在直播主界面或沉浸播放界面的“直播配置”中选择；IJK/Exo 独立于通用原生播放器。影视点播仍走内嵌 HTML5/HLS 路径，不受 Live 专用播放器影响。'
     : '普通手机浏览器使用其 HTML5 视频解码能力与 HLS.js/MSE 路径，实际能力取决于浏览器和源站的媒体格式、跨域与请求头策略。'}/>
   <SectionTitle title="线路设置"/>
   <SettingMenu icon={Radio} title="默认影视线路" value={sourceSettingLabel(sources,'movie',settings?.defaultMovieSource)} onClick={()=>onUpdateSettings?.({defaultMovieSource:nextSource(sources,'movie',settings?.defaultMovieSource)})}/>
   <SettingMenu icon={Radio} title="默认直播线路" value={sourceSettingLabel(sources,'live',settings?.defaultLiveSource)} onClick={()=>onUpdateSettings?.({defaultLiveSource:nextSource(sources,'live',settings?.defaultLiveSource)})}/>
   <SectionTitle title="数据设置"/>
   <Menu icon={Trash2} title="清除历史" onClick={()=>setConfirm({type:'history'})}/><Menu icon={Trash2} title="清除搜索记录" onClick={()=>setConfirm({type:'searches'})}/><Menu icon={Database} title="清除缓存" onClick={()=>{onClearCache();}}/>
   {confirm&&<ConfirmDialog title="确认清理？" onCancel={()=>setConfirm(null)} onConfirm={()=>{if(confirm.type==='history')onClearHistory();else onClearSearches();setConfirm(null)}}/>}
  </Page>;
 }
 if(tab==='appearance') return <Page><Header title="外观设置"/>
   <SectionTitle title="主题" />
   <SettingMenu icon={Settings} title="主题" value={settings?.theme==='sangtian'?'桑田山河':settings?.theme==='light'?'浅色':'深色'} onClick={()=>onUpdateSettings?.({theme:cycle(settings?.theme||'sangtian',['sangtian','dark','light'])})}/>
   <SectionTitle title="字体" />
   <SettingMenu icon={Settings} title="字体" value={getFontById(settings?.fontFamily).name} onClick={()=>setFontPicker(true)}/>
   <SettingMenu icon={Settings} title="字体大小" value={settings?.fontSize==='large'?'大':settings?.fontSize==='small'?'小':'中'} onClick={()=>onUpdateSettings?.({fontSize:cycle(settings?.fontSize||'medium',['small','medium','large'])})}/>
   <SectionTitle title="显示" />
   <SettingMenu icon={Settings} title="卡片显示" value={settings?.cardStyle==='compact'?'紧凑':'海报'} onClick={()=>onUpdateSettings?.({cardStyle:settings?.cardStyle==='compact'?'poster':'compact'})}/>
   <SettingMenu icon={Settings} title="显示密度" value={settings?.density==='compact'?'紧凑':'舒适'} onClick={()=>onUpdateSettings?.({density:settings?.density==='compact'?'comfortable':'compact'})}/>
   {fontPicker&&<FontPickerDialog value={settings?.fontFamily} onCancel={()=>setFontPicker(false)} onApply={(fontId)=>{onUpdateSettings?.({fontFamily:fontId});setFontPicker(false)}}/>}
  </Page>;
 if(tab==='data-management') return <Page><Header title="数据管理"/><Menu icon={Trash2} title="清理用户数据" onClick={()=>setConfirm({type:'all'})}/><Menu icon={Database} title="清理缓存" onClick={onClearCache}/><InfoCard title="不可逆操作" text="用户数据清理会删除收藏、历史、播放进度和搜索历史；源配置不会删除。"/>{confirm&&<ConfirmDialog title="确认清理用户数据？" onCancel={()=>setConfirm(null)} onConfirm={()=>{onClearData();setConfirm(null)}}/>}</Page>;
 if(tab==='about') return <Page><Header title="关于"/><InfoCard title="TVBox React" text="安卓手机竖屏影视与 Live 内容聚合应用。"/><InfoCard title="版本" text="0.3.0 · 产品架构实现版"/><InfoCard title="版权与开源" text="本项目遵循仓库中声明的开源与第三方依赖许可要求。"/><InfoCard title="架构" text="影视、Live、用户数据、源管理与播放内核保持独立边界。"/></Page>;
 return <Page><Header title="我的"/><div className="profile"><div className="avatar">T</div><div><b>TVBox 用户</b><span>本地数据独立存储 · 产品架构版</span></div></div><Menu icon={Clock3} title="播放历史" onClick={()=>onTab('history')} badge={history.length}/><Menu icon={Search} title="搜索历史" onClick={()=>onTab('search-history')} badge={searches.length}/><Menu icon={Server} title="源管理" onClick={()=>onTab('sources')} badge={sources.length}/><Menu icon={Settings} title="设置" onClick={()=>onTab('settings')}/><Menu icon={Settings} title="外观设置" onClick={()=>onTab('appearance')}/><Menu icon={Database} title="数据管理" onClick={()=>onTab('data-management')}/><Menu icon={Info} title="关于" onClick={()=>onTab('about')}/></Page>;
}
function BatchSourceManager({sources,onBack,onEnabled,onTest,onRemove}){
  const [selectedIds,setSelectedIds]=useState([]);
  const [filter,setFilter]=useState('all');
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [confirmDelete,setConfirmDelete]=useState(false);
  const visibleSources=sources.filter(source=>filter==='all'||source.sourceType===filter);
  const selectedSources=sources.filter(source=>selectedIds.includes(source.sourceId));
  const allVisibleSelected=visibleSources.length>0&&visibleSources.every(source=>selectedIds.includes(source.sourceId));
  const toggle=(id)=>setSelectedIds(ids=>ids.includes(id)?ids.filter(item=>item!==id):[...ids,id]);
  const toggleAll=()=>setSelectedIds(ids=>allVisibleSelected?ids.filter(id=>!visibleSources.some(source=>source.sourceId===id)):[...new Set([...ids,...visibleSources.map(source=>source.sourceId)])]);
  const clearSelection=()=>setSelectedIds([]);
  const runBatch=async(action)=>{
    if(!selectedSources.length||busy)return;
    setBusy(true); setNotice('正在处理…');
    try{
      for(const source of selectedSources){
        if(action==='enable'&&source.enabled===false) await onEnabled?.(source.sourceId,true);
        if(action==='disable'&&source.enabled!==false) await onEnabled?.(source.sourceId,false);
        if(action==='test'&&!String(source.sourceCapability||'').startsWith('tvbox-')&&!String(source.adapterType||'').startsWith('tvbox-')) await onTest?.(source);
        if(action==='remove') await onRemove?.(source.sourceId);
      }
      setNotice(action==='remove'?'已删除所选源':action==='test'?'已提交所选源测试':action==='enable'?'已启用所选源':'已停用所选源');
      if(action==='remove') setSelectedIds([]);
    }catch(error){console.error('Batch source action failed',error);setNotice('批量操作未能全部完成，请检查源状态。');}
    finally{setBusy(false);setConfirmDelete(false);}
  };
  return <div className="modal-backdrop batch-source-backdrop" role="dialog" aria-modal="true" aria-label="批量管理源" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onBack()}}>
    <div className="batch-source-modal" onMouseDown={event=>event.stopPropagation()}>
      <div className="batch-source-header">
        <div className="batch-source-title"><span className="eyebrow">SOURCE MANAGEMENT</span><h3>批量管理源</h3><small>已选择 {selectedSources.length} / {sources.length}</small></div>
        <button className="icon-button" type="button" aria-label="关闭批量管理" title="关闭" onClick={onBack} disabled={busy}><X size={18}/></button>
      </div>
    <div className="batch-source-toolbar">
      <div className="batch-source-filters">
        <button className={filter==='all'?'primary':'secondary'} onClick={()=>setFilter('all')} disabled={busy}>全部 {sources.length}</button>
        <button className={filter==='movie'?'primary':'secondary'} onClick={()=>setFilter('movie')} disabled={busy}>影视 {sources.filter(s=>s.sourceType==='movie').length}</button>
        <button className={filter==='live'?'primary':'secondary'} onClick={()=>setFilter('live')} disabled={busy}>Live {sources.filter(s=>s.sourceType==='live').length}</button>
      </div>
      <div className="batch-source-selection-actions">
        <button className="secondary" onClick={toggleAll} disabled={!visibleSources.length||busy}>{allVisibleSelected?'取消全选':'全选当前'}</button>
        <button className="secondary" onClick={clearSelection} disabled={!selectedSources.length||busy}>清空选择</button>
      </div>
    </div>
    <div className="batch-source-actions">
      <button className="secondary" onClick={()=>runBatch('enable')} disabled={!selectedSources.length||busy}><Power size={16}/>启用</button>
      <button className="secondary" onClick={()=>runBatch('disable')} disabled={!selectedSources.length||busy}><PowerOff size={16}/>停用</button>
      <button className="secondary" onClick={()=>runBatch('test')} disabled={!selectedSources.length||busy}><RefreshCw size={16}/>批量测试</button>
      <button className="danger-button" onClick={()=>setConfirmDelete(true)} disabled={!selectedSources.length||busy}><Trash2 size={16}/>删除所选 ({selectedSources.length})</button>
    </div>
    {notice&&<div className="batch-source-notice">{notice}</div>}
    <div className="batch-source-list">
      {visibleSources.map(source=>{
        const checked=selectedIds.includes(source.sourceId);
        const unsupported=String(source.sourceCapability||'').startsWith('tvbox-')||String(source.adapterType||'').startsWith('tvbox-');
        return <button className={`batch-source-row${checked?' selected':''}`} key={source.sourceId} onClick={()=>toggle(source.sourceId)} disabled={busy}>
          <span className="batch-source-check">{checked?<CheckSquare size={20}/>:<Square size={20}/>}</span>
          <span className="batch-source-info"><b>{source.name}</b><small>{source.sourceType==='live'?'Live 源':'影视源'} · {source.status}{source.enabled===false?' · 已停用':''}{source.isActive?' · 当前使用':''}{unsupported?' · 待适配':''}</small></span>
          <span className={`batch-source-state ${source.enabled===false?'off':''}`}>{source.enabled===false?'停用':'启用'}</span>
        </button>;
      })}
      {!visibleSources.length&&<Empty text="暂无可管理的源"/>}
    </div>
    <div className="batch-source-tip"><Info size={16}/><span>批量删除不可撤销；启用、停用和测试会逐个调用现有源管理逻辑，不会绕过当前源的安全检查。</span></div>
    {confirmDelete&&<ConfirmDialog title={`确定删除已选择的 ${selectedSources.length} 个源吗？`} onCancel={()=>setConfirmDelete(false)} onConfirm={()=>runBatch('remove')}/>} 
    </div>
  </div>;
}
function sourceAddressLabel(source){
  const reference=String(source.sourceRef||source.url||'').trim();
  if(!reference)return String(source.sourceCapability||'').startsWith('tvbox-')?'扩展源':'未提供地址';
  if(/^local:\/\//i.test(reference))return '本地源';
  if(/^https?:\/\//i.test(reference)){
    try{return new URL(reference).hostname.replace(/^www\./i,'')||'网络源';}
    catch{return '网络源';}
  }
  if(/^\s*[\[{]/.test(reference))return '内嵌配置';
  return '自定义地址';
}

function SourceList({sources,onEnabled,onActive,onTest,onRemove,emptyText='暂无内容源'}){
  const [removeId,setRemoveId]=useState(null);
  const removeSource=sources.find(source=>source.sourceId===removeId);
  return <div className="source-list">{sources.map((source, index)=>{
    const isTesting=source.status==='测试中';
    const status=String(source.status||'未测试');
    const statusKind=(status==='正常'||status==='可用')?'ok':(status==='不可用'||status==='异常')?'error':isTesting?'testing':'idle';
    const capability=String(source.sourceCapability||'').trim();
    const tvboxKind=String(source.tvboxAdapterKind||'').trim().toLowerCase();
    const safeExtFormats=new Set(['json-vod','remote-json','remote-resource','inline-json']);
    const runtimeSupported=capability==='tvbox-jar'
      ||capability==='tvbox-http-vod-with-jar'
      ||(capability==='tvbox-ext'&&tvboxKind==='ext'&&safeExtFormats.has(String(source.tvboxExtFormat||'').trim()));
    const isUnsupported=(capability.startsWith('tvbox-')||String(source.adapterType||'').startsWith('tvbox-'))&&!runtimeSupported;
    const capabilityLabel=source.tvboxAdapterKind==='drpy-js'?'Drpy JS 待适配'
      :source.tvboxAdapterKind==='csp'?'CSP 待适配'
      :source.tvboxAdapterKind==='jar'||source.tvboxAdapterKind==='http-vod-with-jar'?(runtimeSupported?'JAR 执行器':'JAR 待适配')
      :source.tvboxAdapterKind==='ext'?(runtimeSupported?'安全 JSON EXT':'EXT 待适配')
      :source.tvboxAdapterKind==='live-provider'?'Live 提供器待适配'
      :isUnsupported?'TVBox 扩展待适配':'';
    const isEnabled=source.enabled!==false;
    const isLive=source.sourceType==='live';
    return <article className="source-card" key={`${source.sourceId||'src'}_${index}`}>
      <div className="source-card-main">
        <div className={`source-card-icon ${isLive?'is-live':''}`}>{isLive?<Radio size={19}/>:<Film size={19}/>}</div>
        <div className="source-card-info">
          <div className="source-card-title-row">
            <b title={source.name||'未命名源'}>{source.name||'未命名源'}</b>
            <span className={`source-type-tag ${isLive?'live':'movie'}`}>{isLive?'Live 源':'影视源'}</span>
          </div>
          <div className="source-state-row">
            <span className={`source-status-tag ${statusKind}`}><i aria-hidden="true"/>{status}</span>
            <span className={`source-enabled-tag ${isEnabled?'enabled':'disabled'}`}>{isEnabled?'已启用':'已停用'}</span>
            {source.isActive&&<span className="source-active-tag">当前使用</span>}
          </div>
          <div className="source-address" title={sourceAddressLabel(source)}><Link2 size={12}/><span>{sourceAddressLabel(source)}</span>{isLive&&source.liveMode==='tv1'&&<em>TV1 专用</em>}</div>
          {capabilityLabel&&<div className={`source-capability-note ${isUnsupported?'unsupported':''}`}>{capabilityLabel}</div>}
        </div>
      </div>
      <div className="source-card-actions" aria-label={`${source.name||'内容源'}操作`}>
        <button type="button" className={source.isActive?'primary source-action':'secondary source-action'} disabled={isUnsupported||source.isActive} onClick={()=>onActive?.(source.sourceId)}>
          {source.isActive?'当前使用':isUnsupported?'待适配':'设为当前'}
        </button>
        <button type="button" className="secondary source-action" disabled={isTesting||isUnsupported} onClick={()=>onTest?.(source)}>
          {isTesting?<><RefreshCw className="source-testing-icon" size={14}/>测试中</>:isUnsupported?'暂不可测':'测试'}
        </button>
        <button type="button" className={`source-toggle ${isEnabled?'is-on':''}`} role="switch" aria-checked={isEnabled} aria-label={isEnabled?'停用源':'启用源'} onClick={()=>onEnabled?.(source.sourceId,!isEnabled)}>
          <span className="source-toggle-track"><span/></span><span>{isEnabled?'启用中':'已停用'}</span>
        </button>
        <button type="button" className="icon-button source-delete" onClick={()=>setRemoveId(source.sourceId)} aria-label={`删除${source.name||'内容源'}`} title="删除源"><Trash2 size={16}/></button>
      </div>
    </article>;
  })}
  {!sources.length&&<div className="source-empty-state"><div className="source-empty-icon"><Server size={20}/></div><b>{emptyText}</b><span>{emptyText==='未找到匹配的源'?'试试更短的关键词，或切换源类型。':'添加源或导入配置后，源列表会显示在这里。'}</span></div>}
  {removeSource&&<ConfirmDialog title={`确定删除“${removeSource.name||'未命名源'}”吗？`} text="删除后，该源将从源列表中移除。" onCancel={()=>setRemoveId(null)} onConfirm={()=>{onRemove?.(removeSource.sourceId);setRemoveId(null)}}/>}
  </div>;
}
const SourceForm=({value,onCancel,onSave})=>{
  const [name,setName]=useState(value.name);
  const [url,setUrl]=useState(value.url||'');
  const [sourceType,setSourceType]=useState(value.sourceType);
  const [liveMode,setLiveMode]=useState(value.liveMode||'tv1');
  const [localFileSources,setLocalFileSources]=useState(null);
  const [fileStatus,setFileStatus]=useState('');
  const handleFile=async(e)=>{
    const file=e.target.files?.[0];
    if(!file)return;
    try {
      const parsedSources = await sourceConfigService.parseLocalFile(file);
      setLocalFileSources(parsedSources);
      setUrl('');
      const fileName = file.name.replace(/\.[^.]+$/, '');
      if(!name) setName(fileName);
      if(parsedSources.length === 1) setSourceType(parsedSources[0].sourceType);
      setFileStatus(parsedSources.length > 1 ? `已识别为 ${parsedSources.length} 个源，保存后会一次性加入` : '本地文件已读取，将直接使用文件内容');
    } catch (err) {
      setLocalFileSources(null);
      setFileStatus(`文件读取失败：${err?.message || '格式无效'}`);
      console.error('File read failed', err);
    } finally {
      e.target.value='';
    }
  };
  const handleSave=async()=>{
    if (localFileSources?.length) {
      await onSave(localFileSources);
      return;
    }
    const rawInput = url.trim();
    const finalName = name.trim();
    const isLiveText = /#genre#/i.test(rawInput) || /^#EXTM3U/i.test(rawInput)
      || (sourceType === 'live' && !/^https?:\/\//i.test(rawInput) && /[,，]\s*(?:https?|rtmp|rtsp):\/\//i.test(rawInput));
    const isJSONText = /^\s*[\[{]/.test(rawInput);
    if (isLiveText || isJSONText) {
      try {
        const extension = isLiveText ? 'txt' : 'json';
        const parsedSources = await sourceConfigService.parseText(rawInput, {
          fileName: `${finalName || (isLiveText ? '自定义直播源' : '自定义影视源')}.${extension}`,
        });
        await onSave(parsedSources);
        return;
      } catch (error) {
        setFileStatus(`内容解析失败：${error?.message || '格式无效'}`);
        console.error('Pasted source parse failed', error);
        return;
      }
    }
    const finalType = sourceType;
    onSave({
      name: finalName || (finalType === 'live' ? '自定义直播源' : '自定义影视源'),
      url: rawInput,
      sourceType: finalType,
      ...(finalType === 'live' ? { liveMode } : {}),
    });
  };
  return <div className="modal-backdrop source-form-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onCancel()}}>
    <div className="modal source-form-modal" role="dialog" aria-modal="true" aria-labelledby="source-form-title" onMouseDown={event=>event.stopPropagation()}>
      <div className="source-form-heading"><div><span className="eyebrow">SOURCE SETUP</span><b id="source-form-title">添加内容源</b></div><button type="button" className="icon-button" aria-label="关闭添加源" onClick={onCancel}><X size={17}/></button></div>
      <div className="source-form-hint"><Info size={15}/><span>输入网络 URL、粘贴 JSON / #genre# 文本，或从本地选择 TXT、M3U、JSON 文件。</span></div>
      <label className="source-form-field"><span>源名称 <small>选填</small></span><input value={name} onChange={event=>setName(event.target.value)} placeholder="例如：家庭影视源" autoComplete="off"/></label>
      <div className="source-form-field">
        <label htmlFor="source-content-input">源地址或配置内容</label>
        <textarea id="source-content-input" className="source-content-input" rows={5} value={url} onChange={event=>{
          const val=event.target.value;
          setUrl(val);
          setLocalFileSources(null);
          setFileStatus('');
          if(val.includes('#genre#')||/^#EXTM3U/i.test(val.trim())){
            setSourceType('live');
            if(val.includes('#genre#'))setLiveMode('tv1');
          }
        }} placeholder={"https://example.com/api.php/provide/vod/\n或粘贴 JSON、M3U、#genre# 直播源内容"} spellCheck={false}/>
        <div className="source-form-file-row"><span>也可以直接导入本地文件</span><label className="secondary source-file-button"><Upload size={15}/> 选择文件<input type="file" accept=".txt,.m3u,.json,text/plain,application/json" hidden onChange={handleFile}/></label></div>
      </div>
      <div className="source-form-selects">
        <label className="source-form-field"><span>源类型</span><select value={sourceType} onChange={event=>setSourceType(event.target.value)} disabled={Boolean(localFileSources?.length)}><option value="movie">影视源</option><option value="live">Live 源</option></select></label>
        {sourceType==='live'&&<label className="source-form-field"><span>直播模式</span><select value={liveMode} onChange={event=>setLiveMode(event.target.value)} disabled={Boolean(localFileSources?.length)}><option value="generic">通用 Live 兼容入口</option><option value="tv1">TV1 专用直播（#genre# TXT）</option></select></label>}
      </div>
      <div className={`source-form-status ${fileStatus?'has-message':''}`} role={fileStatus?'status':undefined}>{fileStatus||'保存前会按源内容类型进行识别与校验。'}</div>
      <div className="actions source-form-actions"><button type="button" className="secondary" onClick={onCancel}>取消</button><button type="button" className="primary" disabled={!localFileSources?.length&&!url.trim()} onClick={handleSave}>保存源</button></div>
    </div>
  </div>;
};
const ConfirmDialog=({title,text,onCancel,onConfirm})=><div className="modal-backdrop"><div className="modal"><b>{title}</b>{text&&<p style={{fontSize:13,color:'#666',marginTop:6,marginBottom:12,lineHeight:1.4}}>{text}</p>}<div className="actions"><button className="secondary" onClick={onCancel}>取消</button><button className="primary" style={{background:'#e53935',borderColor:'#e53935',color:'#fff'}} onClick={onConfirm}>确认</button></div></div></div>;
const Page=({children})=><main className="page">{children}</main>;
const Header=({title})=><header><div><span className="eyebrow">TVBOX REACT</span><h2>{title}</h2></div></header>;
const SectionTitle=({title})=><div className="section-title"><h3>{title}</h3></div>;
const InfoCard=({title,text})=><div className="info-card"><Info size={18}/><div><b>{title}</b><span>{text}</span></div></div>;
const Empty=({text})=><div className="empty"><Film size={22}/><span>{text}</span></div>;
const MovieGrid=React.memo(function MovieGrid({movies,onMovie}){return <div className="movie-grid">{movies.map(movie=><article className="movie-card" key={movie.contentId} onClick={()=>onMovie(movie)}><SmartImage src={movie.poster} alt={movie.title}/><div><b>{movie.title}</b><span>{movie.year} · {movie.category}</span></div></article>)}</div>});
const cycle=(value,values)=>{const index=values.indexOf(value);return values[(index+1)%values.length]};
const rotateOrder=(order=['ijk','exo','native'])=>{const normalized=['ijk','exo','native'].filter(item=>order?.includes(item));const safe=normalized.length===3?normalized:['ijk','exo','native'];return [...safe.slice(1),safe[0]]};
const nextSource=(sources,type,current)=>{const list=sources.filter(source=>source.sourceType===type&&source.enabled!==false);if(!list.length)return null;const ids=[null,...list.map(source=>source.sourceId)];const index=Math.max(0,ids.indexOf(current));return ids[(index+1)%ids.length]??null};
const sourceSettingLabel=(sources,type,id)=>sources.find(source=>source.sourceType===type&&source.sourceId===id)?.name||'自动选择';
const Menu=({icon:Icon,title,onClick,badge})=><button className="menu" onClick={onClick}><Icon size={19}/><span>{title}</span>{badge>0&&<em>{badge}</em>}<ChevronLeft className="flip" size={17}/></button>;
const SettingMenu=({icon:Icon,title,value,onClick})=><button className="menu setting-menu" onClick={onClick}><Icon size={19}/><span>{title}<small>{value}</small></span><ChevronLeft className="flip" size={17}/></button>;

function FontPickerDialog({value,onCancel,onApply}){
 const [draft,setDraft]=useState(value||FONT_CATALOG[0].id);
 const [loading,setLoading]=useState(false);
 const selected=getFontById(draft);
 const choose=async(font)=>{setDraft(font.id);setLoading(true);await ensureFont(font);setLoading(false);};
 return <div className="modal-backdrop font-picker-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onCancel()}}>
   <div className="font-picker-modal" role="dialog" aria-modal="true" aria-label="选择字体">
     <div className="font-picker-head">
       <div><b>选择字体</b><small>18 款轻量中文字体 · 单选</small></div>
       <button className="icon-button" type="button" aria-label="关闭" onClick={onCancel}><X size={17}/></button>
     </div>
     <div className="font-picker-preview" style={{fontFamily:'"' + selected.family + '",sans-serif'}}>
       <span>预览</span><b>风起时，花落无声。山水相映，清晰易读。</b>
     </div>
     <div className="font-picker-list" role="radiogroup" aria-label="中文字体列表">
       {FONT_CATALOG.map(font=>{
         const checked=draft===font.id;
         return <button key={font.id} type="button" role="radio" aria-checked={checked} className={'font-picker-item'+(checked?' selected':'')} onClick={()=>choose(font)} style={{fontFamily:'"' + font.family + '",sans-serif'}}>
           <span className="font-picker-copy"><b>{font.name}</b><small>{font.alias} · {font.style}</small></span>
           <span className={'font-picker-radio'+(checked?' checked':'')} aria-hidden="true">{checked&&<Check size={12}/>}</span>
         </button>;
       })}
     </div>
     <div className="font-picker-footer">
       <small>{selected.source} · {selected.license}{loading?' · 正在加载预览…':''}</small>
       <div><button className="secondary" type="button" onClick={onCancel}>不选</button><button className="primary" type="button" onClick={()=>onApply(draft)}>选择</button></div>
     </div>
   </div>
 </div>;
}
export {MyPage};
