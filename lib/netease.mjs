// 网易云接口层（自带，不依赖别的项目）：明文 /api、加密 /weapi、eapi 三套通道，
// 外加账号、一起听房间、房间聊天、私信。路径都实测过，未登录时返回 301。
import crypto from 'node:crypto';

export const WEB_BASE = 'https://music.163.com';
export const EAPI_HOST = 'https://interface.music.163.com';
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const PRESET_KEY = '0CoJUm6Qyw8W8jud';
const IV = Buffer.from('0102030405060708');
const PUBKEY = '010001';
const MODULUS = '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7';
const EAPI_KEY = 'e82ckenh8dichen8';
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export class NeteaseError extends Error {
  constructor(code, detail, { status = 0, api = '' } = {}) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'NeteaseError';
    this.code = code;
    this.detail = detail ?? '';
    this.status = status;
    this.api = api;
  }
}

export function parseCookie(raw) {
  const jar = {};
  for (const part of String(raw ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    jar[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return jar;
}

export function cookieString(jar) {
  return Object.entries(jar).filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([name, value]) => `${name}=${value}`).join('; ');
}

const randomKey = (length = 16) => {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
};

const aesCbc = (text, key) => {
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), IV);
  return Buffer.concat([cipher.update(Buffer.from(text, 'utf8')), cipher.final()]).toString('base64');
};

const modPow = (base, exponent, modulus) => {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
};

const rsaEncrypt = text => {
  const reversed = Buffer.from(String(text).split('').reverse().join(''), 'utf8').toString('hex');
  const encrypted = modPow(BigInt('0x' + reversed), BigInt('0x' + PUBKEY), BigInt('0x' + MODULUS));
  return encrypted.toString(16).padStart(256, '0');
};

export function weapiBody(payload) {
  const text = JSON.stringify(payload ?? {});
  const secret = randomKey(16);
  return { params: aesCbc(aesCbc(text, PRESET_KEY), secret), encSecKey: rsaEncrypt(secret) };
}

