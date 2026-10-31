// 本地存储：配置、房间状态、聊天记录。都放在 ~/.dsh/listen-together/ 下，
// 可用环境变量 DSH_LISTEN_TOGETHER_DIR 改位置；这里不写死任何机器路径。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function dataDir() {
  return process.env.DSH_LISTEN_TOGETHER_DIR || path.join(os.homedir(), '.dsh', 'listen-together');
}

const files = () => ({
  config: path.join(dataDir(), 'config.json'),
  account: path.join(dataDir(), 'account.json'),
  state: path.join(dataDir(), 'state.json'),
  log: path.join(dataDir(), 'chat.jsonl'),
});

export const DEFAULTS = Object.freeze({
  version: 1,
  heartbeatSeconds: 15,
  pollSeconds: 10,
  sayOnJoin: false,
  autoReply: false,
  replyMaxChars: 60,
  replyCooldownSeconds: 20,
  autoExitMinutes: 0,
  autoExitSongs: 0,
  sessionId: '',
  provider: '',
  model: '',
  chatroomId: '',
});

const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return fallback; }
};

const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temp, file);
};

const clampInt = (value, low, high, fallback) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= low && number <= high ? number : fallback;
};

export function loadConfig() {
  const stored = readJson(files().config, {});
  const merged = { ...structuredClone(DEFAULTS), ...(stored && typeof stored === 'object' ? stored : {}) };
  merged.heartbeatSeconds = clampInt(merged.heartbeatSeconds, 5, 120, DEFAULTS.heartbeatSeconds);
  merged.pollSeconds = clampInt(merged.pollSeconds, 3, 120, DEFAULTS.pollSeconds);
  merged.replyMaxChars = clampInt(merged.replyMaxChars, 10, 400, DEFAULTS.replyMaxChars);
  merged.replyCooldownSeconds = clampInt(merged.replyCooldownSeconds, 5, 3600, DEFAULTS.replyCooldownSeconds);
  merged.autoExitMinutes = clampInt(merged.autoExitMinutes, 0, 1440, DEFAULTS.autoExitMinutes);
  merged.autoExitSongs = clampInt(merged.autoExitSongs, 0, 500, DEFAULTS.autoExitSongs);
  for (const name of ['sayOnJoin', 'autoReply']) merged[name] = merged[name] === true;
  for (const name of ['sessionId', 'provider', 'model', 'chatroomId']) merged[name] = String(merged[name] ?? '');
  return merged;
}

export function saveConfig(config) {
  writeJson(files().config, config);
  return loadConfig();
}

export function loadAccount() {
  const stored = readJson(files().account, {});
  return {
    cookie: String(stored?.cookie ?? ''),
    profile: stored?.profile ?? null,
    savedAt: Number(stored?.savedAt) || 0,
  };
}

export function saveAccount(cookie, profile = null) {
  writeJson(files().account, { cookie: String(cookie ?? ''), profile, savedAt: Date.now() });
  return loadAccount();
}

export function clearAccount() {
  try { fs.rmSync(files().account, { force: true }); } catch {}
}

const EMPTY_ROOM = { roomId: '', kind: 'double', chatroomId: '', inviterId: '', inviterUid: '', inviterName: '', joinedAt: 0, lastSeenAt: 0, status: '' };

export function loadState() {
  const stored = readJson(files().state, {});
  return {
    version: 1,
    room: { ...EMPTY_ROOM, ...(stored?.room && typeof stored.room === 'object' ? stored.room : {}) },
    music: stored?.music && typeof stored.music === 'object' ? stored.music : null,
    joinedSongs: Number(stored?.joinedSongs) || 0,
    lastBeatAt: Number(stored?.lastBeatAt) || 0,
    lastPollAt: Number(stored?.lastPollAt) || 0,
    lastChatTime: Number(stored?.lastChatTime) || 0,
    lastReplyAt: Number(stored?.lastReplyAt) || 0,
    lastError: String(stored?.lastError ?? ''),
    songs: Array.isArray(stored?.songs) ? stored.songs.slice(0, 100) : [],
  };
}

export function saveState(state) {
  writeJson(files().state, state);
  return state;
}

export function resetRoom(state) {
  state.room = { ...EMPTY_ROOM };
  state.music = null;
  state.joinedSongs = 0;
  state.lastBeatAt = 0;
  state.lastPollAt = 0;
  state.lastChatTime = 0;
  return state;
}

// 聊天记录按 JSONL 追加；读的时候只取尾部若干行。
export function appendLog(entry) {
  const row = { at: Date.now(), ...entry };
  try {
    fs.mkdirSync(path.dirname(files().log), { recursive: true });
    fs.appendFileSync(files().log, JSON.stringify(row) + '\n');
  } catch {}
  return row;
}

export function readLog(limit = 100) {
  try {
    const text = fs.readFileSync(files().log, 'utf8');
    const lines = text.trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

export function clearLog() {
  try { fs.rmSync(files().log, { force: true }); } catch {}
}

export { files as dataFiles };
