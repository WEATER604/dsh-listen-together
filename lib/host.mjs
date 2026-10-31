// 宿主侧的全部逻辑（路由 + 轮询）。index.js 只是一层薄壳，
// 按 lib/ 下所有文件的修改时间重新 import，所以改代码不用重开 DSH。
// 这里的依赖也带上同样的版本号，否则宿主文件换了、依赖还留在 ESM 缓存里。
const V = new URL(import.meta.url).search || '';
const { NeteaseClient, NeteaseError, parseCookie } = await import('./netease.mjs' + V);
const { RoomManager, parseInvite } = await import('./room.mjs' + V);
const { listSessions, askSession, buildPrompt } = await import('./session.mjs' + V);
const {
  loadAccount, saveAccount, clearAccount, loadConfig, saveConfig, loadState, saveState,
  resetRoom, appendLog, readLog, clearLog,
} = await import('./store.mjs' + V);
const { default: qrcode } = await import('../vendor/qrcode.mjs' + V);

export const ROUTE = '/dsh-listen-together';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function hostIsLoopback(req) {
  const raw = String(req?.headers?.host ?? '');
  if (!raw) return true;
  const host = raw.startsWith('[') ? raw.slice(0, raw.indexOf(']') + 1) : raw.split(':')[0];
  return LOOPBACK.has(host.toLowerCase());
}

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

function readBody(req, limit = 128 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { reject(new Error('请求体太大')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch { reject(new Error('请求体不是 JSON')); }
    });
    req.on('error', reject);
  });
}

// 把网易云那边的失败原因翻成人话：最常见的是一起听房间已经散了。
function friendlyJoinError(error) {
  const detail = String(error?.detail || error?.message || error);
  if (/ROOM_NOT_EXIST|API_488|已失效/.test(detail)) {
    return '这个一起听房间已经失效了（对方退出了，或者房间过期）。让 TA 重新开一个，再把新链接发过来。';
  }
  if (/CHECK_TOKEN|MULTI_CHECK_TOKEN_MISSING/.test(detail)) {
    return '一起听要的风控校验没拿到，等几秒重试；一直不行就换个网络再试。';
  }
  if (/LOGIN_REQUIRED|API_301/.test(detail)) {
    return '网易云登录过期了，重新扫码登录一下。';
  }
  if (/接口未找到|API_404/.test(detail)) {
    return '网易云不认这个链接，确认一下是不是聊天里那条一起听邀请（不是歌单链接）。';
  }
  return detail;
}

