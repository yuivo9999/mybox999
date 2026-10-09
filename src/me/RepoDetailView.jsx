import React, { useState } from 'react';
import { ArrowLeft, CheckCircle2, XCircle, AlertTriangle, RefreshCw, Search, Globe, Shield, Terminal, Tv, Code2, ExternalLink, Copy, Check } from 'lucide-react';

export function RepoDetailView({ repo, onBack, onSync, isSyncing }) {
  const [activeTab, setActiveTab] = useState('sites');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterKind, setFilterKind] = useState('all');
  const [copied, setCopied] = useState(false);

  if (!repo) return null;

  const rawConfig = repo.config || {};
  const sites = Array.isArray(rawConfig.sites) ? rawConfig.sites : [];
  const lives = Array.isArray(rawConfig.lives) ? rawConfig.lives : [];
  const parses = Array.isArray(rawConfig.parses) ? rawConfig.parses : [];
  const flags = Array.isArray(rawConfig.flags) ? rawConfig.flags : [];
  const rules = Array.isArray(rawConfig.rules) ? rawConfig.rules : [];
  const attempts = Array.isArray(repo.attempts) ? repo.attempts : [];

  const filteredSites = sites.filter(site => {
    const nameMatch = !searchQuery || String(site.name || '').toLowerCase().includes(searchQuery.toLowerCase())
      || String(site.key || '').toLowerCase().includes(searchQuery.toLowerCase())
      || String(site.api || '').toLowerCase().includes(searchQuery.toLowerCase());
    if (!nameMatch) return false;

    if (filterKind === 'all') return true;
    if (filterKind === 'jar') return site.jar != null || site.type === 3;
    if (filterKind === 'vod') return site.type === 1 || site.type === 0;
    if (filterKind === 'csp') return String(site.api || '').startsWith('csp_');
    if (filterKind === 'ext') return site.ext != null;
    return true;
  });

  const handleCopyJson = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(JSON.stringify(rawConfig, null, 2));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (e) {
      console.warn('Copy failed', e);
    }
  };

  return (
    <div className="modal-backdrop batch-source-backdrop" role="dialog" aria-modal="true" aria-label={`${repo.name} 详情`}>
      <div className="batch-source-modal repo-detail-modal" style={{ width: 'min(840px, calc(100vw - 20px))', maxHeight: '92vh' }}>
        {/* Breadcrumb Header */}
        <div className="batch-source-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border, #303744)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="icon-button" onClick={onBack} title="返回多仓管理" aria-label="返回">
              <ArrowLeft size={18} />
            </button>
            <div className="breadcrumb-nav">
              <span style={{ fontSize: 11, color: '#8f9aaa', letterSpacing: '0.08em' }}>源管理 / 多仓管理 / </span>
              <h3 style={{ margin: 0, fontSize: 18, color: '#f3f4f6', display: 'inline' }}>{repo.name}</h3>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="secondary" onClick={() => onSync(repo.id)} disabled={isSyncing} style={{ padding: '8px 12px', fontSize: 12 }}>
              <RefreshCw size={14} className={isSyncing ? 'spin' : ''} />
              {isSyncing ? '同步中…' : '重新拉取'}
            </button>
            <button className="icon-button" onClick={onBack} title="关闭" aria-label="关闭">
              ✕
            </button>
          </div>
        </div>

        <div style={{ padding: '16px 18px', overflowY: 'auto', flex: '1 1 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Status & Fallback Overview Banner */}
          <div style={{ padding: '14px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: 14, border: '1px solid var(--border, #303744)', display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Globe size={18} color="#38bdf8" />
                <b style={{ fontSize: 15 }}>{repo.name}</b>
                <span style={{
                  padding: '2px 8px', borderRadius: 999, fontSize: 11,
                  background: repo.status === 'success' ? 'rgba(34,197,94,0.15)' : repo.status === 'syncing' ? 'rgba(56,189,248,0.15)' : 'rgba(239,68,68,0.15)',
                  color: repo.status === 'success' ? '#4ade80' : repo.status === 'syncing' ? '#38bdf8' : '#f87171',
                }}>
                  {repo.status === 'success' ? '同步成功' : repo.status === 'syncing' ? '拉取中' : '同步失败'}
                </span>
                {repo.durationMs && <span style={{ fontSize: 11, color: '#94a3b8' }}>耗时 {repo.durationMs}ms</span>}
              </div>
              <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#cbd5e1' }}>
                <span>影视站点: <b>{sites.length}</b></span>
                <span>直播源: <b>{lives.length}</b></span>
                <span>解析器: <b>{parses.length}</b></span>
              </div>
            </div>

            {repo.usedUrl && (
              <div style={{ fontSize: 12, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span>命中地址:</span>
                <code style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: 6, color: '#38bdf8', wordBreak: 'break-all' }}>{repo.usedUrl}</code>
                {repo.punycodeUrl && repo.punycodeUrl !== repo.usedUrl && (
                  <span style={{ color: '#a78bfa', fontSize: 11 }}>
                    (Punycode 自动转码: {repo.punycodeUrl})
                  </span>
                )}
              </div>
            )}

            {repo.errorMessage && (
              <div style={{ fontSize: 12, color: '#f87171', background: 'rgba(239,68,68,0.1)', padding: '8px 12px', borderRadius: 8 }}>
                错误信息: {repo.errorMessage}
              </div>
            )}
          </div>

          {/* Fallback & Retry Monitor Log */}
          <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border, #303744)', borderRadius: 14, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Shield size={16} color="#fbbf24" />
              <b style={{ fontSize: 13, color: '#e2e8f0' }}>多地址回退与智能重试日志</b>
              <small style={{ color: '#8f9aaa', fontSize: 11 }}>(按顺序尝试主/备用地址 · 瞬态超时退避重试 · 4xx/5xx确定性跳过)</small>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {attempts.length > 0 ? attempts.map((att, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '9px 12px', borderRadius: 10,
                  background: att.ok ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.06)',
                  border: att.ok ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(239,68,68,0.2)',
                  gap: 12, flexWrap: 'wrap',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                    {att.ok ? <CheckCircle2 size={16} color="#4ade80" /> : <XCircle size={16} color="#f87171" />}
                    <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: att.isPrimary ? '#60a5fa' : '#94a3b8' }}>
                          {att.isPrimary ? '主地址' : `备用地址 ${i}`}
                        </span>
                        <code style={{ fontSize: 12, color: '#f1f5f9', wordBreak: 'break-all' }}>{att.url}</code>
                      </div>
                      {att.punycodeUrl && att.punycodeUrl !== att.url && (
                        <small style={{ color: '#c084fc', fontSize: 11 }}>Punycode: {att.punycodeUrl}</small>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: '#94a3b8' }}>
                    {att.retryCount > 0 && <span style={{ color: '#f59e0b' }}>已重试 {att.retryCount} 次</span>}
                    <span>{att.durationMs}ms</span>
                    <span style={{
                      padding: '2px 6px', borderRadius: 6, fontWeight: 600,
                      background: att.ok ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)',
                      color: att.ok ? '#4ade80' : '#f87171',
                    }}>
                      {att.ok ? '200 OK (命中)' : att.status ? `HTTP ${att.status}` : att.error || '失败'}
                    </span>
                  </div>
                </div>
              )) : (
                <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: '12px' }}>
                  主地址: {repo.primaryUrl} {repo.backupUrls?.length ? `· 备用地址: ${repo.backupUrls.length} 个` : ''} (点击“重新拉取”执行回退探测)
                </div>
              )}
            </div>
          </div>

          {/* Tab Navigation for Detailed Content */}
          <div className="seg" style={{ margin: '4px 0 0', display: 'flex', gap: 8 }}>
            <button className={activeTab === 'sites' ? 'active' : ''} onClick={() => setActiveTab('sites')}>
              影视站点 ({sites.length})
            </button>
            <button className={activeTab === 'lives' ? 'active' : ''} onClick={() => setActiveTab('lives')}>
              直播频道 ({lives.length})
            </button>
            <button className={activeTab === 'parses' ? 'active' : ''} onClick={() => setActiveTab('parses')}>
              解析与规则 ({parses.length})
            </button>
            <button className={activeTab === 'rawJson' ? 'active' : ''} onClick={() => setActiveTab('rawJson')}>
              配置明细 JSON
            </button>
          </div>

          {/* TAB 1: Sites List */}
          {activeTab === 'sites' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <div className="searchbox" style={{ flex: 1, minWidth: 200, margin: 0, height: 40 }}>
                  <Search size={16} />
                  <input
                    type="text"
                    placeholder="搜索站点名称 / Key / API 地址…"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} style={{ color: '#888' }}>✕</button>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, fontSize: 11 }}>
                  <button className={filterKind === 'all' ? 'primary' : 'secondary'} style={{ padding: '6px 10px', fontSize: 11 }} onClick={() => setFilterKind('all')}>全部</button>
                  <button className={filterKind === 'vod' ? 'primary' : 'secondary'} style={{ padding: '6px 10px', fontSize: 11 }} onClick={() => setFilterKind('vod')}>VOD直连</button>
                  <button className={filterKind === 'jar' ? 'primary' : 'secondary'} style={{ padding: '6px 10px', fontSize: 11 }} onClick={() => setFilterKind('jar')}>JAR Spider</button>
                  <button className={filterKind === 'csp' ? 'primary' : 'secondary'} style={{ padding: '6px 10px', fontSize: 11 }} onClick={() => setFilterKind('csp')}>CSP</button>
                  <button className={filterKind === 'ext' ? 'primary' : 'secondary'} style={{ padding: '6px 10px', fontSize: 11 }} onClick={() => setFilterKind('ext')}>含EXT</button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10, maxHeight: '42vh', overflowY: 'auto' }}>
                {filteredSites.map((site, sIdx) => (
                  <div key={sIdx} style={{
                    padding: '10px 12px', background: 'var(--card-bg, #171b23)', border: '1px solid var(--border, #303744)',
                    borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 6,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <b style={{ fontSize: 13, color: '#f3f4f6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={site.name}>
                        {site.name}
                      </b>
                      <span style={{
                        padding: '1px 6px', borderRadius: 4, fontSize: 10,
                        background: site.type === 3 ? 'rgba(168,85,247,0.15)' : site.type === 1 ? 'rgba(56,189,248,0.15)' : 'rgba(255,255,255,0.08)',
                        color: site.type === 3 ? '#c084fc' : site.type === 1 ? '#38bdf8' : '#94a3b8',
                      }}>
                        {site.type === 3 ? 'JAR' : site.type === 1 ? 'VOD' : `Type ${site.type || 0}`}
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#8f9aaa' }}>
                      <div>Key: <code style={{ color: '#cbd5e1' }}>{site.key}</code></div>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={site.api}>
                        API: <code style={{ color: '#94a3b8' }}>{site.api || '无'}</code>
                      </div>
                      {site.jar && (
                        <div style={{ color: '#a855f7' }}>JAR: {String(site.jar).slice(0, 30)}…</div>
                      )}
                    </div>
                  </div>
                ))}
                {!filteredSites.length && (
                  <div style={{ gridColumn: '1 / -1', padding: '30px', textAlign: 'center', color: '#888' }}>
                    没有匹配的站点
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: Lives List */}
          {activeTab === 'lives' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '42vh', overflowY: 'auto' }}>
              {lives.map((live, lIdx) => {
                const urls = [live.url, ...(Array.isArray(live.urls) ? live.urls : [])].filter(Boolean);
                return (
                  <div key={lIdx} style={{
                    padding: '12px 14px', background: 'var(--card-bg, #171b23)', border: '1px solid var(--border, #303744)',
                    borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 6,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Tv size={16} color="#38bdf8" />
                        <b style={{ fontSize: 14 }}>{live.name || `直播分组 ${lIdx + 1}`}</b>
                      </div>
                      <span style={{ fontSize: 11, color: '#8f9aaa' }}>{urls.length} 条播放地址</span>
                    </div>
                    {urls.map((u, uIdx) => (
                      <div key={uIdx} style={{ fontSize: 11, color: '#cbd5e1', wordBreak: 'break-all' }}>
                        线路 {uIdx + 1}: <code style={{ color: '#38bdf8' }}>{u}</code>
                      </div>
                    ))}
                  </div>
                );
              })}
              {!lives.length && (
                <div style={{ padding: '30px', textAlign: 'center', color: '#888' }}>
                  该仓未配置直播 (lives)
                </div>
              )}
            </div>
          )}

          {/* TAB 3: Parses & Rules */}
          {activeTab === 'parses' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '42vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <b style={{ fontSize: 13, color: '#cbd5e1' }}>视频解析器 (Parses: {parses.length})</b>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
                  {parses.map((p, pIdx) => (
                    <div key={pIdx} style={{
                      padding: '8px 10px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border, #303744)',
                      borderRadius: 10, fontSize: 11,
                    }}>
                      <div style={{ fontWeight: 700, color: '#f1f5f9' }}>{p.name || `解析 ${pIdx + 1}`}</div>
                      <code style={{ color: '#38bdf8', wordBreak: 'break-all' }}>{p.url}</code>
                    </div>
                  ))}
                  {!parses.length && <small style={{ color: '#888' }}>无解析器</small>}
                </div>
              </div>

              {flags.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <b style={{ fontSize: 13, color: '#cbd5e1' }}>支持 Flags 标签 ({flags.length})</b>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {flags.map((f, i) => (
                      <span key={i} style={{ padding: '2px 8px', borderRadius: 6, background: 'rgba(56,189,248,0.1)', color: '#38bdf8', fontSize: 11 }}>
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {rules.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <b style={{ fontSize: 13, color: '#cbd5e1' }}>直连与广告规则 ({rules.length})</b>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {rules.map((r, i) => (
                      <span key={i} style={{ padding: '2px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.05)', color: '#94a3b8', fontSize: 11 }}>
                        {r.host || 'rule'}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: Raw JSON */}
          {activeTab === 'rawJson' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '42vh' }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="secondary" onClick={handleCopyJson} style={{ padding: '6px 12px', fontSize: 12 }}>
                  {copied ? <><Check size={14} color="#4ade80" /> 已复制</> : <><Copy size={14} /> 复制配置 JSON</>}
                </button>
              </div>
              <pre style={{
                background: '#0a0d14', border: '1px solid var(--border, #303744)', borderRadius: 12,
                padding: '12px 14px', fontSize: 12, color: '#93c5fd', overflow: 'auto', maxHeight: '35vh',
                margin: 0,
              }}>
                {JSON.stringify(rawConfig, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
