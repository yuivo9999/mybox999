// JSON live-source parser

function asArray(value){if(Array.isArray(value))return value;if(Array.isArray(value?.channels))return value.channels;if(Array.isArray(value?.data))return value.data;if(Array.isArray(value?.list))return value.list;return [];}
function normalizeStream(stream){if(typeof stream==='string')return {url:stream};return {url:stream?.url??stream?.mediaUrl??'',label:stream?.label??stream?.name??'',quality:stream?.quality??'',resolution:stream?.resolution??'',priority:Number.isFinite(stream?.priority)?stream.priority:undefined,protocol:stream?.protocol,headers:stream?.headers??{},cookies:stream?.cookies??'',referer:stream?.referer??'',userAgent:stream?.userAgent??'',expiresAt:stream?.expiresAt??null};}
export function parseJSONLive(input){const value=typeof input==='string'?JSON.parse(input):input;return asArray(value).flatMap((item,index)=>{if(!item||typeof item!=='object')return [];const rawStreams=Array.isArray(item.streams)?item.streams:Array.isArray(item.urls)?item.urls:item.url?[{url:item.url}]:[];return [{sourceItemId:String(item.sourceItemId??item.id??item.channelId??`item-${index+1}`),canonicalId:item.canonicalId??item.globalId??item.externalId??'',channelKey:item.channelKey??item.id??item.channelId??'',name:item.name??item.title??`频道 ${index+1}`,logo:item.logo??item.icon??'',categoryId:item.categoryId??item.categoryKey??item.category??'',category:item.category??item.group??item.categoryName??'未分类',description:item.description??'',sourceOrder:index,streams:rawStreams.map(normalizeStream).filter(s=>s.url),epg:Array.isArray(item.epg)?item.epg:[],currentProgram:item.currentProgram??null,upcomingProgram:item.upcomingProgram??null}];});}


// M3U parser

function parseAttributes(line){
  const attrs={};
  const match=line.match(/^#EXTINF:[^,]*,?(.*)$/i);
  const title=match?.[1]?.trim()||'';
  const metadata = line.slice(0, line.indexOf(',') >= 0 ? line.indexOf(',') : line.length);
  const regex = /[\w-]+="([^"]*)"/g;
  let m;
  while((m=regex.exec(metadata))) attrs[m[0].slice(0, m[0].indexOf('='))]=m[1];
  return {attrs,title};
}

function createChannel(pending, url, index){
  return {
    sourceItemId:pending['tvg-id']||pending.title||`item-${index+1}`,
    canonicalId:pending['tvg-id']||'',
    channelKey:pending['tvg-id']||pending.title||'',
    name:pending.title||pending['tvg-name']||`频道 ${index+1}`,
    logo:pending['tvg-logo']||'',
    category:pending['group-title']||'未分类',
    sourceOrder:index,
    stream:{
      url,
      label:pending['tvg-name']||'主线路',
      quality:pending['tvg-quality']||'',
      resolution:pending['tvg-resolution']||''
    }
  };
}

function getLines(text){
  return String(text??'').replace(/^\uFEFF/,'').split(/\r?\n/).map(x=>x.trim());
}

export function parseM3U(text){
  const lines=getLines(text);
  const channels=[];
  let pending=null;
  for(const line of lines){
    if(!line) continue;
    if(/^#EXTINF/i.test(line)){
      const {attrs,title}=parseAttributes(line);
      pending={...attrs,title:title||attrs['tvg-name']||''};
      continue;
    }
    if(line.startsWith('#')) continue;
    if(pending){
      channels.push(createChannel(pending,line,channels.length));
      pending=null;
    }
  }
  return channels;
}

export async function parseM3UAsync(text){
  const lines=getLines(text);
  const channels=[];
  let pending=null;
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(!line) continue;
    if(/^#EXTINF/i.test(line)){
      const {attrs,title}=parseAttributes(line);
      pending={...attrs,title:title||attrs['tvg-name']||''};
      continue;
    }
    if(line.startsWith('#')) continue;
    if(pending){
      channels.push(createChannel(pending,line,channels.length));
      pending=null;
    }
    if(i>0&&i%1500===0) await new Promise(resolve=>setTimeout(resolve,0));
  }
  return channels;
}


// TXT / TVBox live parser and streaming helpers

/**
 * Parser for TVBox / DIYP / IPTV `#genre#` TXT live channel format.
 */

