import React, { useState } from 'react';
import { ChevronLeft, Clock3, Database, Film, Info, Radio, Search, Server, Settings, Trash2, Check, Download, Upload, X, CheckSquare, Square, Power, PowerOff, RefreshCw, Layers } from 'lucide-react';
import { SmartImage } from '../shared__components__StateViews.jsx';
import { sourceConfigService } from './sourceManagement.js';
import { multiRepoService } from './repositoryManagement.js';
import { MultiRepoManager } from './MultiRepoManager.jsx';
import { RepoDetailView } from './RepoDetailView.jsx';
import { FONT_CATALOG, getFontById } from './preferences.js';
import { ensureFont } from './preferences.js';
import { PLAYBACK_SCHEMES, getPlaybackScheme, getPlaybackSchemeId } from '../core__models__userData.js';

function MyPage({tab,movies,channels,favorites,history,sources,searches,progress,settings,onTab,onMovie,onLive,onLiveChannel,onSearchHistory,toggleFavorite,onClearData,onClearHistory,onSaveSources,onClearSearches,onRemoveSearch,onClearCache,onSourceEnabled,onSourceActive,onTestSource,onRemoveSource,onClearAllSources,onUpdateSettings}){
 const [fontPicker,setFontPicker]=useState(false);
 const [confirm,setConfirm]=useState(null); const [sourceForm,setSourceForm]=useState(null); const [batchMode,setBatchMode]=useState(false); const [sourceNotice,setSourceNotice]=useState('');
 const [multiRepoMode,setMultiRepoMode]=useState(false); const [inspectingRepo,setInspectingRepo]=useState(null); const [isSyncingSingle,setIsSyncingSingle]=useState(false);
 if(tab==='history'){
  const historyMovies=history.filter(i=>i.targetType==='content').map(item=>({item,movie:movies.find(m=>m.contentId===item.targetId)||null}));
  const historyChannels=history.filter(i=>i.targetType==='channel').map(i=>channels.find(c=>c.channelId===i.targetId)).filter(Boolean);
  return <Page><Header title="播放历史"/>{historyMovies.length?<div className="movie-grid">{historyMovies.filter(({movie})=>movie).map(({movie,item})=>{const ep=movie.episodes?.find(e=>e.episodeId===item.episodeId);const pct=item.durationSeconds?Math.min(100,Math.round(item.positionSeconds/item.durationSeconds*100)):0;return <article className="movie-card history-card" key={item.historyId} onClick={()=>onMovie(movie)}><SmartImage src={movie.poster} alt={movie.title}/><div><b>{movie.title}</b><span>{ep?.title??'继续观看'} · {pct}%</span><small>最近观看：{new Date(item.lastPlayedAt||Date.now()).toLocaleString()}</small></div></article>})}</div>:<Empty text="还没有播放历史"/>}{historyMovies.filter(({movie})=>!movie).map(({item})=><div className="info-card" key={item.historyId}><Database size={18}/><div><b>暂时无法找到来源</b><span>播放历史已保留：{item.targetId}</span></div></div>)}{historyChannels.length>0&&<><SectionTitle title="Live"/><div className="channel-list">{historyChannels.map(c=><button className="menu" key={c.channelId} onClick={()=>onLiveChannel(c)}><Radio size={18}/><span>{c.name}<small>{c.category}</small></span><ChevronLeft className="flip" size={17}/></button>)}</div></>}</Page>;
 }
 if(tab==='search-history') return <Page><Header title="搜索历史"/><div className="actions"><button className="secondary" disabled={!searches.length} onClick={()=>setConfirm({type:'searches'})}>清空搜索历史</button></div><div className="history-list">{searches.map(i=><div className="menu" key={i.searchId}><Search size={18}/><button className="history-keyword" onClick={()=>onSearchHistory(i.keyword)}>{i.keyword}</button><em>{i.count} 次</em><button className="icon-button" aria-label="删除历史" onClick={()=>setConfirm({type:'search',id:i.searchId})}>×</button></div>)}{!searches.length&&<Empty text="还没有搜索历史"/>}</div>{confirm&&<ConfirmDialog title={confirm.type==='searches'?'清空搜索历史？':'删除这条搜索历史？'} onCancel={()=>setConfirm(null)} onConfirm={()=>{if(confirm.type==='searches')onClearSearches();else onRemoveSearch(confirm.id);setConfirm(null)}}/>}</Page>;
  if(tab==='sources') return <Page><Header title="源管理"/>
    <div style={{
      background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7), rgba(15, 23, 42, 0.9))',
      border: '1px solid #334155',
      borderRadius: 16,
      padding: '14px 16px',
      marginBottom: 14,
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: 12, background: 'rgba(56,189,248,0.15)', display: 'grid', placeItems: 'center', color: '#38bdf8' }}>
            <Layers size={20} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <b style={{ fontSize: 15, color: '#f8fafc' }}>多仓订阅与单仓聚合</b>
              <span style={{ fontSize: 10, background: 'rgba(56,189,248,0.2)', color: '#38bdf8', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>PRO</span>
            </div>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>支持多仓导入 · Punycode 中文转码 · 主备地址回退 · 智能重试 · Sites Key 自动去重合并</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="primary" onClick={()=>setMultiRepoMode(true)} style={{ padding: '8px 14px', fontSize: 12 }}>
            <Layers size={14}/> 进入多仓工作台 (第二界面)
          </button>
        </div>
      </div>
    </div>

    <div className="actions" style={{ marginTop: 0, marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <button className="secondary" onClick={()=>setMultiRepoMode(true)} title="管理多仓订阅与单仓聚合">
        <Layers size={15}/> 多仓管理
      </button>
      <button className="secondary" onClick={()=>{setSourceNotice('');setSourceForm({sourceType:'live',name:''})}}>
        添加单源
      </button>
      <button className="secondary" onClick={()=>setBatchMode(true)}>
        <CheckSquare size={15}/> 批量管理
      </button>
      <label className="secondary file-button">
        <Upload size={15}/> 导入单仓
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
      <button className="secondary" onClick={()=>{
        try{
          sourceConfigService.download(sources);
          setSourceNotice('源配置已导出');
        }catch(e){
          console.error(e);
          setSourceNotice(`导出失败：${e?.message||'未知错误'}`);
        }
      }}>
        <Download size={15}/> 导出
      </button>
      <button className="secondary" title="恢复项目内置的精品影视与直播源" onClick={async ()=>{
        if(window.confirm('确定要恢复项目自带的默认源吗？这不会删除您手动添加的源。')){
          try{
            const defaults=sourceConfigService.getDefaultSources();
            const existing=new Set(sources.map(s=>`${s.sourceType}|${s.sourceRef||s.url||''}`));
            const additions=defaults.filter(d=>!existing.has(`${d.sourceType}|${d.sourceRef||d.url||''}`));
            await onSaveSources([...sources,...additions]);
            setSourceNotice(additions.length?`已恢复 ${additions.length} 个内置源`:'内置源已经存在，无需重复添加');
          }catch(e){
            console.error(e);
            setSourceNotice(`恢复内置源失败：${e?.message||'未知错误'}`);
          }
        }
      }}>
        恢复内置
      </button>
      <button className="secondary danger" style={{color:'#e53935',borderColor:'#f8d7da',background:'#fdf2f2',marginLeft:'auto'}} onClick={()=>setConfirm({type:'clear-all-sources'})} title="彻底清空源与缓存">
        <Trash2 size={15}/> 清空全部
      </button>
    </div>

    {sourceNotice&&<div className="batch-source-notice" role="status">{sourceNotice}</div>}

    <><SectionTitle title={`影视源 (${sources.filter(s=>s.sourceType==='movie').length})`}/><SourceList sources={sources.filter(s=>s.sourceType==='movie')} onEnabled={onSourceEnabled} onActive={onSourceActive} onTest={onTestSource} onRemove={onRemoveSource}/><SectionTitle title={`Live 源 (${sources.filter(s=>s.sourceType==='live').length})`}/><SourceList sources={sources.filter(s=>s.sourceType==='live')} onEnabled={onSourceEnabled} onActive={onSourceActive} onTest={onTestSource} onRemove={onRemoveSource}/></>

    <InfoCard title="源边界与多仓聚合" text="影视源与 Live 源独立管理。支持网络 URL、多仓聚合单仓导入、标准 JSON、M3U 播放列表以及 #genre# 分类 TXT 电视直播源文件，导入与运行时状态分离。"/>

    {confirm?.type==='clear-all-sources'&&<ConfirmDialog title="彻底清空所有源与缓存？" text="此操作将彻底删除源管理中的全部影视源与 Live 直播源（包括项目自带内置源），并清理全量本地数据与播放缓存，保证不留残余。确定清空吗？" onCancel={()=>setConfirm(null)} onConfirm={async ()=>{setConfirm(null);await onClearAllSources?.();}}/>}

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
  const decoder=playback.decoder??{};
  const updatePlayback=(patch={})=>onUpdateSettings?.({
    playback:{
      ...playback,
      ...patch,
      decoder:{...(playback.decoder??{}),...(patch.decoder??{})},
    },
  });
  const resolveScheme=(scope)=>getPlaybackScheme(
    playback[scope+'PlaybackScheme'] || getPlaybackSchemeId(
      playback[scope+'Player'] || 'ijk',
      playback.decoder?.[playback[scope+'Player'] || 'ijk'] || 'hardware',
    ),
  );
  const applyScheme=(scope, schemeId)=>{
    const scheme=getPlaybackScheme(schemeId);
    updatePlayback({
      [scope+'Player']:scheme.engine,
      [scope+'PlaybackScheme']:scheme.id,
      decoder:{[scheme.engine]:scheme.decoder},
    });
  };
  const nextScheme=(scope)=>{
    const current=resolveScheme(scope);
    const index=PLAYBACK_SCHEMES.findIndex(item=>item.id===current.id);
    return PLAYBACK_SCHEMES[(index+1)%PLAYBACK_SCHEMES.length];
  };
  const order=(playback.fallbackOrder??['ijk','exo','native']).join(' → ');
  const movieScheme=resolveScheme('movie');
  const liveScheme=resolveScheme('live');
  return <Page><Header title="设置"/>
   <SectionTitle title="播放设置"/>
   <SettingMenu icon={Radio} title="自动继续播放" value={settings?.autoplayResume?'开启':'关闭'} onClick={()=>onUpdateSettings?.({autoplayResume:!settings?.autoplayResume})}/>
   <SettingMenu icon={Radio} title="默认影视播放方案" value={movieScheme.label} onClick={()=>applyScheme('movie',nextScheme('movie').id)}/>
   <SettingMenu icon={Radio} title="默认直播播放方案" value={liveScheme.label} onClick={()=>applyScheme('live',nextScheme('live').id)}/>
   <SettingMenu icon={Radio} title="失败自动切换" value={playback.fallbackEnabled===false?'关闭':'开启'} onClick={()=>updatePlayback({fallbackEnabled:playback.fallbackEnabled===false})}/>
   <SettingMenu icon={Radio} title="切换顺序" value={order} onClick={()=>updatePlayback({fallbackOrder:rotateOrder(playback.fallbackOrder)})}/>
   <InfoCard title="可选播放方案" text={PLAYBACK_SCHEMES.map(item=>item.label).join(' · ') + '。默认方案为 IJKPlayer 硬解；点击默认影视/直播播放方案可循环选择。Native 仍只作为内部故障兜底，不作为用户播放方案入口。'}/>
   <SectionTitle title="解码设置"/>
   <InfoCard title="四种用户播放方案" text="IJKPlayer 硬解 · ExoPlayer 硬解 · ExoPlayer 软解 · IJKPlayer 软解。默认使用 IJKPlayer 硬解；影视与直播分别记忆各自方案，播放器内的“线路与解码”入口也可随时切换。Native/System 仅作为内部故障兜底。"/>
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
function SourceList({sources,onEnabled,onActive,onTest,onRemove}){
  const [removeId,setRemoveId]=useState(null);
  const removeSource=sources.find(source=>source.sourceId===removeId);
  return <div className="source-list">{sources.map((source, index)=>{
    const isTesting = source.status === '测试中';
    const capability = String(source.sourceCapability || '').trim();
    const tvboxKind = String(source.tvboxAdapterKind || '').trim().toLowerCase();
    const safeExtFormats = new Set(['json-vod', 'remote-json', 'remote-resource', 'inline-json']);
    const runtimeSupported = capability === 'tvbox-jar'
      || capability === 'tvbox-http-vod-with-jar'
      || (capability === 'tvbox-ext' && tvboxKind === 'ext' && safeExtFormats.has(String(source.tvboxExtFormat || '').trim()));
    const isUnsupported = (capability.startsWith('tvbox-') || String(source.adapterType || '').startsWith('tvbox-')) && !runtimeSupported;
    const capabilityLabel = source.tvboxAdapterKind === 'drpy-js' ? 'Drpy JS待适配'
      : source.tvboxAdapterKind === 'csp' ? 'CSP待适配'
      : source.tvboxAdapterKind === 'jar' || source.tvboxAdapterKind === 'http-vod-with-jar' ? (runtimeSupported ? 'JAR执行器' : 'JAR待适配')
      : source.tvboxAdapterKind === 'ext' ? (runtimeSupported ? '安全JSON EXT' : 'ext待适配')
      : source.tvboxAdapterKind === 'live-provider' ? 'Live提供器待适配'
      : isUnsupported ? 'TVBox扩展待适配' : '';
    const statusColor = (source.status==='正常'||source.status==='可用') ? '#22c55e' : (source.status==='不可用'||source.status==='异常') ? '#f87171' : isTesting ? '#38bdf8' : '#94a3b8';
    return (
      <article className="source-card" key={`${source.sourceId || 'src'}_${index}`}>
        <div className="source-card-main">
          <div className="source-card-icon"><Server size={19}/></div>
          <div className="source-card-info">
            <b title={source.name}>{source.name}</b>
            <small>
              {source.sourceType}{source.liveMode==='tv1'?' · TV1专用':''} ·
              <span style={{color: statusColor, fontWeight: 600}}> {source.status}</span>
              {isUnsupported && <span style={{color:'#f59e0b',fontWeight:600}}> · {capabilityLabel}</span>}
              {source.isActive?' · 当前使用':''}
            </small>
          </div>
        </div>
        <div className="source-card-actions" aria-label="源操作">
          <button className={source.isActive?'primary':'secondary'} disabled={isUnsupported} onClick={()=>onActive?.(source.sourceId)}>
            {source.isActive?'当前使用':isUnsupported?'待适配':'设为当前'}
          </button>
          <button className="secondary" disabled={isTesting||isUnsupported} onClick={()=>onTest(source)}>
            {isTesting?'测试中…':isUnsupported?'暂不可测':'测试'}
          </button>
          <button className="secondary source-action" onClick={()=>onEnabled(source.sourceId,!source.enabled)} aria-label={source.enabled?'停用源':'启用源'}>
            {source.enabled?<><Check size={15}/>停用</>:<>启用</>}
          </button>
          <button className="icon-button source-delete" onClick={()=>setRemoveId(source.sourceId)} aria-label="删除源" title="删除源"><X size={17}/></button>
        </div>
      </article>
    );
  })}
  {!sources.length&&<Empty text="暂无内容源"/>}
  {removeSource&&<ConfirmDialog
    title={`确定删除“${removeSource.name}”吗？`}
    onCancel={()=>setRemoveId(null)}
    onConfirm={()=>{onRemove(removeSource.sourceId);setRemoveId(null)}}
  />}
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
  return <div className="modal-backdrop"><div className="modal">
    <b>添加内容源</b>
    <div className="info-card" style={{marginTop:0,marginBottom:10,padding:10}}>
      <Info size={14}/>
      <span style={{fontSize:11}}>支持输入网络 URL、直接粘贴带 #genre# 文本或选择本地 .txt / .m3u / .json 文件。</span>
    </div>
    <input value={name} onChange={e=>setName(e.target.value)} placeholder="源名称（选填）"/>
    <div style={{display:'flex',gap:8}}>
      <input style={{flex:1}} value={url} onChange={e=>{
        const val = e.target.value;
        setUrl(val);
        if (val.includes('#genre#') || val.startsWith('#EXTM3U')) {
          setSourceType('live');
          if (val.includes('#genre#')) setLiveMode('tv1');
        }
      }} placeholder="源地址 URL 或直接粘贴文本数据"/>
      <label className="secondary modal-upload-btn" title="选择本地文件">
        <Upload size={16}/>
        <input type="file" accept=".txt,.m3u,.json,text/plain,application/json" hidden onChange={handleFile}/>
      </label>
    </div>
    <select value={sourceType} onChange={e=>setSourceType(e.target.value)} disabled={Boolean(localFileSources?.length)}>
      <option value="movie">影视源</option>
      <option value="live">Live 源</option>
    </select>
    {sourceType==='live' && <select value={liveMode} onChange={e=>setLiveMode(e.target.value)} disabled={Boolean(localFileSources?.length)}><option value="generic">通用 Live 兼容入口</option><option value="tv1">TV1 专用直播（#genre# TXT）</option></select>}
    <div style={{fontSize:11,color:'#8f9aaa',minHeight:16}}>{fileStatus}</div>
    <div className="actions">
      <button className="secondary" onClick={onCancel}>取消</button>
      <button className="primary" disabled={!localFileSources?.length && !url.trim()} onClick={handleSave}>保存</button>
    </div>
  </div></div>;
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
