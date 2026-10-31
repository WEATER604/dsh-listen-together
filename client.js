/**
 * dsh-listen-together 的客户端半边：DSH 设置里的「一起听」一栏。
 * 数据走宿主路由 /dsh-listen-together（自定义头挡跨站请求）。
 * 注册 id 必须等于包名，否则 ModuleLoader 会报 "loaded without registering"。
 */
window.__ModuleLoader__.load({
  id: 'dsh-listen-together',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const { useState, useEffect, useCallback, useRef } = React
    const inject = ['slots']
    const BASE = '/dsh-listen-together'
    const HEADERS = { 'x-dsh-listen-together': '1' }

    const getJson = (path) => fetch(BASE + path, { cache: 'no-store', headers: HEADERS }).then((r) => r.json())
    const postJson = (path, body) => fetch(BASE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...HEADERS },
      body: JSON.stringify(body || {}),
    }).then((r) => r.json())

    const CSS = [
      '.lt{display:flex;flex-direction:column;gap:16px;padding:2px 0;font-size:13px;color:var(--dsw-alias-label-primary);max-width:820px}',
      '.lt .card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:14px 16px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:10px}',
      '.lt .card h3{margin:0;font-size:13px;font-weight:600}',
      '.lt .sub{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.6}',
      '.lt .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}',
      '.lt .switch{position:relative;width:36px;height:20px;border-radius:999px;background:var(--dsw-alias-border-l1);cursor:pointer;transition:background .15s ease;flex:none;display:inline-block}',
      '.lt .switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2);transition:transform .15s ease}',
      '.lt .switch.on{background:var(--dsw-alias-brand-primary)}',
      '.lt .switch.on::after{transform:translateX(16px)}',
      '.lt input[type=text],.lt input[type=password],.lt input[type=number],.lt select{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 10px;font-size:13px;outline:none}',
      '.lt input:focus,.lt select:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.lt button{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:5px 12px;font-size:13px;cursor:pointer}',
      '.lt button:hover{border-color:var(--dsw-alias-brand-primary)}',
      '.lt button:disabled{opacity:.5;cursor:default}',
      '.lt .primary{background:var(--dsw-alias-button-primary-fill);border-color:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}',
      '.lt .notice{padding:8px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.lt .bad{color:#d9534f}',
      '.lt .ok{color:#2f9e5f}',
      '.lt .qr{display:flex;justify-content:center;padding:12px;background:#fff;border-radius:12px;width:max-content;border:1px solid var(--dsw-alias-border-l1)}',
      '.lt .qr svg{display:block;width:180px;height:180px}',
      '.lt .stat{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}',
      '.lt .stat div{padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-2)}',
      '.lt .stat b{display:block;font-size:13px;margin-bottom:2px}',
      '.lt .stat span{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.lt .log{max-height:320px;overflow:auto;display:flex;flex-direction:column;gap:6px;padding:4px}',
      '.lt .line{display:flex;gap:8px;align-items:flex-start;font-size:12px;line-height:1.5}',
      '.lt .line time{flex:none;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.lt .line .who{flex:none;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}',
      '.lt .line.in .txt{color:var(--dsw-alias-label-primary)}',
      '.lt .line.out .txt{color:var(--dsw-alias-brand-primary)}',
      '.lt .line.song .txt,.lt .line.system .txt,.lt .line.error .txt{color:var(--dsw-alias-label-secondary);font-style:italic}',
    ].join('')

    const time = (at) => {
      if (!at) return ''
      const d = new Date(at)
      const p = (n) => String(n).padStart(2, '0')
      return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
    }

    function useStyle() {
      useEffect(() => {
        const id = 'dsh-listen-together-style'
        if (document.getElementById(id)) return undefined
        const el = document.createElement('style')
        el.id = id
        el.textContent = CSS
        document.head.appendChild(el)
        return () => { el.remove() }
      }, [])
    }

    const Switch = ({ on, onChange, label }) => React.createElement(
      'label',
      { className: 'row', style: { cursor: 'pointer' } },
      React.createElement('span', { className: 'switch' + (on ? ' on' : ''), onClick: () => onChange(!on) }),
      React.createElement('span', null, label),
    )

    function Section() {
      useStyle()
      const [data, setData] = useState(null)
      const [draft, setDraft] = useState(null)
      const [error, setError] = useState('')
      const [message, setMessage] = useState('')
      const [busy, setBusy] = useState('')
      const [cookie, setCookie] = useState('')
      const [link, setLink] = useState('')
      const [say, setSay] = useState('')
      const [qr, setQr] = useState(null)
      const [qrStatus, setQrStatus] = useState('')
      const logRef = useRef(null)

      const load = useCallback(async () => {
        try {
          const result = await getJson('/snapshot')
          if (!result.ok) throw new Error(result.error || '读不到状态')
          setData(result)
          setDraft((prev) => prev ?? result.config)
          setError('')
        } catch (caught) {
          setError(String(caught.message || caught))
        }
      }, [])

      useEffect(() => { void load() }, [load])
      useEffect(() => {
        const timer = setInterval(() => { void load() }, 5000)
        return () => clearInterval(timer)
      }, [load])
      useEffect(() => {
        const el = logRef.current
        if (el) el.scrollTop = el.scrollHeight
      }, [data?.log?.length])

      useEffect(() => {
        if (!qr?.key) return undefined
        let alive = true
        const timer = setInterval(async () => {
          try {
            const result = await postJson('/login/qr/status', { key: qr.key })
            if (!alive) return
            if (!result.ok) { setQrStatus(result.error || '查不到状态'); return }
            if (result.code === 800) { setQrStatus('二维码过期了，重新生成'); clearInterval(timer) }
            else if (result.code === 802) setQrStatus('扫到了，在手机上点确认')
            else if (result.code === 803) {
              clearInterval(timer)
              setQrStatus('登录成功' + (result.account?.name ? '：' + result.account.name : ''))
              setQr(null)
              void load()
            }
          } catch {}
        }, 2000)
        return () => { alive = false; clearInterval(timer) }
      }, [qr, load])

      const patch = (key, value) => setDraft((prev) => ({ ...prev, [key]: value }))
      const flash = (text) => { setMessage(text); setTimeout(() => setMessage(''), 2500) }

      async function run(name, task) {
        setBusy(name); setError('')
        try { return await task() } finally { setBusy('') }
      }

      const save = () => run('save', async () => {
        const result = await postJson('/save', { config: draft })
        if (!result.ok) { setError(result.error); return }
        setDraft(result.config)
        flash('已保存')
        void load()
      })

      const loginQr = () => run('qr', async () => {
        setQr(null); setQrStatus('正在生成二维码…')
        const result = await postJson('/login/qr', {})
        if (!result.ok) { setQrStatus(result.error); return }
        setQr({ key: result.key, svg: result.svg })
        setQrStatus('用网易云音乐 App 扫一扫，扫完在手机上点确认')
      })

      const loginCookie = () => run('cookie', async () => {
        if (!cookie.trim()) { setError('先把 cookie 粘进来'); return }
        const result = await postJson('/login/cookie', { cookie: cookie.trim() })
        if (!result.ok) { setError(result.error); return }
        setCookie('')
        flash('登录成功：' + (result.account?.name || ''))
        void load()
      })

      const join = () => run('join', async () => {
        if (!link.trim()) { setError('先粘邀请链接'); return }
        const result = await postJson('/join', { link: link.trim() })
        if (!result.ok) { setError(result.error); return }
        setLink('')
        flash('进房间了')
        void load()
      })

      const leave = () => run('leave', async () => {
        const result = await postJson('/leave', {})
        if (!result.ok) { setError(result.error); return }
        flash('已经离开')
        void load()
      })

      const speak = () => run('say', async () => {
        if (!say.trim()) { setError('先写一句'); return }
        const result = await postJson('/say', { text: say.trim() })
        if (!result.ok) { setError(result.error); return }
        setSay('')
        void load()
      })

      const bind = (sessionId) => run('bind', async () => {
        const result = await postJson('/bind', { sessionId })
        if (!result.ok) { setError(result.error); return }
        patch('sessionId', sessionId)
        flash(sessionId ? '已绑定会话' : '已取消绑定')
      })

      if (!data) {
        return React.createElement('div', { className: 'lt' },
          React.createElement('div', { className: 'notice' }, error || '正在读取一起听状态…'))
      }
      const account = data.account || {}
      const room = data.room || {}
      const music = data.music || null
      const sessions = data.sessions || []
      const log = data.log || []

      return React.createElement('div', { className: 'lt' },
        React.createElement('div', { className: 'card' },
          React.createElement('h3', null, '一起听'),
          React.createElement('div', { className: 'sub' },
            '登录你自己的网易云账号，粘贴一起听邀请链接就能进房。房间里的消息会记在这里；绑一个 DSH 会话，它就能用那个会话的人格回话。'),
          React.createElement('div', { className: 'stat' },
            React.createElement('div', null,
              React.createElement('b', { className: account.loggedIn ? 'ok' : 'bad' }, account.loggedIn ? '已登录' : '未登录'),
              React.createElement('span', null, account.profile?.name ? '网易云 · ' + account.profile.name : '网易云账号')),
            React.createElement('div', null,
              React.createElement('b', { className: room.roomId ? 'ok' : '' }, room.roomId ? (room.kind === 'multi' ? '多人房' : '双人房') : '不在房间'),
              React.createElement('span', null, room.roomId ? '房间号 ' + String(room.roomId) + ' · 已听 ' + (data.joinedSongs || 0) + ' 首' : '粘贴邀请链接进房')),
            React.createElement('div', null,
              React.createElement('b', null, music?.name || '—'),
              React.createElement('span', null, music?.artists || '当前歌曲')),
          ),
          data.lastError ? React.createElement('div', { className: 'notice bad' }, '上次的错：' + data.lastError) : null,
        ),

        React.createElement('div', { className: 'card' },
          React.createElement('h3', null, '登录'),
          React.createElement('div', { className: 'row' },
            React.createElement('button', { disabled: !!busy, onClick: loginQr }, '用二维码登录'),
            React.createElement('span', { className: 'sub' }, qrStatus || '拿网易云 App 扫一下'),
            account.loggedIn ? React.createElement('button', { disabled: !!busy, onClick: () => run('logout', async () => { await postJson('/logout', {}); void load() }) }, '退出登录') : null,
          ),
          qr ? React.createElement('div', { className: 'qr', dangerouslySetInnerHTML: { __html: qr.svg } }) : null,
          React.createElement('div', { className: 'row' },
            React.createElement('input', {
              type: 'password', value: cookie, placeholder: '或者粘 cookie：MUSIC_U=...; __csrf=...',
              style: { flex: '1 1 320px' }, onChange: (event) => setCookie(event.target.value),
            }),
            React.createElement('button', { disabled: !!busy, onClick: loginCookie }, busy === 'cookie' ? '验证中…' : '保存并验证'),
          ),
        ),

        React.createElement('div', { className: 'card' },
          React.createElement('h3', null, '进房间'),
          React.createElement('div', { className: 'row' },
            React.createElement('input', {
              type: 'text', value: link, placeholder: '把微信里那条一起听邀请链接整段粘进来',
              style: { flex: '1 1 360px' }, onChange: (event) => setLink(event.target.value),
            }),
            React.createElement('button', { className: 'primary', disabled: !!busy, onClick: join }, busy === 'join' ? '进房中…' : '进去'),
            room.roomId ? React.createElement('button', { disabled: !!busy, onClick: leave }, '离开') : null,
          ),
          React.createElement('div', { className: 'row' },
            React.createElement('input', {
              type: 'text', value: say, placeholder: room.roomId ? '在房间里说一句' : '进房以后才能说话',
              style: { flex: '1 1 360px' }, onChange: (event) => setSay(event.target.value),
            }),
            React.createElement('button', { disabled: !!busy || !room.roomId, onClick: speak }, '说'),
          ),
          React.createElement('div', { className: 'row' },
            React.createElement(Switch, { on: draft?.sayOnJoin === true, label: '进房时先打个招呼', onChange: (v) => patch('sayOnJoin', v) }),
            React.createElement('span', { className: 'sub' }, '心跳'),
            React.createElement('input', {
              type: 'number', min: 5, max: 120, value: draft?.heartbeatSeconds ?? 15, style: { width: '72px' },
              onChange: (event) => patch('heartbeatSeconds', Number(event.target.value)),
            }),
            React.createElement('span', { className: 'sub' }, '秒'),
            React.createElement('button', { className: 'primary', disabled: !!busy, onClick: save }, '保存设置'),
          ),
        ),

        React.createElement('div', { className: 'card' },
          React.createElement('h3', null, '自动退出'),
          React.createElement('div', { className: 'sub' }, '听够了就自己退房。两个都填 0 就是不启用；填了哪个，先到哪个就退。'),
          React.createElement('div', { className: 'row' },
            React.createElement('span', { className: 'sub' }, '听满'),
            React.createElement('input', {
              type: 'number', min: 0, max: 1440, value: draft?.autoExitMinutes ?? 0, style: { width: '78px' },
              onChange: (event) => patch('autoExitMinutes', Number(event.target.value)),
            }),
            React.createElement('span', { className: 'sub' }, '分钟，或听满'),
            React.createElement('input', {
              type: 'number', min: 0, max: 500, value: draft?.autoExitSongs ?? 0, style: { width: '78px' },
              onChange: (event) => patch('autoExitSongs', Number(event.target.value)),
            }),
            React.createElement('span', { className: 'sub' }, '首歌，就自动退出'),
            React.createElement('button', { disabled: !!busy, onClick: save }, '保存设置'),
          ),
        ),

        React.createElement('div', { className: 'card' },
          React.createElement('h3', null, '绑定 DSH 会话'),
          React.createElement('div', { className: 'sub' },
            '绑上以后，房间里的消息会用这个会话的人格来生成回复。会话没开着时会尝试恢复它。'),
          React.createElement('div', { className: 'row' },
            React.createElement('select', {
              value: draft?.sessionId || '', style: { flex: '1 1 320px' },
              onChange: (event) => { void bind(event.target.value) },
            },
              React.createElement('option', { value: '' }, '不绑定'),
              sessions.map((item) => React.createElement('option', { key: item.id, value: item.id },
                (item.title || item.id) + (item.live ? ' · 开着' : '')),
              ),
            ),
          ),
          React.createElement('div', { className: 'row' },
            React.createElement(Switch, { on: draft?.autoReply === true, label: '房间里有人说话就自动回一句', onChange: (v) => patch('autoReply', v) }),
            React.createElement('span', { className: 'sub' }, '回复最多'),
            React.createElement('input', {
              type: 'number', min: 10, max: 400, value: draft?.replyMaxChars ?? 60, style: { width: '72px' },
              onChange: (event) => patch('replyMaxChars', Number(event.target.value)),
            }),
            React.createElement('span', { className: 'sub' }, '字'),
            React.createElement('button', { disabled: !!busy, onClick: save }, '保存设置'),
          ),
        ),

        React.createElement('div', { className: 'card' },
          React.createElement('h3', null, '房间记录'),
          React.createElement('div', { className: 'log', ref: logRef },
            log.length === 0
              ? React.createElement('div', { className: 'sub' }, '还没有记录。')
              : log.map((line, index) => React.createElement('div', { key: index, className: 'line ' + (line.kind || 'system') },
                React.createElement('time', null, time(line.at)),
                React.createElement('span', { className: 'who' }, line.kind === 'out' ? '我' : line.kind === 'song' ? '换歌' : line.kind === 'in' ? (line.from || '对方') : ''),
                React.createElement('span', { className: 'txt' }, line.text || ''),
              )),
          ),
          React.createElement('div', { className: 'row' },
            React.createElement('button', { onClick: () => run('clear', async () => { await postJson('/log/clear', {}); void load() }) }, '清空记录'),
            React.createElement('button', { onClick: () => void load() }, '刷新'),
            message ? React.createElement('span', { className: 'ok' }, message) : null,
            error ? React.createElement('span', { className: 'bad' }, error) : null,
          ),
        ),

        React.createElement('div', { className: 'notice' },
          '双人房没有房间聊天接口，说的话会发到网易云私信；多人房直接发在房间聊天室里。'),
      )
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'listen-together', order: 27, label: '一起听' },
        () => React.createElement(Section),
      ))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
