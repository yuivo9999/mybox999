import React, { useState } from 'react';
import { 
  ArrowLeft, Plus, RefreshCw, Layers, CheckSquare, Square, 
  Trash2, Edit3, Eye, Shield, Globe, Download, Upload, AlertCircle, Check, X, FileText
} from 'lucide-react';
import { multiRepoService } from './repositoryManagement.js';
import { toPunycodeUrl } from '../core__utils__punycode.js';

export function MultiRepoManager({ 
  onBack, 
  onSelectRepoDetail, 
  onApplyAggregated, 
  onDownloadAggregated,
  sourceNotice,
  setSourceNotice 
}) {
  const [repos, setRepos] = useState(() => multiRepoService.getAll());
  const [selectedRepoIds, setSelectedRepoIds] = useState(() => multiRepoService.getAll().map(r => r.id));
  const [syncingMap, setSyncingMap] = useState({});
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [aggregatedResult, setAggregatedResult] = useState(() => multiRepoService.getLastAggregated());
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingRepo, setEditingRepo] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [notice, setNotice] = useState(sourceNotice || '');

  // Form states for Add / Edit
  const [formName, setFormName] = useState('');
  const [formPrimaryUrl, setFormPrimaryUrl] = useState('');
  const [formBackupUrls, setFormBackupUrls] = useState('');
  const [batchImportText, setBatchImportText] = useState('');
  const [activeFormTab, setActiveFormTab] = useState('single');

  const reloadRepos = () => {
    const list = multiRepoService.getAll();
    setRepos(list);
  };

  const handleSyncSingle = async (repoId) => {
    setSyncingMap(prev => ({ ...prev, [repoId]: true }));
    setNotice('正在拉取并探测多地址…');
    try {
      const result = await multiRepoService.syncRepo(repoId);
      reloadRepos();
      if (result.ok) {
        setNotice(`“${result.repo.name}” 同步成功（获取到 ${result.repo.siteCount} 个站点）`);
      } else {
        setNotice(`“${result.repo.name}” 同步失败：${result.error || '全部主备地址均不可用'}`);
      }
    } catch (e) {
      setNotice(`同步异常：${e?.message || '未知错误'}`);
    } finally {
      setSyncingMap(prev => ({ ...prev, [repoId]: false }));
    }
  };

  const handleSyncAll = async () => {
    if (isSyncingAll) return;
    setIsSyncingAll(true);
    setNotice('正在并发/顺序拉取所有多仓，自动执行 Punycode 转码、主备地址回退与智能重试…');
    try {
      await multiRepoService.syncAll();
      reloadRepos();
      // Auto-trigger aggregation after full sync
      const agg = multiRepoService.aggregateSelected(selectedRepoIds);
      setAggregatedResult(agg);
      setNotice(`所有多仓同步完成！已生成聚合单仓（包含 ${agg.meta.siteCount} 个影视站点、${agg.meta.liveCount} 个直播源）`);
    } catch (e) {
      setNotice(`批量同步失败：${e?.message || '未知错误'}`);
    } finally {
      setIsSyncingAll(false);
    }
  };

  const handleRunAggregation = () => {
    try {
      const agg = multiRepoService.aggregateSelected(selectedRepoIds);
      setAggregatedResult(agg);
      setNotice(`聚合单仓生成成功！合并 ${agg.meta.siteCount} 个站点，重复 Key 自动添加前缀`);
    } catch (e) {
      setNotice(`聚合失败：${e?.message || '未知错误'}`);
    }
  };

  const handleApplyToSystem = async () => {
    if (!aggregatedResult || !aggregatedResult.sites?.length) {
      setNotice('当前未生成聚合单仓，请先点击“生成聚合单仓”或“一键同步”');
      return;
    }
    try {
      const res = await onApplyAggregated(aggregatedResult);
      setNotice(`聚合单仓已成功应用到播放系统！当前包含 ${res.addedCount} 个源`);
    } catch (e) {
      setNotice(`应用到系统失败：${e?.message || '未知错误'}`);
    }
  };

  const handleExportAggregated = () => {
    if (!aggregatedResult || !aggregatedResult.sites?.length) {
      setNotice('暂无可导出的聚合配置，请先同步并聚合');
      return;
    }
    try {
      onDownloadAggregated(aggregatedResult);
      setNotice('聚合单仓配置已成功导出为 JSON 文件');
    } catch (e) {
      setNotice(`导出失败：${e?.message || '未知错误'}`);
    }
  };

  const toggleSelectRepo = (id) => {
    setSelectedRepoIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    if (selectedRepoIds.length === repos.length) {
      setSelectedRepoIds([]);
    } else {
      setSelectedRepoIds(repos.map(r => r.id));
    }
  };

  const openAddModal = () => {
    setFormName('');
    setFormPrimaryUrl('');
    setFormBackupUrls('');
    setBatchImportText('');
    setActiveFormTab('single');
    setShowAddModal(true);
  };

  const openEditModal = (repo) => {
    setEditingRepo(repo);
    setFormName(repo.name);
    setFormPrimaryUrl(repo.primaryUrl || '');
    setFormBackupUrls((repo.backupUrls || []).join('\n'));
    setActiveFormTab('single');
    setShowAddModal(true);
  };

  const handleSaveRepo = () => {
    if (activeFormTab === 'batch') {
      if (!batchImportText.trim()) return;
      const imported = multiRepoService.parseMultiRepoText(batchImportText);
      if (!imported.length) {
        setNotice('未能识别任何有效仓源地址，请确认格式');
        return;
      }
      const existing = multiRepoService.getAll();
      multiRepoService.saveAll([...imported, ...existing]);
      reloadRepos();
      setShowAddModal(false);
      setNotice(`已批量导入 ${imported.length} 个多仓`);
      return;
    }

    if (!formPrimaryUrl.trim()) {
      setNotice('请输入主地址');
      return;
    }

    const backups = formBackupUrls.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);

    if (editingRepo) {
      multiRepoService.updateRepo(editingRepo.id, {
        name: formName.trim() || editingRepo.name,
        primaryUrl: formPrimaryUrl.trim(),
        backupUrls: backups,
      });
      setNotice(`已更新多仓“${formName.trim() || editingRepo.name}”`);
    } else {
      multiRepoService.addRepo({
        name: formName.trim() || '自定义多仓',
        primaryUrl: formPrimaryUrl.trim(),
        backupUrls: backups,
      });
      setNotice(`已添加多仓“${formName.trim() || '自定义多仓'}”`);
    }

    reloadRepos();
    setShowAddModal(false);
    setEditingRepo(null);
  };

  const handleDeleteRepo = (id) => {
    multiRepoService.removeRepo(id);
    reloadRepos();
    setConfirmDeleteId(null);
    setNotice('已删除该多仓');
  };

  const handleRestoreDefaults = () => {
    if (typeof window !== 'undefined' && window.confirm('确定恢复预置的精品多仓订阅吗？')) {
      multiRepoService.restoreDefaults();
      reloadRepos();
      setNotice('已恢复内置精品多仓配置（饭太硬、肥猫、巧技、摸鱼儿、小苹果）');
    }
  };

  return (
    <div className="modal-backdrop batch-source-backdrop" role="dialog" aria-modal="true" aria-label="多仓与单仓聚合工作台">
      <div className="batch-source-modal multi-repo-modal" style={{ width: 'min(860px, calc(100vw - 20px))', maxHeight: '92vh' }}>
        {/* Breadcrumb Header */}
        <div className="batch-source-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border, #303744)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="icon-button" onClick={onBack} title="返回源管理" aria-label="返回">
              <ArrowLeft size={18} />
            </button>
            <div className="breadcrumb-nav">
              <span style={{ fontSize: 11, color: '#8f9aaa', letterSpacing: '0.08em' }}>源管理 / </span>
              <h3 style={{ margin: 0, fontSize: 18, color: '#f3f4f6', display: 'inline' }}>多仓管理与单仓聚合工作台</h3>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="secondary" onClick={openAddModal} style={{ padding: '8px 12px', fontSize: 12 }}>
              <Plus size={15} /> 添加/导入多仓
            </button>
            <button className="icon-button" onClick={onBack} title="关闭" aria-label="关闭">
              ✕
            </button>
          </div>
        </div>

        <div style={{ padding: '16px 18px', overflowY: 'auto', flex: '1 1 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Top Aggregation Workbench Dashboard */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7), rgba(15, 23, 42, 0.9))',
            border: '1px solid #334155', borderRadius: 16, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Layers size={22} color="#38bdf8" />
                <div>
                  <b style={{ fontSize: 16, color: '#f8fafc' }}>单仓聚合控制台</b>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>
                    聚合状态: 已选 <b>{selectedRepoIds.length}</b> / {repos.length} 仓 ·
                    聚合站点: <b style={{ color: '#38bdf8' }}>{aggregatedResult?.meta?.siteCount || 0}</b> 个 ·
                    直播源: <b style={{ color: '#4ade80' }}>{aggregatedResult?.meta?.liveCount || 0}</b> 个
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="secondary" onClick={handleSyncAll} disabled={isSyncingAll} style={{ padding: '8px 14px', fontSize: 12 }}>
                  <RefreshCw size={14} className={isSyncingAll ? 'spin' : ''} />
                  {isSyncingAll ? '全部同步中…' : '一键同步全部多仓'}
                </button>
                <button className="secondary" onClick={handleRunAggregation} style={{ padding: '8px 14px', fontSize: 12 }}>
                  <Layers size={14} /> 立即聚合
                </button>
                <button className="primary" onClick={handleApplyToSystem} style={{ padding: '8px 16px', fontSize: 12 }}>
                  <Check size={14} /> 应用到当前播放源
                </button>
                <button className="secondary" onClick={handleExportAggregated} style={{ padding: '8px 12px', fontSize: 12 }}>
                  <Download size={14} /> 导出单仓JSON
                </button>
              </div>
            </div>

            {/* 5 Core Feature Pillars */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8,
              padding: '10px 12px', background: 'rgba(0,0,0,0.3)', borderRadius: 12, fontSize: 11
            }}>
              <div style={{ color: '#93c5fd' }}>
                <b style={{ display: 'block', color: '#60a5fa' }}>① 中文转 Punycode</b>
                饭太硬.com → xn--sss604efuw
              </div>
              <div style={{ color: '#86efac' }}>
                <b style={{ display: 'block', color: '#4ade80' }}>② 多地址回退</b>
                主/备地址顺序尝试防断流
              </div>
              <div style={{ color: '#fde047' }}>
                <b style={{ display: 'block', color: '#facc15' }}>③ 智能重试</b>
                瞬态退避 · 4xx/5xx跳过
              </div>
              <div style={{ color: '#f472b6' }}>
                <b style={{ display: 'block', color: '#ec4899' }}>④ 反爬兼容</b>
                简洁UA · 剔除//注释与控制符
              </div>
              <div style={{ color: '#c084fc' }}>
                <b style={{ display: 'block', color: '#a855f7' }}>⑤ 聚合单仓</b>
                Sites按Key去重+冲突加仓前缀
              </div>
            </div>
          </div>

          {notice && (
            <div className="batch-source-notice" style={{ margin: 0 }}>
              {notice}
            </div>
          )}

          {/* Repositories List Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button className="secondary" onClick={toggleSelectAll} style={{ padding: '6px 12px', fontSize: 12 }}>
                {selectedRepoIds.length === repos.length ? '取消全选' : '全选所有仓'}
              </button>
              <button className="secondary" onClick={handleRestoreDefaults} style={{ padding: '6px 12px', fontSize: 12 }}>
                恢复内置精品仓
              </button>
            </div>
            <small style={{ color: '#8f9aaa' }}>
              点击“检视穿透”可查看单仓的所有站点详情与多地址探测日志
            </small>
          </div>

          {/* Repositories Cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {repos.map((repo) => {
              const isSelected = selectedRepoIds.includes(repo.id);
              const isSyncing = syncingMap[repo.id];
              const backupsCount = (repo.backupUrls || []).length;

              return (
                <div
                  key={repo.id}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 16px', background: 'var(--card-bg, #171b23)', border: '1px solid var(--border, #303744)',
                    borderRadius: 14, gap: 12, flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
                    <button
                      className="batch-source-check"
                      onClick={() => toggleSelectRepo(repo.id)}
                      title={isSelected ? '取消勾选参与聚合' : '勾选参与聚合'}
                      style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
                    >
                      {isSelected ? <CheckSquare size={20} color="#38bdf8" /> : <Square size={20} color="#64748b" />}
                    </button>

                    <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <b style={{ fontSize: 15, color: '#f1f5f9' }}>{repo.name}</b>
                        <span style={{
                          padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600,
                          background: repo.status === 'success' ? 'rgba(34,197,94,0.15)' : repo.status === 'syncing' ? 'rgba(56,189,248,0.15)' : repo.status === 'error' ? 'rgba(239,68,68,0.15)' : 'rgba(148,163,184,0.12)',
                          color: repo.status === 'success' ? '#4ade80' : repo.status === 'syncing' ? '#38bdf8' : repo.status === 'error' ? '#f87171' : '#94a3b8',
                        }}>
                          {repo.status === 'success' ? '已就绪' : repo.status === 'syncing' ? '同步中' : repo.status === 'error' ? '同步失败' : '未同步'}
                        </span>
                        {backupsCount > 0 && (
                          <span style={{ fontSize: 11, color: '#a78bfa' }}>
                            (含 {backupsCount} 个备用镜像)
                          </span>
                        )}
                      </div>

                      <div style={{ fontSize: 11, color: '#8f9aaa', wordBreak: 'break-all' }}>
                        <span>主地址: </span>
                        <code style={{ color: '#cbd5e1' }}>{repo.primaryUrl}</code>
                      </div>

                      {repo.status === 'success' && (
                        <div style={{ fontSize: 11, color: '#64748b', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          <span>站点: <b style={{ color: '#cbd5e1' }}>{repo.siteCount}</b></span>
                          <span>直播: <b style={{ color: '#cbd5e1' }}>{repo.liveCount}</b></span>
                          {repo.durationMs && <span>耗时: {repo.durationMs}ms</span>}
                          {repo.usedUrl && <span>命中: <code style={{ color: '#38bdf8' }}>{repo.usedUrl}</code></span>}
                        </div>
                      )}

                      {repo.errorMessage && (
                        <small style={{ color: '#f87171' }}>{repo.errorMessage}</small>
                      )}
                    </div>
                  </div>

                  {/* Actions for this repo */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      className="primary"
                      onClick={() => onSelectRepoDetail(repo)}
                      style={{ padding: '7px 12px', fontSize: 12 }}
                      title="进入第三界面穿透检视站点"
                    >
                      <Eye size={14} /> 检视穿透
                    </button>
                    <button
                      className="secondary"
                      onClick={() => handleSyncSingle(repo.id)}
                      disabled={isSyncing}
                      style={{ padding: '7px 12px', fontSize: 12 }}
                      title="重新拉取主/备地址"
                    >
                      <RefreshCw size={14} className={isSyncing ? 'spin' : ''} />
                      {isSyncing ? '同步中' : '同步'}
                    </button>
                    <button
                      className="icon-button"
                      onClick={() => openEditModal(repo)}
                      title="编辑地址"
                      style={{ padding: 8 }}
                    >
                      <Edit3 size={15} />
                    </button>
                    <button
                      className="icon-button"
                      onClick={() => setConfirmDeleteId(repo.id)}
                      title="删除此仓"
                      style={{ padding: 8, color: '#f87171' }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Add/Edit Modal */}
        {showAddModal && (
          <div className="modal-backdrop" style={{ zIndex: 90 }}>
            <div className="modal" style={{ width: 'min(500px, 95vw)', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <b style={{ fontSize: 16 }}>{editingRepo ? '编辑多仓源' : '添加多仓订阅'}</b>
                <button className="icon-button" onClick={() => setShowAddModal(false)}>✕</button>
              </div>

              {!editingRepo && (
                <div className="seg" style={{ margin: 0 }}>
                  <button className={activeFormTab === 'single' ? 'active' : ''} onClick={() => setActiveFormTab('single')}>单仓配置</button>
                  <button className={activeFormTab === 'batch' ? 'active' : ''} onClick={() => setActiveFormTab('batch')}>批量订阅文本/JSON</button>
                </div>
              )}

              {activeFormTab === 'single' ? (
                <>
                  <div>
                    <label style={{ fontSize: 12, color: '#8f9aaa', display: 'block', marginBottom: 4 }}>多仓名称</label>
                    <input
                      type="text"
                      placeholder="例如：饭太硬 / 肥猫 / 巧技"
                      value={formName}
                      onChange={e => setFormName(e.target.value)}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 12, color: '#8f9aaa', display: 'block', marginBottom: 4 }}>
                      主地址 (支持中文域名，将自动转为 Punycode)
                    </label>
                    <input
                      type="text"
                      placeholder="http://饭太硬.com/tv"
                      value={formPrimaryUrl}
                      onChange={e => setFormPrimaryUrl(e.target.value)}
                    />
                    {formPrimaryUrl && (
                      <small style={{ color: '#a78bfa', display: 'block', marginTop: 4, wordBreak: 'break-all' }}>
                        Punycode 预览: {toPunycodeUrl(formPrimaryUrl)}
                      </small>
                    )}
                  </div>

                  <div>
                    <label style={{ fontSize: 12, color: '#8f9aaa', display: 'block', marginBottom: 4 }}>
                      备用镜像地址列表 (每行一个，主地址失败时顺序回退尝试)
                    </label>
                    <textarea
                      rows={3}
                      style={{
                        width: '100%', boxSizing: 'border-box', background: 'var(--card-bg, #171b23)',
                        color: '#fff', border: '1px solid var(--border, #303744)', borderRadius: 10, padding: 10,
                        fontSize: 12, fontFamily: 'inherit',
                      }}
                      placeholder="http://xn--sss604efuw.com/tv&#10;https://www.ftytv.com/tv"
                      value={formBackupUrls}
                      onChange={e => setFormBackupUrls(e.target.value)}
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label style={{ fontSize: 12, color: '#8f9aaa', display: 'block', marginBottom: 4 }}>
                    粘贴多仓订阅内容 (支持 TVBox urls JSON 或 仓名,地址 多行文本)
                  </label>
                  <textarea
                    rows={6}
                    style={{
                      width: '100%', boxSizing: 'border-box', background: 'var(--card-bg, #171b23)',
                      color: '#fff', border: '1px solid var(--border, #303744)', borderRadius: 10, padding: 10,
                      fontSize: 12, fontFamily: 'inherit',
                    }}
                    placeholder={`{"urls": [{"url": "http://饭太硬.com/tv", "name": "饭太硬"}]}&#10;或&#10;肥猫,http://肥猫.com/tv`}
                    value={batchImportText}
                    onChange={e => setBatchImportText(e.target.value)}
                  />
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
                <button className="secondary" onClick={() => setShowAddModal(false)}>取消</button>
                <button className="primary" onClick={handleSaveRepo}>保存并启用</button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation */}
        {confirmDeleteId && (
          <div className="modal-backdrop" style={{ zIndex: 90 }}>
            <div className="modal">
              <b>确认删除此多仓？</b>
              <p style={{ fontSize: 13, color: '#8f9aaa', margin: 0 }}>
                删除后将不再拉取该多仓，但已聚合至当前系统的站点不会受到影响。
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button className="secondary" onClick={() => setConfirmDeleteId(null)}>取消</button>
                <button className="primary" style={{ background: '#ef4444', color: '#fff' }} onClick={() => handleDeleteRepo(confirmDeleteId)}>
                  确认删除
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
