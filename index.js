// dsh-listen-together —— DSH 设置里的「一起听」一栏（独立版，不依赖别的项目）。
//
// 这一层故意做得极薄：真正的逻辑都在 lib/ 里，按这些文件的修改时间用带版本号的
// 动态 import 重新加载。好处是改 lib 下任何文件以后不用重开 DSH，下一次请求或
// 下一轮轮询就会用新代码（ESM 按 URL 缓存，所以必须带 ?v= 才能拿到新的）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'dsh-listen-together';
export const inject = ['webServer', 'agents'];

const ROUTE = '/dsh-listen-together';
const LIB_DIR = fileURLToPath(new URL('./lib/', import.meta.url));
const VENDOR_FILE = fileURLToPath(new URL('./vendor/qrcode.mjs', import.meta.url));

// 版本号 = lib 下所有 .mjs 加 vendor 的最大修改时间 + 总大小，任何一个文件变了就换版本。
function stamp() {
  let newest = 0;
  let total = 0;
  try {
    for (const name of fs.readdirSync(LIB_DIR)) {
      if (!name.endsWith('.mjs')) continue;
      const stat = fs.statSync(path.join(LIB_DIR, name));
      newest = Math.max(newest, stat.mtimeMs);
      total += stat.size;
    }
    const vendor = fs.statSync(VENDOR_FILE);
    newest = Math.max(newest, vendor.mtimeMs);
    total += vendor.size;
  } catch { return 'missing'; }
  return `${Math.round(newest)}-${total}`;
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