export function createHost(ctx, config = {}) {
  const client = () => new NeteaseClient({ cookie: loadAccount().cookie });
  let selfUserId = Number(config.selfUserId) || 0;
  let manager = null;
  let qrKeys = new Map();
  let busy = false;

  const managerFor = () => {
    if (!manager) {
      manager = new RoomManager({
        client: client(),
        onIncoming: rows => { void maybeReply(rows); },
        onSong: () => {},
      });
    }
    return manager;
  };

  async function refreshSelf() {
    const account = loadAccount();
    if (!parseCookie(account.cookie).MUSIC_U) { selfUserId = 0; return null; }
    try {
      const me = await client().account();
      selfUserId = me.userId;
      return me;
    } catch { return null; }
  }

  async function maybeReply(rows) {
    const settings = loadConfig();
    if (!settings.autoReply || !settings.sessionId) return;
    const state = loadState();
    if (Date.now() - (state.lastReplyAt || 0) < settings.replyCooldownSeconds * 1000) return;
    busy = true;
    try {
      const prompt = buildPrompt({ messages: rows, music: state.music, config: settings });
      const text = await askSession(ctx, settings.sessionId, prompt, { provider: settings.provider, model: settings.model });
      const clean = String(text).replace(/\[STICKER:[^\]]*\]/g, '').replace(/^["'“”「」]+|["'“”「」]+$/g, '').trim().slice(0, settings.replyMaxChars);
      if (!clean) return;
      await managerFor().send(clean, { selfUserId });
      const next = loadState();
      next.lastReplyAt = Date.now();
      saveState(next);
    } catch (error) {
      appendLog({ kind: 'error', text: '自动回话失败：' + String(error?.message || error) });
    } finally {
      busy = false;
    }
  }

  async function tick() {
    if (busy) return;
    const account = loadAccount();
    if (!parseCookie(account.cookie).MUSIC_U) return;
    const state = loadState();
    if (!state.room.roomId) return;
    busy = true;
    try {
      if (!selfUserId) await refreshSelf();
      managerFor().client = client();
      await managerFor().tick({ selfUserId });
    } catch (error) {
      const code = error instanceof NeteaseError ? error.code : String(error?.message || error);
      const next = loadState();
      next.lastError = String(code);
      saveState(next);
    } finally {
      busy = false;
    }
  }

  const handler = async (req, res) => {
    if (!hostIsLoopback(req)) return send(res, 403, { ok: false, error: '只接受本机请求' });
    // 自定义头挡跨站请求：浏览器跨域会先发预检，没放行就发不出来。
    if (req.headers['x-dsh-listen-together'] !== '1') return send(res, 403, { ok: false, error: '缺少请求标记' });
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const action = url.pathname.startsWith(ROUTE + '/') ? url.pathname.slice(ROUTE.length + 1) : '';
    try {
      if (req.method === 'GET' && (action === '' || action === 'snapshot')) {
        const account = loadAccount();
        const state = loadState();
        return send(res, 200, {
          ok: true,
          account: { loggedIn: !!parseCookie(account.cookie).MUSIC_U, profile: account.profile, savedAt: account.savedAt },
          config: loadConfig(),
          room: state.room,
          music: state.music,
          joinedSongs: state.joinedSongs ?? 0,
          songs: state.songs ?? [],
          lastError: state.lastError,
          log: readLog(200),
          sessions: listSessions(ctx),
        });
      }
      if (req.method === 'POST' && action === 'save') {
        const body = await readBody(req);
        const next = saveConfig({ ...loadConfig(), ...(body.config ?? {}) });
        return send(res, 200, { ok: true, config: next });
      }
      if (req.method === 'POST' && action === 'login/qr') {
        const key = await client().loginQrUnikey();
        const qr = qrcode(0, 'M');
        qr.addData('https://music.163.com/login?codekey=' + encodeURIComponent(key));
        qr.make();
        qrKeys.set(key, Date.now());
        for (const [oldKey, at] of qrKeys) if (Date.now() - at > 300000) qrKeys.delete(oldKey);
        return send(res, 200, { ok: true, key, svg: qr.createSvgTag({ cellSize: 4, margin: 8 }) });
      }
      if (req.method === 'POST' && action === 'login/qr/status') {
        const body = await readBody(req);
        const key = String(body.key ?? '');
        if (!key) throw new Error('缺少二维码 key');
        const result = await client().loginQrCheck(key);
        if (result.code === 803) {
          if (!/MUSIC_U=/.test(result.cookie)) throw new Error('登录成功但没拿到 cookie');
          saveAccount(result.cookie, null);
          const me = await refreshSelf();
          saveAccount(result.cookie, me ? { userId: me.userId, name: me.name, avatar: me.avatar } : null);
          qrKeys.delete(key);
          return send(res, 200, { ok: true, code: 803, message: '登录成功', account: me });
        }
        return send(res, 200, { ok: true, code: result.code, message: result.message });
      }
      if (req.method === 'POST' && action === 'login/cookie') {
        const body = await readBody(req);
        const cookie = String(body.cookie ?? '').trim();
        if (!/MUSIC_U=/.test(cookie)) throw new Error('这段里没有 MUSIC_U，可能复制错了');
        const probe = new NeteaseClient({ cookie });
        const me = await probe.account();
        if (!me.loggedIn) throw new Error('cookie 没通过验证，可能已经过期');
        saveAccount(cookie, { userId: me.userId, name: me.name, avatar: me.avatar });
        selfUserId = me.userId;
        return send(res, 200, { ok: true, account: me });
      }
      if (req.method === 'POST' && action === 'logout') {
        clearAccount();
        selfUserId = 0;
        const state = loadState();
        saveState(resetRoom(state));
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && action === 'join') {
        const body = await readBody(req);
        const link = parseInvite(String(body.link ?? ''));
        if (!link) throw new Error('这段里没认出邀请：缺 roomId / inviterId（多人房是 inviterUid）。电脑版复制出来的是 163cn.tv 短链，直接整段粘进来就行。');
        if (!parseCookie(loadAccount().cookie).MUSIC_U) throw new Error('还没有登录网易云账号');
        if (!selfUserId) await refreshSelf();
        const settings = loadConfig();
        managerFor().client = client();
        try {
          const room = await managerFor().join(link, { selfUserId, say: settings.sayOnJoin });
          return send(res, 200, { ok: true, room });
        } catch (error) {
          const friendly = friendlyJoinError(error);
          appendLog({ kind: 'error', text: '进房失败：' + String(friendly?.message || friendly) });
          throw new Error(String(friendly?.message || friendly));
        }
      }
      if (req.method === 'POST' && action === 'leave') {
        managerFor().client = client();
        const result = await managerFor().leave({ selfUserId });
        return send(res, 200, { ok: true, ...result });
      }
      if (req.method === 'POST' && action === 'say') {
        const body = await readBody(req);
        managerFor().client = client();
        const result = await managerFor().send(body.text, { selfUserId });
        return send(res, 200, { ok: true, ...result });
      }
      if (req.method === 'POST' && action === 'log/clear') {
        clearLog();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && action === 'bind') {
        const body = await readBody(req);
        const sessionId = String(body.sessionId ?? '');
        const next = saveConfig({ ...loadConfig(), sessionId });
        return send(res, 200, { ok: true, config: next });
      }
      return send(res, 404, { ok: false, error: '没有这个接口' });
    } catch (error) {
      return send(res, 400, { ok: false, error: String(error?.detail || error?.message || error) });
    }
  };

  return { handler, tick };
}
