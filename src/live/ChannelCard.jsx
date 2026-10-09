import React from 'react';
import { Radio, ChevronLeft } from 'lucide-react';

export function ChannelCard({ channel, onClick }) {
  return <button className="menu" onClick={() => onClick?.(channel)}>
    <Radio size={18}/><span>{channel?.name ?? '未命名频道'}<small>{channel?.category ?? ''}</small></span><ChevronLeft className="flip" size={17}/>
  </button>;
}