export function parseTXTLive(text) {
  if (!text) return [];
  const cleanText = String(text).replace(/^\uFEFF/, '');
  const lines = cleanText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let currentCategory = '默认频道';
  const channelsMap = new Map();
  const channelsList = [];

  for (const line of lines) {
    if (line.includes('#genre#') || /^\[.*\]$/.test(line)) {
      let cat = line.replace(/[,，]?\s*#genre#.*$/i, '').trim();
      if (/^\[(.*)\]$/.test(cat)) cat = cat.slice(1, -1).trim();
      if (cat) currentCategory = cat;
      continue;
    }
    if (line.startsWith('#') || line.startsWith('//')) continue;

    let name = '';
    let rawUrls = '';
    const commaIndex = line.search(/[,，]/);
    if (commaIndex !== -1) {
      name = line.slice(0, commaIndex).trim();
      rawUrls = line.slice(commaIndex + 1).trim();
    } else {
      const match = line.match(/^([^\s]+)\s+((?:https?|rtmp|rtsp|p2p|mitv|mms):\/\/.+)$/i);
      if (match) {
        name = match[1].trim();
        rawUrls = match[2].trim();
      } else continue;
    }
    if (!name || !rawUrls) continue;

    const urlCandidates = rawUrls.split('#').map(u => u.trim()).filter(Boolean);
    const mapKey = `${currentCategory}:::${name}`;
    let channel = channelsMap.get(mapKey);
    if (!channel) {
      channel = {
        sourceItemId: `txt-${channelsList.length + 1}-${name}`,
        canonicalId: name,
        channelKey: name,
        name,
        logo: '',
        categoryId: currentCategory,
        category: currentCategory,
        sourceOrder: channelsList.length,
        streams: [],
        epg: [],
        currentProgram: null,
        upcomingProgram: null,
      };
      channelsMap.set(mapKey, channel);
      channelsList.push(channel);
    }

    for (const cand of urlCandidates) {
      let streamUrl = cand;
      let streamLabel = `线路 ${channel.streams.length + 1}`;
      if (streamUrl.includes('$')) {
        const parts = streamUrl.split('$');
        streamUrl = parts[0].trim();
        if (parts[1]?.trim()) streamLabel = parts[1].trim();
      }
      if (/^(?:https?|rtmp|rtsp|p2p|mitv|mms):\/\//i.test(streamUrl)
        || /\.(?:m3u8|flv|mp4)(?:[?#].*)?$/i.test(streamUrl)) {
        channel.streams.push({ url: streamUrl, label: streamLabel, quality: '', resolution: '' });
      }
    }
  }
  return channelsList;
}

export function parseTXTLiveMetadata(text) {
  if (!text) return [];
  const cleanText = String(text).replace(/^\uFEFF/, '');
  const lines = cleanText.split(/\r?\n/);
  let currentCategory = '默认频道';
  const channelsMap = new Map();
  const channels = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex].trim();
    if (!line) continue;
    if (line.includes('#genre#') || /^\[.*\]$/.test(line)) {
      let cat = line.replace(/[,，]?\s*#genre#.*$/i, '').trim();
      const bracket = cat.match(/^\[(.*)\]$/);
      if (bracket) cat = bracket[1].trim();
      if (cat) currentCategory = cat;
      continue;
    }
    if (line.startsWith('#') || line.startsWith('//')) continue;

    const commaIndex = line.search(/[,，]/);
    const name = commaIndex !== -1 ? line.slice(0, commaIndex).trim() : line.match(/^([^\s]+)\s+/)?.[1]?.trim() || '';
    const rawUrls = commaIndex !== -1 ? line.slice(commaIndex + 1).trim() : line.match(/^[^\s]+\s+(.+)$/)?.[1]?.trim() || '';
    if (!name) continue;

    const urlCountInLine = Math.max(1, rawUrls ? rawUrls.split('#').filter(Boolean).length : 1);
    const key = currentCategory + ':::' + name;
    let existing = channelsMap.get(key);
    if (existing) {
      existing.deferredRef.lineIndices.push(lineIndex);
      existing.estimatedStreamCount = (existing.estimatedStreamCount || 1) + urlCountInLine;
    } else {
      const channel = {
        sourceItemId: 'txt-' + (channels.length + 1) + '-' + name,
        canonicalId: name,
        channelKey: name,
        name,
        logo: '',
        categoryId: currentCategory,
        category: currentCategory,
        sourceOrder: channels.length,
        streams: [],
        epg: [],
        currentProgram: null,
        upcomingProgram: null,
        deferredRef: { lineIndex, lineIndices: [lineIndex] },
        estimatedStreamCount: urlCountInLine,
      };
      channelsMap.set(key, channel);
      channels.push(channel);
    }
  }
  return channels;
}

export async function parseTXTLiveMetadataStream(text, onChannel) {
  if (!text) return [];
  const cleanText = String(text).replace(/^\uFEFF/, '');
  const lines = cleanText.split(/\r?\n/);
  let currentCategory = '默认频道';
  const channelsMap = new Map();
  const channels = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex].trim();
    if (!line) continue;

    if (line.includes('#genre#') || /^\[.*\]$/.test(line)) {
      let cat = line.replace(/[,，]?\s*#genre#.*$/i, '').trim();
      const bracket = cat.match(/^\[(.*)\]$/);
      if (bracket) cat = bracket[1].trim();
      if (cat) currentCategory = cat;
      continue;
    }
    if (line.startsWith('#') || line.startsWith('//')) continue;

    const commaIndex = line.search(/[,，]/);
    const name = commaIndex !== -1 ? line.slice(0, commaIndex).trim() : line.match(/^([^\s]+)\s+/)?.[1]?.trim() || '';
    const rawUrls = commaIndex !== -1 ? line.slice(commaIndex + 1).trim() : line.match(/^[^\s]+\s+(.+)$/)?.[1]?.trim() || '';
    if (!name) continue;

    const urlCountInLine = Math.max(1, rawUrls ? rawUrls.split('#').filter(Boolean).length : 1);
    const key = currentCategory + ':::' + name;
    let existing = channelsMap.get(key);
    if (existing) {
      existing.deferredRef.lineIndices.push(lineIndex);
      existing.estimatedStreamCount = (existing.estimatedStreamCount || 1) + urlCountInLine;
    } else {
      const channel = {
        sourceItemId: 'txt-' + (channels.length + 1) + '-' + name,
        canonicalId: name,
        channelKey: name,
        name,
        logo: '',
        categoryId: currentCategory,
        category: currentCategory,
        sourceOrder: channels.length,
        streams: [],
        epg: [],
        currentProgram: null,
        upcomingProgram: null,
        deferredRef: { lineIndex, lineIndices: [lineIndex] },
        estimatedStreamCount: urlCountInLine,
      };
      channelsMap.set(key, channel);
      channels.push(channel);
      if (typeof onChannel === 'function') await onChannel(channel);
    }

    if (lineIndex > 0 && lineIndex % 1500 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  return channels;
}

export async function parseTXTLiveAsync(text) {
  if (!text) return [];
  const cleanText = String(text).replace(/^\uFEFF/, '');
  const lines = cleanText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let currentCategory = '默认频道';
  const channelsMap = new Map();
  const channelsList = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('#genre#') || /^\[.*\]$/.test(line)) {
      let cat = line.replace(/[,，]?\s*#genre#.*$/i, '').trim();
      if (/^\[(.*)\]$/.test(cat)) cat = cat.slice(1, -1).trim();
      if (cat) currentCategory = cat;
      continue;
    }
    if (line.startsWith('#') || line.startsWith('//')) continue;

    let name = '';
    let rawUrls = '';
    const commaIndex = line.search(/[,，]/);
    if (commaIndex !== -1) {
      name = line.slice(0, commaIndex).trim();
      rawUrls = line.slice(commaIndex + 1).trim();
    } else {
      const match = line.match(/^([^\s]+)\s+((?:https?|rtmp|rtsp|p2p|mitv|mms):\/\/.+)$/i);
      if (match) {
        name = match[1].trim();
        rawUrls = match[2].trim();
      } else continue;
    }
    if (!name || !rawUrls) continue;

    const urlCandidates = rawUrls.split('#').map(u => u.trim()).filter(Boolean);
    const mapKey = `${currentCategory}:::${name}`;
    let channel = channelsMap.get(mapKey);
    if (!channel) {
      channel = {
        sourceItemId: `txt-${channelsList.length + 1}-${name}`,
        canonicalId: name,
        channelKey: name,
        name,
        logo: '',
        categoryId: currentCategory,
        category: currentCategory,
        sourceOrder: channelsList.length,
        streams: [],
        epg: [],
        currentProgram: null,
        upcomingProgram: null,
      };
      channelsMap.set(mapKey, channel);
      channelsList.push(channel);
    }

    for (const cand of urlCandidates) {
      let streamUrl = cand;
      let streamLabel = `线路 ${channel.streams.length + 1}`;
      if (streamUrl.includes('$')) {
        const parts = streamUrl.split('$');
        streamUrl = parts[0].trim();
        if (parts[1]?.trim()) streamLabel = parts[1].trim();
      }
      if (/^(?:https?|rtmp|rtsp|p2p|mitv|mms):\/\//i.test(streamUrl)
        || /\.(?:m3u8|flv|mp4)(?:[?#].*)?$/i.test(streamUrl)) {
        channel.streams.push({ url: streamUrl, label: streamLabel, quality: '', resolution: '' });
      }
    }

    if (i > 0 && i % 1500 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  return channelsList;
}

export function parseTXTLiveLineStreams(line) {
  const value = String(line || '').trim();
  if (!value) return [];
  const commaIndex = value.search(/[,，]/);
  const rawUrls = commaIndex !== -1 ? value.slice(commaIndex + 1).trim() : value.match(/^[^\s]+\s+(.+)$/)?.[1]?.trim() || '';
  if (!rawUrls) return [];

  const separator = String.fromCharCode(36);
  return rawUrls.split('#').map((candidate, index) => {
    let streamUrl = candidate.trim();
    if (!streamUrl) return null;
    let label = '线路 ' + (index + 1);
    if (streamUrl.includes(separator)) {
      const parts = streamUrl.split(separator);
      streamUrl = parts.shift()?.trim() || '';
      if (parts.join(separator).trim()) label = parts.join(separator).trim();
    }
    return streamUrl ? { url: streamUrl, label, quality: '', resolution: '' } : null;
  }).filter(Boolean);
}

export function isTXTGenreFormat(text) {
  if (!text || typeof text !== 'string') return false;
  if (/#genre#/i.test(text)) return true;
  const sampleLines = text.split(/\r?\n/).slice(0, 30).filter(Boolean);
  let matchCount = 0;
  for (const line of sampleLines) {
    if (/[^,，\r\n]+[,，]\s*(?:https?|rtmp|rtsp):\/\//i.test(line)) matchCount++;
    else if (/^[^\s]+\s+(?:https?|rtmp|rtsp):\/\//i.test(line)) matchCount++;
  }
  return matchCount >= 2;
}


// XML live-source and EPG parsers

function text(node,selector){return node.querySelector(selector)?.textContent?.trim()||'';}
export function parseXMLLive(input){if(typeof DOMParser==='undefined')throw new Error('XMLParserUnavailable');const doc=new DOMParser().parseFromString(String(input??''),'application/xml');if(doc.querySelector('parsererror'))throw new Error('InvalidXML');return Array.from(doc.querySelectorAll('channel')).map((node,index)=>{const streams=Array.from(node.querySelectorAll('stream, url, source')).map(s=>({url:s.getAttribute('url')||s.getAttribute('src')||s.textContent?.trim()||'',label:s.getAttribute('label')||s.getAttribute('name')||'',quality:s.getAttribute('quality')||'',resolution:s.getAttribute('resolution')||'',priority:Number(s.getAttribute('priority')),protocol:s.getAttribute('protocol')||undefined,expiresAt:s.getAttribute('expires-at')||s.getAttribute('expiresAt')||null})).filter(s=>s.url);return {sourceItemId:node.getAttribute('id')||`item-${index+1}`,canonicalId:node.getAttribute('canonical-id')||node.getAttribute('global-id')||node.getAttribute('id')||'',channelKey:node.getAttribute('id')||'',name:node.getAttribute('display-name')||text(node,'display-name')||`频道 ${index+1}`,logo:node.querySelector('icon')?.getAttribute('src')||'',category:node.getAttribute('group')||text(node,'group')||'未分类',sourceOrder:index,streams};});}
export function parseXMLEPG(input){if(typeof DOMParser==='undefined')throw new Error('XMLParserUnavailable');const doc=new DOMParser().parseFromString(String(input??''),'application/xml');if(doc.querySelector('parsererror'))throw new Error('InvalidXML');return Array.from(doc.querySelectorAll('programme')).map((node,index)=>({programId:node.getAttribute('id')||`program-${index+1}`,channelRef:node.getAttribute('channel')||'',startTime:node.getAttribute('start')||'',endTime:node.getAttribute('stop')||'',startAt:node.getAttribute('start')||'',endAt:node.getAttribute('stop')||'',name:text(node,'title'),title:text(node,'title'),description:text(node,'desc'),category:node.getAttribute('category')||''}));}
