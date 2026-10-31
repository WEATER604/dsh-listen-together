# dsh-listen-together

给 [DeepSeek Harness](https://www.deepseek.com/harness/)（DSH）用的网易云「一起听」插件：在 **设置** 里单开一栏，登录一个网易云账号，粘贴邀请链接就能进房；房间里的消息记在这一栏里，还可以绑一个 DSH 会话，让回复用那个会话的人格。

独立插件，不依赖任何其他项目或服务，所有数据都存在本机。

## 功能

- **登录**：网易云 App 扫码（本地生成二维码），或者直接粘 `MUSIC_U` cookie。
- **进房**：粘贴「一起听」邀请链接（`listen-together/share` 双人房、`multishare` 多人房都认）。
- **在场**：定时心跳、跟着房间同步当前歌曲。
- **说话**：在房间里发消息；多人房发在房间聊天室，双人房发到网易云私信。
- **记录**：进房、换歌、收发消息都记一条，插件里直接翻。
- **自动退出**：可以设「听满 N 分钟」或「听满 N 首歌」就自己退房，两个都填 0 表示不启用。
- **人格**：绑定一个 DSH 会话后，可以把房间里的新消息交给它，用那个会话的人格生成回复再发回去。

## 安装

插件目录放到任意位置，然后链接进 DSH 的 profile（把 `<插件目录>` 换成你自己的路径）：

```powershell
$profile = "$env:USERPROFILE\.dsh\profiles\desktop"
$src = "<插件目录>"   # 例：D:\plugins\dsh-listen-together

New-Item -ItemType Junction -Path "$profile\node_modules\dsh-listen-together" -Target $src
```

再编辑 `$profile\package.json`：

- `dependencies` 里加一行：`"dsh-listen-together": "link:<插件目录>"`
- `dsh.profile.bundles` 里加一项：`"dsh-listen-together"`

保存后刷新 DSH 页面；如果设置里没出现，完整重开一次 DSH。

> macOS / Linux 把 `New-Item -ItemType Junction` 换成 `ln -s`，路径用正斜杠即可。

## 使用

1. 打开 **设置 → 一起听**。
2. 点「用二维码登录」，用网易云音乐 App 扫码确认；或者粘 cookie。
3. 在网易云里开一个「一起听」，把邀请链接复制过来，粘进「进房间」，点「进去」。
4. 房间里的消息会出现在「房间记录」里。
5. 想让回复有性格：在「绑定 DSH 会话」里选一个会话，打开「有人说话就自动回一句」，保存。

## 数据放在哪

默认在 `~/.dsh/listen-together/`，可用环境变量 `DSH_LISTEN_TOGETHER_DIR` 改：

| 文件 | 内容 |
| --- | --- |
| `account.json` | 网易云 cookie（只在本机，不会上传） |
| `config.json` | 心跳间隔、绑定会话、自动回复等设置 |
| `state.json` | 当前房间、当前歌曲、上次错误 |
| `chat.jsonl` | 房间记录 |

## 已知限制

- **双人房没有房间聊天接口**（官方只给多人房开了聊天室，双人房走云信私有协议）。所以双人房里「说话」实际是发网易云私信，记录里也会标出来。
- 多人房的聊天室接口对频率和内容有限制（发太快会被拒）。
- 自动回复要绑定一个**正在用或能恢复**的 DSH 会话；会话恢复失败时会在记录里留一条错误。
- 网易云**电脑版**没有「一起听」的入口，房间只在手机端显示；插件是走接口进房，所以电脑客户端里看不到房间是正常的。
- 一起听房间有时效：对方退出或超时后房间就散了，这时进房会提示「房间已失效」，让对方重新开一个再发链接。

## 隐私

cookie 只写在本机的 `~/.dsh/listen-together/account.json`，插件不联网发送给任何第三方；所有请求都直接发往 `music.163.com`。

## 开发

```text
index.js          宿主半边：路由、轮询、登录/进房/说话
client.js         设置页（React，走 window.__ModuleLoader__）
lib/netease.mjs   网易云接口层（明文 / weapi / eapi）
lib/room.mjs      房间：邀请解析、心跳、收发消息
lib/session.mjs   绑定 DSH 会话、用会话的人格生成回复
lib/store.mjs     本机存储
vendor/qrcode.mjs 二维码渲染（qrcode-generator，MIT）
```

## License

MIT。二维码渲染使用 [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)（MIT）。
