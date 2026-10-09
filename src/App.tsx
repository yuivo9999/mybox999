/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Tv, Smartphone, Globe, Layers, PlayCircle, Radio, Settings, Database } from 'lucide-react';

export default function App() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Bar */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Tv className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              MyBox
              <span className="text-xs px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20 font-medium">
                Web & Android
              </span>
            </h1>
            <p className="text-xs text-slate-400">影视点播 · 电视直播 · 多仓聚合 · TVBox原生桥接</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="px-3 py-1 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            项目结构已识别
          </span>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-6 md:p-8 space-y-8">
        {/* Banner Alert */}
        <div className="p-4 rounded-xl border border-sky-500/20 bg-sky-950/30 text-sky-200 text-sm flex items-start gap-3">
          <div className="p-1 rounded bg-sky-500/20 text-sky-400 mt-0.5">
            <Layers className="w-4 h-4" />
          </div>
          <div className="space-y-1">
            <div className="font-semibold text-white">已读取并分析上传的 MyBox 完整项目架构</div>
            <p className="text-slate-300 text-xs leading-relaxed">
              包含了完整的网页端（React + Tailwind + 桑田主题）与安卓端（Capacitor + 原生 TVBox 插件 + Spider 爬虫桥接），我们随时可以基于此展开针对性开发、调试或功能扩展。
            </p>
          </div>
        </div>

        {/* Modules Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* Web Module */}
          <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/50 hover:border-slate-700 transition">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-white">网页端 (React SPA)</h3>
                <p className="text-xs text-slate-400">桑田交互主题与现代流媒体引擎</p>
              </div>
            </div>
            <ul className="text-xs text-slate-300 space-y-2">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                <span><strong>影视点播 (MovieFeature)</strong>：分类索引、搜索与换源播放</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                <span><strong>电视直播 (LiveFeature / Tv1Live)</strong>：EPG、IPv4/IPv6 源切换</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                <span><strong>多仓源管理 (MultiRepoManager)</strong>：多源聚合与规则解析</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                <span><strong>播放控制台 (SangtianPlayerConsole)</strong>：沉浸式控台交互</span>
              </li>
            </ul>
          </div>

          {/* Android Module */}
          <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/50 hover:border-slate-700 transition">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-white">安卓原生桥接 (Capacitor)</h3>
                <p className="text-xs text-slate-400">com.yuivo9999.mybox123</p>
              </div>
            </div>
            <ul className="text-xs text-slate-300 space-y-2">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                <span><strong>TVBoxJarBridge</strong>：DexClassLoader 加载 Spider 爬虫 jar</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                <span><strong>DrpySandboxRuntime</strong>：执行 drpy 规则与 DOM/HTTP 模拟</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                <span><strong>TVBoxHttpPlugin & Extension</strong>：跨域请求与原生扩展拦截</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                <span><strong>NativePlaybackBridge</strong>：IJK/ExoPlayer 原生调用与遥控适配</span>
              </li>
            </ul>
          </div>

          {/* Media & Stream Core */}
          <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/50 hover:border-slate-700 transition">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                <PlayCircle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-white">流媒体核心与网络策略</h3>
                <p className="text-xs text-slate-400">高可用容错与流嗅探架构</p>
              </div>
            </div>
            <ul className="text-xs text-slate-300 space-y-2">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
                <span><strong>播放状态机 (PlaybackStateMachine)</strong>：生命周期守卫与重试</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
                <span><strong>流媒体嗅探器 (StreamSniffer)</strong>：网页资源正则提取与嗅探</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
                <span><strong>HLS Web Proxy</strong>：基于 Cloudflare Worker 或本地 Node 的代理</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
                <span><strong>多格式适配</strong>：M3U8、MPD (DASH)、FLV、MP4 及 TXT 播放列表</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Resources & Source Configs */}
        <div className="p-6 rounded-2xl border border-slate-800 bg-slate-900/30 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Database className="w-4 h-4 text-sky-400" />
              内置与关联资源清单
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="p-3.5 rounded-xl bg-slate-800/50 border border-slate-700/50">
              <div className="font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
                <PlayCircle className="w-3.5 h-3.5 text-amber-400" />
                4k.json
              </div>
              <p className="text-slate-400 text-[11px]">影视/点播 4K 高清接口与规则源配置</p>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-800/50 border border-slate-700/50">
              <div className="font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-rose-400" />
                tv1.txt
              </div>
              <p className="text-slate-400 text-[11px]">电视频道直播源列表 (含央视、卫视等分类)</p>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-800/50 border border-slate-700/50">
              <div className="font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
                <Settings className="w-3.5 h-3.5 text-cyan-400" />
                cf-hls-proxy-worker.js
              </div>
              <p className="text-slate-400 text-[11px]">用于解决跨域与防盗链的流媒体代理 Worker</p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 px-6 py-4 text-center text-xs text-slate-500">
        MyBox Project Workspace Ready · 随时准备进一步讨论与功能演进
      </footer>
    </div>
  );
}

