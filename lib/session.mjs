// 绑定 DSH 会话：列出会话、取到 live agent（或在允许时 resume），
// 把房间里的消息丢给它，让它用那个会话的人格回话。
// 所有 DSH 服务都当作可能不存在，取不到就安静降级，不让插件整个挂掉。

const TIMEOUT = 180000;

const withTimeout = (promise, ms, message) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(message)), ms);
  promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
});

function replyText(message) {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  return blocks.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('').trim();
}

export function sessionTitleOf(agent, ctx, sessionId) {
  try {
    const titles = ctx.get?.('sessionTitle');
    const known = titles?.get?.(sessionId);
    if (typeof known === 'string' && known) return known;
  } catch {}
  try {
    const event = agent?.session?.snapshotEvents?.().filter(item => item.type === 'session/title').at(-1);
    const title = event?.data?.title ?? event?.data;
    if (typeof title === 'string' && title) return title;
  } catch {}
  return '';
}

// 列出可选会话：先拿 live agents，再补 workspace registry 里没开着的。
export function listSessions(ctx) {
  const rows = new Map();
  let agents = [];
  try { agents = ctx.agents?.list?.() ?? []; } catch { agents = []; }
  for (const agent of agents) {
    const id = String(agent?.id ?? agent?.session?.header?.id ?? '');
    if (!id) continue;
    rows.set(id, {
      id,
      title: sessionTitleOf(agent, ctx, id) || String(agent?.session?.header?.cwd ?? '') || id,
      live: true,
      cwd: String(agent?.session?.header?.cwd ?? ''),
    });
  }
  try {
    const registry = ctx.get?.('workspaceRegistry');
    const entries = registry?.list?.() ?? [];
    for (const entry of entries) {
      for (const id of entry?.sessionIds ?? []) {
        const key = String(id);
        if (rows.has(key)) continue;
        rows.set(key, { id: key, title: String(entry?.name ?? entry?.title ?? key), live: false, cwd: String(entry?.cwd ?? '') });
      }
    }
  } catch {}
  return [...rows.values()].slice(0, 200);
}

// 拿到会话对应的 agent：开着就用，没开就 resume（resume 需要 provider/model）。
export async function ensureAgent(ctx, sessionId, { provider = '', model = '' } = {}) {
  if (!sessionId) throw new Error('还没有绑定会话');
  let agent = null;
  try { agent = ctx.agents?.get?.(sessionId) ?? null; } catch {}
  if (agent) return agent;
  const agentOptions = {};
  if (provider) agentOptions.provider = provider;
  if (model) agentOptions.model = model;
  const handle = await ctx.agents.resume({ resumeSessionId: sessionId, ...(Object.keys(agentOptions).length ? { agentOptions } : {}) });
  agent = handle?.agent ?? handle;
  if (!agent) throw new Error('没能把这个会话恢复起来');
  return agent;
}

function eventText(event) {
  const data = event?.data?.message ?? event?.data;
  const blocks = Array.isArray(data?.content) ? data.content : [];
  return blocks.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('').trim();
}

// 让绑定的会话回一句话；返回它这一轮的最后一条正文。
// 会话可能同时在跑别的活，所以只认「我们这条消息之后那一轮」的回复。
export async function askSession(ctx, sessionId, prompt, { provider = '', model = '' } = {}) {
  const agent = await ensureAgent(ctx, sessionId, { provider, model });
  const session = agent.session;
  const snapshot = () => { try { return session.snapshotEvents(); } catch { return []; } };
  const mark = snapshot().at(-1)?.seq ?? 0;
  const sent = String(prompt).trim();
  await agent.followup({ content: [{ type: 'text', text: sent }], source: { kind: 'listen-together' } });
  await withTimeout(agent.whenIdle(), TIMEOUT, '会话太久没回话');
  const events = snapshot();
  const userIndex = events.findLastIndex(event => event.type === 'user/message' && eventText(event) === sent);
  const turn = userIndex >= 0 ? (events[userIndex].data?.turn ?? events[userIndex].data?.message?.turn ?? null) : null;
  let candidates;
  if (userIndex >= 0) {
    const after = events.slice(userIndex + 1);
    candidates = turn === null ? after.filter(event => event.type === 'assistant/message')
      : after.filter(event => event.type === 'assistant/message' && (event.data?.turn ?? null) === turn);
  } else {
    candidates = events.filter(event => event.type === 'assistant/message' && event.seq > mark);
  }
  const last = candidates.at(-1);
  const text = replyText(last?.data?.message ?? last?.data);
  if (!text) throw new Error('这一轮没有拿到回复');
  return text;
}

// 把房间上下文拼成一句请求，让它用自己的语气回话。
export function buildPrompt({ messages = [], music = null, config = {} }) {
  const lines = ['（这是系统转过来的，不是 DSH 里的主人对你说的话。）', '你现在在网易云「一起听」的房间里，和对方一起听歌。'];
  if (music?.name) lines.push('正在听：《' + music.name + '》' + (music.artists ? ' - ' + music.artists : ''));
  const recent = messages.slice(-8).map(item => `${item.from || '对方'}：${item.text}`).join('\n');
  if (recent) lines.push('刚才房间里说：', recent);
  lines.push(`用你平时说话的语气回一句，${Math.max(10, (config.replyMaxChars ?? 60) - 10)} 字以内。`);
  lines.push('直接说，不要引号、不要解释、不要列点、不要带表情标记。');
  return lines.join('\n');
}

export { replyText };