const eapiBody = (pathname, payload) => {
  const text = JSON.stringify(payload);
  const digest = crypto.createHash('md5').update(`nobody${pathname}use${text}md5forencrypt`).digest('hex');
  const data = `${pathname}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
  const cipher = crypto.createCipheriv('aes-128-ecb', Buffer.from(EAPI_KEY, 'utf8'), null);
  return Buffer.concat([cipher.update(Buffer.from(data, 'utf8')), cipher.final()]).toString('hex').toUpperCase();
};

const eapiDecrypt = buffer => {
  try {
    const decipher = crypto.createDecipheriv('aes-128-ecb', Buffer.from(EAPI_KEY, 'utf8'), null);
    return Buffer.concat([decipher.update(buffer), decipher.final()]).toString('utf8');
  } catch { return buffer.toString('utf8'); }
};

const codeOf = json => Number(json?.code ?? json?.status ?? 0);

function raise(api, json, status) {
  const code = codeOf(json);
  const message = String(json?.message ?? json?.msg ?? json?.error ?? '').trim();
  if (status === 401 || code === 301) throw new NeteaseError('LOGIN_REQUIRED', message || '需要登录', { status, api });
  if (code === -462) throw new NeteaseError('RISK_CONTROL', message || '被风控拦了', { status, api });
  if (status >= 400) throw new NeteaseError('HTTP_' + status, message, { status, api });
  if (code && code !== 200) throw new NeteaseError('API_' + code, message || '接口返回失败', { status, api });
}

export class NeteaseClient {
  constructor({ cookie = '', fetchImpl = globalThis.fetch } = {}) {
    this.cookie = cookie;
    this.fetchImpl = fetchImpl;
  }

  withCookie(cookie) { return new NeteaseClient({ cookie, fetchImpl: this.fetchImpl }); }

  get jar() {
    const jar = parseCookie(this.cookie);
    if (!jar.os) jar.os = 'pc';
    if (!jar.appver) jar.appver = '8.10.90';
    return jar;
  }

  // ---- 明文 / weapi ----
  async request(api, data = {}, { crypto: mode = 'plain' } = {}) {
    const jar = this.jar;
    const payload = { ...data };
    if (jar.__csrf) payload.csrf_token = payload.csrf_token || jar.__csrf;
    const headers = {
      'User-Agent': UA,
      'Referer': 'https://music.163.com/',
      'Origin': 'https://music.163.com',
      'Cookie': cookieString(jar),
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    const relative = api.replace(/^\/(api|weapi)\//, '');
    const url = mode === 'weapi' ? `${WEB_BASE}/weapi/${relative}` : `${WEB_BASE}/api/${relative}`;
    const body = mode === 'weapi' ? new URLSearchParams(weapiBody(payload)).toString() : new URLSearchParams(payload).toString();
    let response;
    try {
      response = await this.fetchImpl(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(15000) });
    } catch (error) {
      throw new NeteaseError('NETWORK', error?.message ?? String(error), { api });
    }
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {
      throw new NeteaseError('NOT_JSON', `返回的不是 JSON（HTTP ${response.status}）`, { status: response.status, api });
    }
    raise(api, json, response.status);
    return json;
  }

  // ---- eapi（多人一起听、聊天室走这条）----
  async eapi(pathname, payload = {}) {
    const api = pathname.startsWith('/api/') ? pathname : '/api/' + pathname.replace(/^\/?(api\/)?/, '');
    const jar = this.jar;
    if (!jar.os || jar.os === 'pc') jar.os = 'android';
    if (!jar.deviceId) jar.deviceId = 'listen-together-' + crypto.createHash('md5').update(String(jar.MUSIC_U ?? 'anon')).digest('hex').slice(0, 12);
    const header = {
      osver: jar.osver ?? '', deviceId: jar.deviceId, appver: jar.appver ?? '8.10.90',
      versioncode: '140', mobilename: '', buildver: String(Math.floor(Date.now() / 1000)),
      resolution: '1920x1080', __csrf: jar.__csrf ?? '', os: jar.os, channel: 'netease',
      requestId: `${Date.now()}_${Math.floor(Math.random() * 9000) + 1000}`,
    };
    let response;
    try {
      response = await this.fetchImpl(EAPI_HOST + '/eapi' + api.replace(/^\/api/, ''), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)',
          'Referer': 'https://music.163.com/',
          'Cookie': cookieString(jar),
        },
        body: 'params=' + encodeURIComponent(eapiBody(api, { ...payload, header, e_r: true })),
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      throw new NeteaseError('NETWORK', error?.message ?? String(error), { api });
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const text = eapiDecrypt(buffer);
    let json = null;
    try { json = JSON.parse(text); } catch {
      throw new NeteaseError('NOT_JSON', `eapi 返回无法解析（HTTP ${response.status}）`, { status: response.status, api });
    }
    raise(api, json, response.status);
    return json;
  }

  // ---- 账号 ----
  async account() {
    const json = await this.request('w/nuser/account/get', {}, { crypto: 'weapi' });
    const profile = json?.profile ?? null;
    const account = json?.account ?? null;
    return {
      loggedIn: !!(profile?.userId || account?.id),
      userId: Number(profile?.userId ?? account?.id ?? 0),
      name: String(profile?.nickname ?? ''),
      avatar: String(profile?.avatarUrl ?? ''),
    };
  }

  async userDetail(userId) {
    try {
      const json = await this.request('v1/user/detail/' + encodeURIComponent(String(userId)), {}, { crypto: 'weapi' });
      const profile = json?.profile ?? {};
      return { userId: Number(userId), name: String(profile.nickname ?? ''), avatar: String(profile.avatarUrl ?? '') };
    } catch { return { userId: Number(userId), name: '', avatar: '' }; }
  }

  async song(id) {
    try {
      const numeric = Number(id);
      const json = await this.request('v3/song/detail', {
        c: JSON.stringify([{ id: numeric }]),
        ids: '[' + numeric + ']',
      }, { crypto: 'weapi' });
      const row = json?.songs?.[0];
      if (!row) return null;
      return {
        id: Number(row.id),
        name: String(row.name ?? ''),
        artists: (row.ar ?? row.artists ?? []).map(item => String(item.name ?? '')).filter(Boolean),
        album: String(row.al?.name ?? row.album?.name ?? ''),
      };
    } catch { return null; }
  }

  // ---- 二维码登录 ----
  async loginQrUnikey() {
    const json = await this.request('login/qrcode/unikey', { type: 3 });
    const key = String(json?.unikey ?? '');
    if (!key) throw new NeteaseError('QR_KEY_MISSING', '没拿到二维码 key');
    return key;
  }

  // 800 过期 / 801 等扫码 / 802 已扫待确认 / 803 成功（成功那次才带 cookie）
  async loginQrCheck(key) {
    let response;
    try {
      response = await this.fetchImpl(`${WEB_BASE}/api/login/qrcode/client/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': UA,
          'Referer': 'https://music.163.com/',
          'Cookie': cookieString(this.jar),
        },
        body: new URLSearchParams({ key: String(key), type: '3' }).toString(),
        signal: AbortSignal.timeout(12000),
      });
    } catch (error) {
      throw new NeteaseError('NETWORK', error?.message ?? String(error), { api: 'login/qrcode/client/login' });
    }
    const text = await response.text();
    let json = {};
    try { json = JSON.parse(text); } catch {
      throw new NeteaseError('NOT_JSON', '二维码状态返回的不是 JSON', { status: response.status });
    }
    let cookie = String(json?.cookie ?? '');
    if (!cookie) {
      const raw = String(response.headers.get('set-cookie') ?? '');
      const musicU = /(?:^|[,\s])MUSIC_U=([^;,\s]+)/.exec(raw);
      const csrf = /(?:^|[,\s])__csrf=([^;,\s]+)/.exec(raw);
      if (musicU) cookie = 'MUSIC_U=' + musicU[1] + (csrf ? '; __csrf=' + csrf[1] : '');
    }
    return { code: Number(json?.code ?? 0), message: String(json?.message ?? json?.msg ?? ''), cookie };
  }

  // ---- 双人一起听 ----
  async togetherStatus() {
    const json = await this.request('listen/together/status/get', {}, { crypto: 'weapi' });
    return json?.data ?? json ?? null;
  }

  async createRoom() {
    const json = await this.request('listen/together/room/create', { refer: 'songplay_more' });
    return json?.data ?? json ?? null;
  }

  async acceptInvite(roomId, inviterId) {
    const json = await this.request('listen/together/play/invitation/accept', {
      refer: 'inbox_invite', roomId: String(roomId), inviterId: String(inviterId),
    });
    return json?.data ?? json ?? null;
  }

  async roomCheck(roomId) {
    const json = await this.request('listen/together/room/check', { roomId: String(roomId) });
    return json?.data ?? json ?? null;
  }

  async heartbeat({ roomId, songId, playStatus = 1, progress = 0 }) {
    return this.request('listen/together/heartbeat', {
      roomId: String(roomId), songId: String(songId), playStatus: String(playStatus), progress: String(Math.max(0, Math.round(progress))),
    });
  }

  async endRoom(roomId) {
    return this.request('listen/together/end/v2', { roomId: String(roomId), shareInfo: '{}' });
  }

  async playlistGet(roomId) {
    const json = await this.request('listen/together/sync/playlist/get', { roomId: String(roomId) });
    return json?.data ?? json ?? null;
  }

  // ---- 多人一起听 ----
  async checkToken() {
    try {
      const response = await this.fetchImpl('https://ac.dun.163yun.com/v3/b?pn=YD00000558929251', {
        headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000),
      });
      const text = await response.text();
      const match = /null\(\[(\d+),\d+,"([^"]+)"\]\)/.exec(text);
      return match && match[1] === '200' ? match[2] : '';
    } catch { return ''; }
  }

  async multiAck({ roomId, inviterUid }) {
    const checkToken = await this.checkToken();
    if (!checkToken) throw new NeteaseError('MULTI_CHECK_TOKEN_MISSING', '没能拿到易盾校验 token，可能是网络问题');
    const json = await this.eapi('listen/together/multi/match/ack', {
      roomId: String(roomId), inviterUid: String(inviterUid), agree: true, checkToken,
    });
    const data = json?.data ?? json;
    if (data?.success === false) {
      // 服务端给的 failedType 很有用（房间失效、校验失败、不是好友…），原样带出去。
      const type = String(data?.failedType ?? data?.failedCode ?? 'MULTI_ACK_FAILED');
      const message = String(data?.failedMessage ?? '');
      throw new NeteaseError('MULTI_ACK_FAILED', message ? `${type}：${message}` : type, { api: 'multi/match/ack' });
    }
    return data;
  }

  async multiStatus() {
    const json = await this.eapi('listen/together/multi/match/status/get', {});
    return json?.data ?? json;
  }

  async multiHeartbeat(roomId) {
    return this.eapi('listen/together/multi/match/heartbeat', { roomId: String(roomId) });
  }

  async multiChatHistory(roomId, size = 30) {
    const json = await this.eapi('listen/together/multi/match/msg/history', {
      roomId: String(roomId), direction: 0, page: JSON.stringify({ size }),
    });
    return json?.data ?? json;
  }

  async multiChatSend({ roomId, chatroomId, text }) {
    const json = await this.eapi('middle/im/chatroom/send', {
      chatroomId: String(chatroomId), msgType: 0,
      clientExt: JSON.stringify({ bizType: 'listenTogether', ltType: 'MULTI_MATCH_SONG', roomId: String(roomId) }),
      msgBody: JSON.stringify({ msg: String(text), msgType: 0 }),
    });
    return json?.data ?? json;
  }

  async multiExit(roomId, exitType = 'NORMAL_END') {
    return this.eapi('listen/together/multi/match/exit', { roomId: String(roomId), exitType });
  }

  // ---- 私信（双人房没有房间聊天，只能走这里）----
  // 注意：发送的收件人是 userIds，值要写成 "[123]" 这种数组字符串；写成 to/userId 会 400。
  async sendPrivateMessage(toUserId, msg) {
    return this.request('msg/private/send', { type: 'text', msg: String(msg), userIds: '[' + String(toUserId) + ']' });
  }

  async privateHistory(userId, { limit = 20, before = 0 } = {}) {
    const json = await this.request('msg/private/history', {
      userId: String(userId), limit: String(limit), time: String(before ?? 0), total: 'true',
    });
    return json;
  }
}
