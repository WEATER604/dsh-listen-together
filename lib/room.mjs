// 一起听房间：解析邀请链接、进房、心跳、轮询消息、发消息。
// 双人房（share 链接）没有房间聊天接口，只能在私信里说；
// 多人房（multishare 链接）有真正的聊天室，收发都走 eapi。
import { NeteaseError } from './netease.mjs';
import { appendLog, loadConfig, loadState, saveState, resetRoom } from './store.mjs';

export function parseInvite(text) {
  const raw = String(text ?? '').replace(/\\_/g, '_').replace(/\\&/g, '&').replace(/&amp;/g, '&');
  if (!raw) return null;
  const urls = raw.match(/https?:\/\/[^\s<>"'，。；、）)\]]+/g) ?? [];
  const candidates = urls.length ? urls : (/room_?id=/i.test(raw) ? [raw] : []);
  for (const candidate of candidates) {
    const clean = candidate.replace(/&amp;/g, '&').replace(/[)\]}>"'，。；、]+$/, '');
    // 短链（电脑版复制出来的就是这个）：先占个位，进房时再展开。
    if (/163cn\.(tv|link)|url\.cn/i.test(clean)) return { url: clean, kind: 'short', roomId: '', inviterId: '', inviterUid: '' };
    // 房间号不一定是纯数字：电脑版给的是 32 位 hash 加 _时间戳。
    const room = /[?&#]room_?id=([A-Za-z0-9_-]{4,80})/i.exec(clean);
    if (!room) continue;
    const inviterUid = /[?&#]inviter_?uid=(\d{1,20})/i.exec(clean);
    const inviterId = /[?&#]inviter_?id=(\d{1,20})/i.exec(clean);
    if (inviterUid) return { url: clean, kind: 'multi', roomId: room[1], inviterUid: inviterUid[1], inviterId: inviterId ? inviterId[1] : '' };
    if (inviterId) return { url: clean, kind: 'double', roomId: room[1], inviterId: inviterId[1], inviterUid: '' };
  }
  return null;
}

// 把 163cn.tv 之类的短链跟到真正的邀请地址。
export async function resolveShortUrl(url, fetchImpl = globalThis.fetch) {
  try {
    const response = await fetchImpl(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
    return String(response.url ?? '');
  } catch {
    return '';
  }
}

// 房间快照的形状随版本变：双人在 roomInfo / 顶层，多人在 multiLtRoomSnapshot 下面。
// 这里几种都认，取不到就留空，绝不抛错。
export function normalizeRoom(raw, selfUserId = 0) {
  const data = raw && typeof raw === 'object' ? (raw.data ?? raw) : {};
  const snap = data.multiLtRoomSnapshot ?? data.roomSnapshot ?? data.roomInfo ?? data;
  const play = snap.roomPlaySongInfo ?? data.roomPlaySongInfo ?? {};
  const song = play.playSong ?? snap.song ?? data.song ?? data.curSong ?? null;
  const agg = snap.multiLtRoomUserAgg ?? data.multiLtRoomUserAgg ?? {};
  const members = [];
  const push = value => {
    const userId = Number(value?.userId ?? value?.uid ?? 0);
    if (!userId || members.some(item => item.userId === userId)) return;
    members.push({ userId, name: String(value.nickname ?? value.nickName ?? value.userName ?? ''), avatar: String(value.avatarUrl ?? '') });
  };
  for (const item of agg.onlineUserInfos ?? []) push(item);
  for (const item of snap.roomUsers ?? []) push(item);
  if (!members.length) {
    const walk = (value, depth = 0) => {
      if (depth > 6 || !value) return;
      if (Array.isArray(value)) { for (const item of value) walk(item, depth + 1); return; }
      if (typeof value !== 'object') return;
      if ('nickname' in value || 'userName' in value) push(value);
      for (const child of Object.values(value)) walk(child, depth + 1);
    };
    walk(data);
  }
  return {
    roomId: String(snap.roomId ?? data.roomId ?? ''),
    chatroomId: String(snap.chatRoomId ?? snap.multiRoomInfoDTO?.chatRoomId ?? data.chatroomId ?? ''),
    inRoom: data.inRoom === undefined ? true : data.inRoom === true,
    members,
    other: members.find(member => member.userId !== Number(selfUserId)) ?? members[0] ?? null,
    songId: String(song?.id ?? play.songId ?? data.songId ?? ''),
    songName: String(song?.name ?? ''),
    songArtists: Array.isArray(song?.ar) ? song.ar.map(item => item.name).join(' / ') : String(song?.artist ?? ''),
    playStatus: play.playStatus === 'PAUSE' ? 0 : Number(data.playStatus ?? play.playStatus ?? 1) || 1,
    progressMs: Number(play.playedTime ?? data.progress ?? 0) || 0,
    updatedAt: Date.now(),
  };
}

// 私信的正文藏在 msg 这个 JSON 字符串里；卡片/表情会返回「不支持展示」。
function privateText(raw) {
  let text = '';
  if (typeof raw === 'string') {
    try { const parsed = JSON.parse(raw); text = String(parsed?.msg ?? ''); } catch { text = raw; }
  } else if (raw && typeof raw === 'object') {
    text = String(raw.msg ?? '');
  }
  text = text.trim();
  if (!text || /不支持展示|前往移动端/.test(text)) return '';
  return text;
}

export class RoomManager {
  constructor({ client, onIncoming = () => {}, onSong = () => {} } = {}) {
    this.client = client;
    this.onIncoming = onIncoming;
    this.onSong = onSong;
  }

  // 进房：双人走 accept，多人走 match/ack。多人的链接如果还带着 inviterId，
  // 而多人房间已经失效，就再试一次双人入口——有些分享链接两种参数都带。
  async join(link, { selfUserId = 0, say = false } = {}) {
    const state = loadState();
    const config = loadConfig();
    // 电脑版复制出来的是 163cn.tv 短链，先跟到真正的邀请地址。
    if (link.kind === 'short') {
      const expanded = await resolveShortUrl(link.url);
      const parsed = expanded ? parseInvite(expanded) : null;
      if (!parsed) throw new Error('这个短链展开后没找到房间号，可能房间已经散了，让对方重新发一条');
      link = parsed;
    }
    let kind = link.kind === 'multi' ? 'multi' : 'double';
    let info = null;
    if (kind === 'multi') {
      try {
        info = await this.client.multiAck({ roomId: link.roomId, inviterUid: link.inviterUid });
      } catch (error) {
        const detail = String(error?.detail ?? error?.message ?? '');
        if (link.inviterId && /ROOM_NOT_EXIST/.test(detail)) {
          info = await this.client.acceptInvite(link.roomId, link.inviterId);
          kind = 'double';
        } else throw error;
      }
    } else {
      info = await this.client.acceptInvite(link.roomId, link.inviterId);
    }
    // 双人房也有聊天室（roomInfo.chatRoomId），顺手记下来。
    const roomInfo = info?.roomInfo ?? info?.multiLtRoomSnapshot ?? info ?? {};
    const users = Array.isArray(roomInfo.roomUsers) ? roomInfo.roomUsers : [];
    const other = users.find(user => Number(user.userId) !== Number(selfUserId)) ?? null;
    state.room = {
      roomId: String(link.roomId),
      kind,
      chatroomId: String(roomInfo.chatRoomId ?? roomInfo.multiRoomInfoDTO?.chatRoomId ?? ''),
      inviterId: String(link.inviterId ?? ''),
      inviterUid: String(link.inviterUid ?? ''),
      inviterName: String(other?.nickname ?? ''),
      joinedAt: Date.now(),
      lastSeenAt: 0,
      status: 'joined',
    };
    state.music = null;
    state.joinedSongs = 0;
    state.lastChatTime = 0;
    state.lastError = '';
    saveState(state);
    appendLog({ kind: 'system', text: `加入了一个${kind === 'multi' ? '多人' : '双人'}一起听房间（${link.roomId}）${other?.nickname ? '，对方是 ' + other.nickname : ''}` });
    await this.refresh(state, selfUserId).catch(() => {});
    if (say) {
      const name = state.music?.songName;
      await this.send(name ? `我进来啦，正在听《${name}》` : '我进来啦', { selfUserId }).catch(() => {});
    }
    if (config.chatroomId) state.room.chatroomId = config.chatroomId;
    saveState(state);
    return state.room;
  }

  async leave({ selfUserId = 0 } = {}) {
    const state = loadState();
    if (!state.room.roomId) return { left: false };
    try {
      if (state.room.kind === 'multi') await this.client.multiExit(state.room.roomId);
      else await this.client.endRoom(state.room.roomId);
    } catch {}
    appendLog({ kind: 'system', text: '离开了一起听房间（' + state.room.roomId + '）' });
    saveState(resetRoom(state));
    return { left: true };
  }

  async send(text, { selfUserId = 0 } = {}) {
    const state = loadState();
    const body = String(text ?? '').trim();
    if (!body) throw new Error('内容不能是空的');
    if (!state.room.roomId) throw new Error('现在不在房间里');
    let target = '';
    if (state.room.kind === 'multi' && state.room.chatroomId) {
      await this.client.multiChatSend({ roomId: state.room.roomId, chatroomId: state.room.chatroomId, text: body });
      target = 'room';
    } else if (state.room.inviterId) {
      await this.client.sendPrivateMessage(state.room.inviterId, body);
      target = 'dm';
    } else {
      throw new Error('不知道对方是谁，发不出去');
    }
    appendLog({ kind: 'out', target, selfUserId, text: body });
    return { target };
  }

  async refresh(state, selfUserId) {
    const now = Date.now();
    // 双人房用 status/get（带 roomInfo），multi/landing 之类对双人房会失效。
    const raw = state.room.kind === 'multi' ? await this.client.multiStatus() : await this.client.togetherStatus();
    const view = normalizeRoom(raw, selfUserId);
    if (view.inRoom === false && state.room.kind !== 'multi') {
      // 服务端说已经不在房间里了（超时/被结束），别硬撑。
      appendLog({ kind: 'system', text: '房间已经结束了' });
      saveState(resetRoom(state));
      return { raw, view, gone: true };
    }
    state.room.lastSeenAt = now;
    if (view.roomId && view.roomId !== state.room.roomId) state.room.roomId = view.roomId;
    if (view.chatroomId) state.room.chatroomId = view.chatroomId;
    if (view.other?.name) state.room.inviterName = view.other.name;
    if (view.songId) {
      const changed = state.music?.songId !== view.songId;
      state.music = {
        songId: view.songId, name: view.songName, artists: view.songArtists,
        playStatus: view.playStatus, progressMs: view.progressMs, updatedAt: now,
      };
      if (changed) {
        state.joinedSongs = (state.joinedSongs ?? 0) + 1;
        state.songs = [{ songId: view.songId, name: view.songName, at: now }, ...(state.songs ?? [])].slice(0, 100);
        appendLog({ kind: 'song', text: view.songName || view.songId, songId: view.songId, artists: view.songArtists });
        this.onSong(state.music);
      }
    }
    saveState(state);
    return { raw, view };
  }

  // 拉新消息：多人读聊天室，双人读私信。
  async poll(state, selfUserId) {
    const since = state.lastChatTime || 0;
    const fresh = [];
    if (state.room.kind === 'multi') {
      if (!state.room.chatroomId) return fresh;
      const history = await this.client.multiChatHistory(state.room.roomId, 30);
      const rows = Array.isArray(history?.records) ? history.records : [];
      for (const row of rows) {
        const text = String(row?.imChatRoomMsgBody?.text ?? '').trim();
        const at = Number(row?.sendTime ?? 0);
        if (!text || at <= since) continue;
        if (Number(row?.sendUid) === Number(selfUserId)) continue;
        fresh.push({ at, from: String(row?.nickname ?? ''), userId: Number(row?.sendUid ?? 0), text });
      }
    } else if (state.room.inviterId) {
      const history = await this.client.privateHistory(state.room.inviterId, { limit: 20 });
      const rows = Array.isArray(history?.msgs) ? history.msgs : Array.isArray(history?.data?.msgs) ? history.data.msgs : [];
      // 第一次拉取只记个时间基准，不把历史里的话当成新消息回一遍。
      if (!since) {
        const newest = rows.length ? Math.max(...rows.map(row => Number(row?.time ?? 0))) : 0;
        state.lastChatTime = newest || Date.now();
        saveState(state);
        return fresh;
      }
      for (const row of rows) {
        const text = privateText(row?.msg);
        const at = Number(row?.time ?? 0);
        if (!text || !at || at <= since) continue;
        if (Number(row?.fromUser?.userId ?? row?.realFromUser?.userId ?? 0) === Number(selfUserId)) continue;
        fresh.push({ at, from: String(row?.fromUser?.nickname ?? ''), userId: Number(row?.fromUser?.userId ?? 0), text });
      }
    }
    fresh.sort((a, b) => a.at - b.at);
    for (const item of fresh) appendLog({ kind: 'in', from: item.from, userId: item.userId, text: item.text, serverAt: item.at });
    if (fresh.length) {
      state.lastChatTime = Math.max(...fresh.map(item => item.at));
      saveState(state);
      this.onIncoming(fresh);
    }
    return fresh;
  }

  // 一轮：该退出退出，该刷新刷新，该心跳心跳，该拉消息拉消息。
  async tick({ selfUserId = 0 } = {}) {
    const state = loadState();
    const config = loadConfig();
    if (!state.room.roomId) return;
    const now = Date.now();
    try {
      // 到点/到歌数就自己退房，先判这个，免得白心跳。
      const minutes = Number(config.autoExitMinutes) || 0;
      const songs = Number(config.autoExitSongs) || 0;
      let reason = '';
      if (minutes > 0 && state.room.joinedAt && now - state.room.joinedAt >= minutes * 60000) {
        reason = `听满 ${minutes} 分钟了`;
      } else if (songs > 0 && (state.joinedSongs ?? 0) >= songs) {
        reason = `已经听了 ${state.joinedSongs} 首歌`;
      }
      if (reason) {
        appendLog({ kind: 'system', text: `自动退出：${reason}` });
        await this.leave({ selfUserId });
        return;
      }
      if (now - (state.room.lastSeenAt || 0) >= Math.max(config.pollSeconds, 5) * 1000) {
        await this.refresh(state, selfUserId);
      }
      if (now - (state.lastBeatAt || 0) >= config.heartbeatSeconds * 1000 && state.music?.songId) {
        if (state.room.kind === 'multi') {
          await this.client.multiHeartbeat(state.room.roomId);
        } else {
          const music = state.music;
          const progress = (music.progressMs || 0) + Math.max(0, now - (music.updatedAt || now)) * (Number(music.playStatus) === 0 ? 0 : 1);
          await this.client.heartbeat({ roomId: state.room.roomId, songId: music.songId, playStatus: music.playStatus ?? 1, progress });
        }
        state.lastBeatAt = now;
        saveState(state);
      }
      if (now - (state.lastPollAt || 0) >= Math.max(config.pollSeconds, 5) * 1000) {
        state.lastPollAt = now;
        saveState(state);
        await this.poll(state, selfUserId);
      }
      if (state.lastError) { state.lastError = ''; saveState(state); }
    } catch (error) {
      const code = error instanceof NeteaseError ? error.code : (error?.message ?? String(error));
      state.lastError = String(code);
      saveState(state);
      if (code === 'LOGIN_REQUIRED') saveState(resetRoom(state));
      throw error;
    }
  }
}
