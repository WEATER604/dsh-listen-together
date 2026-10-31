// dsh-listen-together —— DSH 设置里的「一起听」一栏（独立版，不依赖别的项目）。
//
// 这一层故意做得极薄：真正的逻辑都在 lib/host.mjs 里，按文件修改时间用带版本号的
// 动态 import 重新加载。好处是改 lib/host.mjs 以后不用重开 DSH，刷一下页面就生效
// （ESM 按 URL 缓存，所以必须带 ?v= 才能拿到新代码）。
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const name = 'dsh-listen-together';
export const inject = ['webServer', 'agents'];

const ROUTE = '/dsh-listen-together';
const HOST_FILE = fileURLToPath(new URL('./lib/host.mjs', import.meta.url));

function stamp() {
  try {
    const stat = fs.statSync(HOST_FILE);
    return `${Math.round(stat.mtimeMs)}-${stat.size}`;
  } catch { return 'missing'; }
}

export function apply(ctx, config = {}) {
  const webServer = ctx.webServer ?? (typeof ctx.get === 'function' ? ctx.get('webServer') : undefined);
  if (!webServer) return;

  let host = null;
  let revision = '';

  async function load() {
    const version = stamp();
    if (host && revision === version) return host;
    const mod = await import(`./lib/host.mjs?v=${version}`);
    host = mod.createHost(ctx, config);
    revision = version;
    return host;
  }

  const handler = async (req, res) => {
    try {
      const current = await load();
      return await current.handler(req, res);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: false, error: String(error?.message || error) }));
    }
  };

  // 一个 effect 管两件事：定时轮询 + 路由注册；卸载时一起收掉。
  ctx.effect(() => {
    const timer = setInterval(() => {
      load().then(current => current.tick()).catch(() => {});
    }, 5000);
    if (typeof timer.unref === 'function') timer.unref();
    let dispose = null;
    try {
      dispose = webServer.register({ kind: 'prefix', path: ROUTE, handler });
    } catch (error) {
      console.warn('[dsh-listen-together] 路由注册失败：', error?.message ?? error);
    }
    return () => {
      clearInterval(timer);
      try { dispose?.(); } catch {}
    };
  });
}
