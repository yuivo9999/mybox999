import React, { useEffect, useState } from 'react';
import { ChevronDown, Server, X } from 'lucide-react';

export function MovieSourcePill({ sources=[], selectedSource, onChange }){
  const [open, setOpen] = useState(false);
  const [draftSourceId, setDraftSourceId] = useState(selectedSource?.sourceId || '');
  useEffect(() => {
    if (!open) setDraftSourceId(selectedSource?.sourceId || '');
  }, [selectedSource, open]);

  const close = () => {
    setDraftSourceId(selectedSource?.sourceId || '');
    setOpen(false);
  };

  const apply = () => {
    setOpen(false);
    if (draftSourceId && draftSourceId !== selectedSource?.sourceId) {
      onChange?.(draftSourceId);
    }
  };

  return (
    <>
      <button
        className="movie-source-pill"
        type="button"
        onClick={() => setOpen(true)}
        title="点击切换当前影视源"
      >
        <Server size={13} style={{ flexShrink: 0 }} />
        <span>{selectedSource?.name || '选择影视源'}</span>
        <ChevronDown size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
      </button>

      {open && (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) close(); }}>
          <div className="source-selector-popover" role="dialog" aria-label="选择影视源" style={{ position: 'relative', width: 'min(92vw, 360px)' }}>
            <div className="source-selector-popover-head">
              <div>
                <b>选择影视源</b>
                <small>来自中国 4K 影音抓取源</small>
              </div>
              <button className="icon-button" type="button" aria-label="关闭" onClick={close}>
                <X size={17}/>
              </button>
            </div>
            <div className="source-selector-list" role="radiogroup" aria-label="影视源列表">
              {sources.map((source, index) => {
                const checked = draftSourceId === source.sourceId;
                return (
                  <button
                    className={'source-selector-item' + (checked ? ' selected' : '')}
                    type="button"
                    key={`${source.sourceId || 'src'}_${index}`}
                    role="radio"
                    aria-checked={checked}
                    onClick={() => setDraftSourceId(source.sourceId)}
                  >
                    <span className="source-selector-name" title={source.name}>{source.name}</span>
                    <span className={'source-selector-radio' + (checked ? ' checked' : '')} aria-hidden="true">
                      {checked && <span />}
                    </span>
                  </button>
                );
              })}
              {!sources.length && <div className="source-selector-empty">暂无可用影视源</div>}
            </div>
            <div className="source-selector-footer">
              <button className="secondary" type="button" onClick={close}>取消</button>
              <button className="primary" type="button" disabled={!draftSourceId} onClick={apply}>切换影视源</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
