// User typography catalog

export const FONT_CATALOG = [
  { id:'system', name:'系统默认', alias:'System Default', style:'跟随系统', source:'本地', cssUrl: null, family:'Inter,ui-sans-serif,system-ui,-apple-system,sans-serif', license:'System' },
  { id:'noto-sans-sc', name:'思源黑体', alias:'Noto Sans SC', style:'现代无衬线', source:'Google Fonts', cssUrl:'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&display=swap', family:'Noto Sans SC', license:'OFL-1.1' },
  { id:'noto-serif-sc', name:'思源宋体', alias:'Noto Serif SC', style:'现代宋体', source:'Google Fonts', cssUrl:'https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;500;600;700&display=swap', family:'Noto Serif SC', license:'OFL-1.1' },
  { id:'lxgw-wenkai', name:'霞鹜文楷', alias:'LXGW WenKai', style:'楷体 / 人文', source:'ZeoSeven FontsAPI', cssUrl:'https://fontsapi.zeoseven.com/292/main/result.css', family:'LXGW WenKai', license:'OFL-1.1' },
  { id:'lxgw-wenkai-mono', name:'霞鹜文楷 Mono', alias:'LXGW WenKai Mono', style:'楷体 / 等宽', source:'ZeoSeven FontsAPI', cssUrl:'https://fontsapi.zeoseven.com/293/main/result.css', family:'LXGW WenKai Mono', license:'OFL-1.1' },
  { id:'lxgw-zhenkai', name:'霞鹜臻楷', alias:'LXGW ZhenKai', style:'中粗楷体', source:'ZeoSeven FontsAPI', cssUrl:'https://fontsapi.zeoseven.com/2/main/result.css', family:'LXGW ZhenKai GB', license:'OFL-1.1' },
  { id:'lxgw-xihei', name:'霞鹜晰黑', alias:'LXGW XiHei', style:'简洁黑体', source:'ZeoSeven FontsAPI', cssUrl:'https://fontsapi.zeoseven.com/226/main/result.css', family:'LXGW XiHei CL', license:'OFL-1.1' },
  { id:'lxgw-neo-xihei', name:'霞鹜新晰黑', alias:'LXGW Neo XiHei', style:'现代黑体', source:'ZeoSeven FontsAPI', cssUrl:'https://fontsapi.zeoseven.com/19/main/result.css', family:'LXGW Neo XiHei', license:'OFL-1.1' },
  { id:'lxgw-neo-zhisong', name:'霞鹜新致宋', alias:'LXGW Neo ZhiSong', style:'现代宋体', source:'ZeoSeven FontsAPI', cssUrl:'https://fontsapi.zeoseven.com/22/main/result.css', family:'LXGW Neo ZhiSong', license:'OFL-1.1' },
  { id:'lxgw-975-hei', name:'霞鹜 975 黑体', alias:'LXGW 975 Hei', style:'紧凑黑体', source:'ZeoSeven FontsAPI', cssUrl:'https://fontsapi.zeoseven.com/185/main/result.css', family:'LXGW 975 Gothic SC', license:'OFL-1.1' },
  { id:'lxgw-bright', name:'LXGW Bright', alias:'霞鹜 Bright', style:'半衬线 / 清雅', source:'ZeoSeven FontsAPI', cssUrl:'https://fontsapi.zeoseven.com/993/main/result.css', family:'LXGW Bright', license:'OFL-1.1' },
  { id:'lxgw-marker', name:'霞鹜漫黑', alias:'LXGW Marker Gothic', style:'马克笔 / POP', source:'ZeoSeven FontsAPI', cssUrl:'https://fontsapi.zeoseven.com/134/main/result.css', family:'LXGW Marker Gothic', license:'OFL-1.1' },
  { id:'smiley-sans', name:'得意黑', alias:'Smiley Sans', style:'窄斜黑体', source:'ZeoSeven FontsAPI', cssUrl:'https://fontsapi.zeoseven.com/92/main/result.css', family:'Smiley Sans Oblique', license:'OFL-1.1' },
  { id:'ma-shan-zheng', name:'马善政毛笔楷书', alias:'Ma Shan Zheng', style:'毛笔 / 书法', source:'ZeoSeven FontsAPI', cssUrl:'https://fontsapi.zeoseven.com/31/main/result.css', family:'Ma Shan Zheng', license:'OFL-1.1' },
  { id:'zcool-xiaowei', name:'站酷小薇 LOGO 体', alias:'ZCOOL XiaoWei', style:'秀丽 / 手写', source:'ZeoSeven FontsAPI', cssUrl:'https://fontsapi.zeoseven.com/265/main/result.css', family:'ZCOOL XiaoWei', license:'OFL-1.1' },
  { id:'zcool-qingke', name:'站酷庆科黄油体', alias:'ZCOOL QingKe HuangYou', style:'圆润 / 潮流', source:'ZeoSeven FontsAPI', cssUrl:'https://fontsapi.zeoseven.com/264/main/result.css', family:'ZCOOL QingKe HuangYou', license:'OFL-1.1' },
  { id:'chiron-sung', name:'昭源宋体', alias:'Chiron Sung HK', style:'现代宋体 / 可变', source:'ZeoSeven FontsAPI', cssUrl:'https://fontsapi.zeoseven.com/546/main/result.css', family:'Chiron Sung HK VF', license:'OFL-1.1' },
  { id:'chiron-hei', name:'昭源黑体', alias:'Chiron Hei HK', style:'现代黑体 / 可变', source:'ZeoSeven FontsAPI', cssUrl:'https://fontsapi.zeoseven.com/547/main/result.css', family:'Chiron Hei HK VF', license:'OFL-1.1' },
  { id:'chiron-goround', name:'昭源环方', alias:'Chiron GoRound TC', style:'圆体 / 可变', source:'ZeoSeven FontsAPI', cssUrl:'https://fontsapi.zeoseven.com/545/main/result.css', family:'Chiron GoRound TC VF', license:'OFL-1.1' },
];

export const DEFAULT_FONT_ID = 'system';
export const getFontById = (id) => FONT_CATALOG.find(font => font.id === id) ?? FONT_CATALOG[0];


// Font loading helpers

const loaded = new Map();

export function loadFont(font) {
  if (!font?.id || !font?.cssUrl || typeof document === 'undefined') return Promise.resolve(true);
  if (loaded.has(font.id)) return loaded.get(font.id);
  const promise = new Promise((resolve) => {
    const existing = document.querySelector(`link[data-mybox-font="${font.id}"]`);
    if (existing) { resolve(true); return; }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = font.cssUrl;
    link.dataset.myboxFont = font.id;
    link.onload = () => resolve(true);
    link.onerror = () => resolve(false);
    document.head.appendChild(link);
  });
  loaded.set(font.id, promise);
  return promise;
}

export async function ensureFont(font) {
  const ok = await loadFont(font);
  if (ok && typeof document !== 'undefined' && document.fonts?.load) {
    try { await document.fonts.load(`16px "${font.family}"`); } catch {}
  }
  return ok;
}
