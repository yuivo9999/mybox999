import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

function vodProxyPlugin() {
  return {
    name: 'vod-proxy',
    configureServer(server) {
      server.middlewares.use('/api/vod-proxy', async (req, res) => {
        try {
          const parsed = new URL(req.url, 'http://localhost:3000');
          const targetUrl = parsed.searchParams.get('url');
          if (!targetUrl) {
            res.statusCode = 400;
            return res.end('Missing url param');
          }
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 12000);
          const response = await fetch(targetUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': '*/*',
            },
            signal: controller.signal,
          });
          clearTimeout(timer);
          res.statusCode = response.status;
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', '*');
          response.headers.forEach((val, key) => {
            if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())) {
              res.setHeader(key, val);
            }
          });
          const arrayBuffer = await response.arrayBuffer();
          res.end(Buffer.from(arrayBuffer));
        } catch (err) {
          res.statusCode = 502;
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), vodProxyPlugin()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: 'all'
  }
});
