import React, { useState } from 'react';
import {
  ArrowLeft, Plus, RefreshCw, Layers, CheckSquare, Square,
  Trash2, Edit3, Eye, Shield, Globe, Download, AlertCircle, Check, X, FileText
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
    <div className="modal-backdrop batch-source-backdrop multi-repo-backdrop" role="dialog" aria-modal="true" aria-label="多仓与单仓聚合工作台">
      <div className="batch-source-modal multi-repo-modal">
        <header className="multi-repo-header">
          <div className="multi-repo-heading-group">
            <button className="multi-repo-back-button" onClick={onBack} title="返回源管理" aria-label="返回源管理">
              <ArrowLeft size={19} />
            </button>
            <div className="multi-repo-heading-mark"><Layers size={21} /></div>
            <div className="multi-repo-heading-copy">
              <div className="multi-repo-breadcrumb">源管理 <span>/</span> 多仓管理</div>
              <h2>多仓聚合中心</h2>
              <p>统一维护订阅源、执行同步，并生成可供播放系统使用的聚合配置。</p>
            </div>
          </div>
          <div className="multi-repo-header-actions">
            <button className="multi-repo-add-button" onClick={openAddModal}>
              <Plus size={17} /> <span>添加多仓</span>
            </button>
            <button className="multi-repo-close-button" onClick={onBack} title="关闭" aria-label="关闭">
              <X size={19} />
            </button>
          </div>
        </header>

        <div className="multi-repo-scroll">
          <section className="multi-repo-overview" aria-labelledby="multi-repo-overview-title">
            <div className="multi-repo-overview-top">
              <div className="multi-repo-overview-copy">
                <div className="multi-repo-eyebrow"><span className="multi-repo-live-dot" /> SOURCE WORKSPACE</div>
                <h3 id="multi-repo-overview-title">把多个仓源，整理成一个入口</h3>
                <p>选择需要参与聚合的仓源，然后同步、合并并应用到当前播放系统。</p>
              </div>
              <div className="multi-repo-stat-grid">
                <div className="multi-repo-stat">
                  <span>已配置仓源</span>
                  <strong>{repos.length}</strong>
                  <small>个订阅源</small>
                </div>
                <div className="multi-repo-stat is-selected">
                  <span>参与本次聚合</span>
                  <strong>{selectedRepoIds.length}</strong>
                  <small>个已选仓源</small>
                </div>
                <div className="multi-repo-stat">
                  <span>影视站点</span>
                  <strong>{aggregatedResult?.meta?.siteCount || 0}</strong>
                  <small>个已合并站点</small>
                </div>
                <div className="multi-repo-stat">
                  <span>直播源</span>
                  <strong>{aggregatedResult?.meta?.liveCount || 0}</strong>
                  <small>个频道集合</small>
                </div>
              </div>
            </div>

            <div className="multi-repo-primary-actions">
              <button className="multi-repo-action-button is-sync" onClick={handleSyncAll} disabled={isSyncingAll}>
                <span className="multi-repo-action-icon"><RefreshCw size={17} className={isSyncingAll ? 'spin' : ''} /></span>
                <span><b>{isSyncingAll ? '正在同步全部仓源…' : '一键同步全部'}</b><small>拉取最新配置与站点</small></span>
              </button>
              <button className="multi-repo-action-button" onClick={handleRunAggregation}>
                <span className="multi-repo-action-icon"><Layers size={17} /></span>
                <span><b>生成聚合单仓</b><small>合并已选仓源</small></span>
              </button>
              <button className="multi-repo-action-button is-apply" onClick={handleApplyToSystem}>
                <span className="multi-repo-action-icon"><Check size={17} /></span>
                <span><b>应用到播放系统</b><small>启用当前聚合结果</small></span>
              </button>
              <button className="multi-repo-action-button is-export" onClick={handleExportAggregated}>
                <span className="multi-repo-action-icon"><Download size={17} /></span>
                <span><b>导出 JSON</b><small>保存聚合配置</small></span>
              </button>
            </div>
          </section>

          <section className="multi-repo-capabilities" aria-label="多仓处理能力">
            <div className="multi-repo-capability">
              <span className="multi-repo-capability-icon"><Globe size={17} /></span>
              <span><b>中文域名转换</b><small>自动处理 Punycode</small></span>
            </div>
            <div className="multi-repo-capability">
              <span className="multi-repo-capability-icon"><Shield size={17} /></span>
              <span><b>主备地址回退</b><small>按顺序尝试可用地址</small></span>
            </div>
            <div className="multi-repo-capability">
              <span className="multi-repo-capability-icon"><RefreshCw size={17} /></span>
              <span><b>失败重试</b><small>降低临时连接故障影响</small></span>
            </div>
            <div className="multi-repo-capability">
              <span className="multi-repo-capability-icon"><Layers size={17} /></span>
              <span><b>重复项合并</b><small>处理站点 Key 冲突</small></span>
            </div>
          </section>

          {notice && (
            <div className="multi-repo-notice" role="status" aria-live="polite">
              <span className="multi-repo-notice-icon"><AlertCircle size={17} /></span>
              <span>{notice}</span>
              <button onClick={() => setNotice('')} title="关闭提示" aria-label="关闭提示"><X size={16} /></button>
            </div>
          )}

          <section className="multi-repo-repository-section" aria-labelledby="multi-repo-list-title">
            <div className="multi-repo-list-heading">
              <div>
                <div className="multi-repo-section-eyebrow">YOUR SOURCES</div>
                <h3 id="multi-repo-list-title">仓源列表 <span>{repos.length}</span></h3>
                <p>勾选需要参与聚合的仓源；每个仓源可单独同步、编辑或查看详情。</p>
              </div>
              <div className="multi-repo-list-tools">
                <button className="multi-repo-tool-button" onClick={toggleSelectAll}>
                  {selectedRepoIds.length === repos.length && repos.length > 0 ? <CheckSquare size={16} /> : <Square size={16} />}
                  {selectedRepoIds.length === repos.length && repos.length > 0 ? '取消全选' : '全选仓源'}
                </button>
                <button className="multi-repo-tool-button" onClick={handleRestoreDefaults}>
                  <RefreshCw size={15} /> 恢复预置仓
                </button>
              </div>
            </div>

            {repos.length === 0 ? (
              <div className="multi-repo-empty-state">
                <div className="multi-repo-empty-icon"><Globe size={25} /></div>
                <h4>还没有添加仓源</h4>
                <p>添加一个订阅地址，或导入多行文本 / TVBox JSON 配置。</p>
                <button className="multi-repo-add-button" onClick={openAddModal}><Plus size={16} /> 添加第一个仓源</button>
              </div>
            ) : (
              <div className="multi-repo-list">
                {repos.map((repo) => {
                  const isSelected = selectedRepoIds.includes(repo.id);
                  const isSyncing = Boolean(syncingMap[repo.id]);
                  const backupsCount = (repo.backupUrls || []).length;
                  const status = repo.status || 'idle';
                  const statusLabel = status === 'success' ? '已就绪' : status === 'syncing' ? '同步中' : status === 'error' ? '同步失败' : '未同步';

                  return (
                    <article key={repo.id} className={`multi-repo-card${isSelected ? ' is-selected' : ''}`}>
                      <div className="multi-repo-card-main">
                        <button
                          className={`multi-repo-select-button${isSelected ? ' is-checked' : ''}`}
                          onClick={() => toggleSelectRepo(repo.id)}
                          title={isSelected ? '取消参与聚合' : '勾选参与聚合'}
                          aria-label={`${isSelected ? '取消选择' : '选择'}仓源 ${repo.name}`}
                          aria-pressed={isSelected}
                        >
                          {isSelected ? <CheckSquare size={21} /> : <Square size={21} />}
                        </button>
                        <div className="multi-repo-provider-icon"><Globe size={20} /></div>
                        <div className="multi-repo-card-info">
                          <div className="multi-repo-card-title-row">
                            <h4>{repo.name}</h4>
                            <span className={`multi-repo-status is-${status}`}>
                              <span className="multi-repo-status-dot" />{statusLabel}
                            </span>
                            {backupsCount > 0 && <span className="multi-repo-backup-badge">备用地址 {backupsCount}</span>}
                          </div>
                          <div className="multi-repo-address-block">
                            <span className="multi-repo-field-label">主地址</span>
                            <code>{repo.primaryUrl || '尚未设置主地址'}</code>
                          </div>
                          {status === 'success' && (
                            <div className="multi-repo-result-meta">
                              <span><b>{repo.siteCount || 0}</b> 个影视站点</span>
                              <span><b>{repo.liveCount || 0}</b> 个直播源</span>
                              {repo.durationMs ? <span>耗时 <b>{repo.durationMs} ms</b></span> : null}
                            </div>
                          )}
                          {repo.usedUrl && status === 'success' && (
                            <div className="multi-repo-used-url"><Check size={13} /> 本次命中：<code>{repo.usedUrl}</code></div>
                          )}
                          {repo.errorMessage && (
                            <div className="multi-repo-error-message"><AlertCircle size={14} /> <span>{repo.errorMessage}</span></div>
                          )}
                        </div>
                      </div>

                      <div className="multi-repo-card-actions">
                        <button className="multi-repo-detail-button" onClick={() => onSelectRepoDetail(repo)} title="查看该仓的站点详情与地址探测日志">
                          <Eye size={15} /> <span>查看详情</span>
                        </button>
                        <button className="multi-repo-secondary-action" onClick={() => handleSyncSingle(repo.id)} disabled={isSyncing} title="重新拉取主地址与备用地址">
                          <RefreshCw size={15} className={isSyncing ? 'spin' : ''} /> <span>{isSyncing ? '同步中' : '同步'}</span>
                        </button>
                        <button className="multi-repo-icon-action" onClick={() => openEditModal(repo)} title="编辑地址" aria-label={`编辑 ${repo.name}`}>
                          <Edit3 size={16} />
                        </button>
                        <button className="multi-repo-icon-action is-danger" onClick={() => setConfirmDeleteId(repo.id)} title="删除此仓" aria-label={`删除 ${repo.name}`}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {showAddModal && (
          <div className="modal-backdrop multi-repo-nested-backdrop" role="dialog" aria-modal="true" aria-label={editingRepo ? '编辑多仓源' : '添加多仓订阅'}>
            <div className="modal multi-repo-form-modal">
              <div className="multi-repo-form-header">
                <div className="multi-repo-form-title-icon"><Plus size={18} /></div>
                <div><h3>{editingRepo ? '编辑仓源' : '添加 / 导入仓源'}</h3><p>配置主地址与备用地址，保障订阅可用性。</p></div>
                <button className="multi-repo-close-button" onClick={() => setShowAddModal(false)} title="关闭" aria-label="关闭"><X size={18} /></button>
              </div>

              {!editingRepo && (
                <div className="multi-repo-form-tabs" role="tablist" aria-label="添加方式">
                  <button className={activeFormTab === 'single' ? 'active' : ''} onClick={() => setActiveFormTab('single')} role="tab" aria-selected={activeFormTab === 'single'}>
                    <Globe size={15} /> 单个仓源
                  </button>
                  <button className={activeFormTab === 'batch' ? 'active' : ''} onClick={() => setActiveFormTab('batch')} role="tab" aria-selected={activeFormTab === 'batch'}>
                    <FileText size={15} /> 批量文本 / JSON
                  </button>
                </div>
              )}

              {activeFormTab === 'single' ? (
                <div className="multi-repo-form-fields">
                  <div className="multi-repo-form-field">
                    <label htmlFor="multi-repo-name">仓源名称 <span>可选</span></label>
                    <input id="multi-repo-name" className="multi-repo-input" type="text" placeholder="例如：饭太硬 / 肥猫 / 巧技" value={formName} onChange={e => setFormName(e.target.value)} />
                  </div>
                  <div className="multi-repo-form-field">
                    <label htmlFor="multi-repo-primary-url">主订阅地址</label>
                    <input id="multi-repo-primary-url" className="multi-repo-input" type="text" placeholder="https://example.com/tv.json" value={formPrimaryUrl} onChange={e => setFormPrimaryUrl(e.target.value)} />
                    <small>支持中文域名，保存时会自动处理 Punycode。</small>
                    {formPrimaryUrl && <div className="multi-repo-punycode-preview"><span>转换预览</span><code>{toPunycodeUrl(formPrimaryUrl)}</code></div>}
                  </div>
                  <div className="multi-repo-form-field">
                    <label htmlFor="multi-repo-backup-urls">备用地址 <span>可选</span></label>
                    <textarea id="multi-repo-backup-urls" className="multi-repo-textarea" rows={3} placeholder={'每行填写一个备用地址\nhttps://backup.example.com/tv.json'} value={formBackupUrls} onChange={e => setFormBackupUrls(e.target.value)} />
                    <small>主地址不可用时，系统会按填写顺序依次尝试。</small>
                  </div>
                </div>
              ) : (
                <div className="multi-repo-form-fields">
                  <div className="multi-repo-form-field">
                    <label htmlFor="multi-repo-batch-text">粘贴订阅内容</label>
                    <textarea id="multi-repo-batch-text" className="multi-repo-textarea multi-repo-batch-textarea" rows={7} placeholder={'支持 TVBox urls JSON，或“仓名,地址”多行文本\n\n肥猫,https://example.com/tv.json\n巧技,https://example.org/tv.json'} value={batchImportText} onChange={e => setBatchImportText(e.target.value)} />
                    <small>支持 TVBox `urls` JSON 结构和逐行“仓名,地址”格式。</small>
                  </div>
                </div>
              )}

              <div className="multi-repo-form-footer">
                <button className="multi-repo-tool-button" onClick={() => setShowAddModal(false)}>取消</button>
                <button className="multi-repo-save-button" onClick={handleSaveRepo}><Check size={16} /> 保存配置</button>
              </div>
            </div>
          </div>
        )}

        {confirmDeleteId && (
          <div className="modal-backdrop multi-repo-nested-backdrop" role="dialog" aria-modal="true" aria-label="确认删除仓源">
            <div className="modal multi-repo-confirm-modal">
              <div className="multi-repo-confirm-icon"><Trash2 size={21} /></div>
              <h3>确认删除这个仓源？</h3>
              <p>删除后将停止拉取该仓源。已经合并到当前播放系统的站点不会因此被立即移除。</p>
              <div className="multi-repo-form-footer">
                <button className="multi-repo-tool-button" onClick={() => setConfirmDeleteId(null)}>保留仓源</button>
                <button className="multi-repo-delete-button" onClick={() => handleDeleteRepo(confirmDeleteId)}><Trash2 size={15} /> 确认删除</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
