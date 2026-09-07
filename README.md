# cc-notify-center — Claude Code 通知聚合浮窗 + 任务记录

一个 Windows 桌面常驻浮窗,解决两个问题:

1. **CC 通知易丢失**:Claude Code 完成任务的通知转瞬即逝,多会话并行时互相淹没 → 所有 CC 会话的完成通知**聚合为条目列表**,不丢、可追溯、可勾掉
2. **今天干了什么没有记录** → 内置**任务记录面板**(今日任务/长期任务),完成后划线沉底,随时回看

> 纯本地运行:Electron 应用 + 一个 PowerShell hook 脚本,无任何云端依赖,数据全部落在本地 `data/` 目录。

## 功能一览

**右栏 · CC 通知**
- 所有 CC 会话的任务完成通知实时推送,自动播放 Windows 通知音效
- 条目:时间 + 项目路径(按项目着色)+ 触发的 prompt(截断显示,悬浮看全文且保留换行)
- 同项目 + 同会话只保留一条,新通知顶替旧条目(不同会话共存)
- 闭环只能通过「已处理」按钮(防误点);全部处理完显示统计(今天/本周已闭环)
- 自动过滤系统注入的回合(`<task-notification>`、本地命令回显等),只统计你的真实 prompt

**左栏 · 任务记录**
- 今日任务 / 长期任务两个分区;新增时可选分区;条目=标题(悬浮看全文)+ 可展开编辑(Ctrl+Enter 保存)
- 拖拽排序、跨区移动(今日 ↔ 长期)
- 「完成」按钮(悬浮显现):完成后划线变暗、沉底;可恢复;删除进**回收站**(区分「完成/废弃」,可恢复或彻底删除)

**窗口控制**
- `Alt+Q` 全局唤出/隐藏;关窗=隐藏到托盘;窗口位置/大小/置顶状态记忆
- 标题栏 `⛶` 悬浮贴靠菜单:左/右/上/下半屏 + 四角 1/4 屏
- `📌` 置顶开关(点亮=置顶;不想挡内容可临时取消)

## 环境要求

- Windows 10 / 11
- [Node.js](https://nodejs.org/) ≥ 18(含 npm)
- PowerShell 5.1+(系统自带)

## 安装

```bash
git clone https://github.com/GXLooong/cc-notify-center.git
cd cc-notify-center
npm install
```

国内网络建议先配置 Electron 二进制镜像(仓库已自带 `.npmrc`,通常无需手动配):

```
electron_mirror=https://npmmirror.com/mirrors/electron/
```

**音效文件**(可选,不复制只是没声音):

```powershell
copy "C:\Windows\Media\Windows Notify System Generic.wav" assets\notify.wav
```

## 启动

双击 **`launch.vbs`**(推荐,无黑窗闪烁)或 `start.bat`。

> ⚠️ 已知坑:如果系统环境变量里有 `ELECTRON_RUN_AS_NODE=1`,直接运行 electron.exe 会变成纯 Node 模式(无窗口)。两个启动脚本都已处理该问题。

启动后窗口默认隐藏逻辑:关闭窗口 = 隐藏到托盘,`Alt+Q` 随时唤出。

## 接入 Claude Code(核心)

### 原理

```
[CC 会话] --Stop hook 触发--> hooks/stop-notify.ps1(解析 stdin JSON:项目路径/prompt/会话ID)
          --POST--> 浮窗内置 HTTP 服务(127.0.0.1:39129) --> 条目入列 + 播放音效
```

hook 配在**用户级** `~/.claude/settings.json`,对你**所有项目**的 CC 会话生效。

### 配置步骤

编辑 `C:\Users\<你>\.claude\settings.json`,加入(已有 `hooks` 键则合并进去):

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "powershell -ExecutionPolicy Bypass -File <仓库路径>/hooks/stop-notify.ps1"
          }
        ]
      }
    ]
  }
}
```

把 `<仓库路径>` 换成你的实际克隆路径,例如 `D:/app/cc-notify-center/hooks/stop-notify.ps1`(注意用正斜杠)。

### 验证

1. 双击 `launch.vbs` 启动浮窗
2. 随便打开一个 CC 会话,发一条消息
3. 回合结束时浮窗应弹出条目(带音效),显示项目路径 + 你刚输入的 prompt

### 已处理的边界情况(脚本内建)

- `stop_hook_active=true` 的续接触发不重复通知
- `<task-notification>`(后台任务完成唤醒)、`<local-command-*>`(斜杠命令回显)、`<system-reminder>`、`Continue from where you left off.`(会话恢复标记)等**系统注入回合不通知、不计数**——你消息里粘贴了这类内容但带有自己的文字时,正常通知

## 公司内网使用(GitHub 中转)

内网机器不能直接拷入个人文件时,用 GitHub 做跳板:

```
家里/外网:push 到 GitHub
公司内网:git clone https://github.com/GXLooong/cc-notify-center.git
```

公司机器上的完整流程:

1. `git clone` 上述仓库(若 GitHub 直连不通,配置公司代理:`git config --global http.proxy <proxy>` 后重试)
2. `npm install`(若 npm 源不通,先 `npm config set registry https://registry.npmmirror.com`)
3. 复制音效文件(见上文,可选)
4. `launch.vbs` 启动浮窗
5. 在内网机器的 `~/.claude/settings.json` 配置 hook,路径指向**内网机器上的克隆路径**(每台机器路径不同,改对应值即可)
6. 完成——hook 与浮窗之间只走 `127.0.0.1` 本机回环,无任何外网请求

> 数据同步:`data/` 目录被 gitignore,两台机器的通知/任务数据各自独立,不会互相覆盖。想人工迁移,拷贝整个 `data/` 文件夹即可。

## 使用指南

| 操作 | 方式 |
|---|---|
| 唤出/隐藏浮窗 | `Alt+Q` 或托盘图标单击 |
| 通知条目闭环 | 点条目右侧「已处理」(点击条目本体无效,防误点) |
| 看 prompt 全文 | 悬浮截断的 prompt,tooltip 可滚动 |
| 全部闭环 | 右栏底部「全部清理」 |
| 窗口贴靠 | 标题栏 `⛶` 悬浮展开,选半屏/四角(相对浮窗**当前所在屏幕**,多屏友好) |
| 置顶开关 | 标题栏 `📌` |
| 新增任务 | 左栏「＋新增」,选今日/长期,Ctrl+Enter 保存 |
| 编辑任务 | 条目左侧 `▸` 展开,Ctrl+Enter 保存,Esc 收起 |
| 完成任务 | 悬浮条目 → 绿色「完成」→ 划线变暗沉底;「恢复」可反悔 |
| 删除任务 | 条目右侧 `✕` → 回收站(左下角入口,区分完成/废弃,可恢复/彻底删除) |

## 数据与隐私

- 所有数据(通知流水、闭环记录、任务、窗口配置)都在本地 `data/` 目录
- `data/` 已被 `.gitignore` 排除,**永远不会**被提交或上传
- 通知音效不随仓库分发(Windows 系统文件有版权),见 `assets/README.md`
- hook 脚本只向 `127.0.0.1:39129` 发送本机回环请求,无外网通信

## 故障排查

| 现象 | 处理 |
|---|---|
| 浮窗启动闪退 / 变成终端输出 | 检查环境变量 `ELECTRON_RUN_AS_NODE`,启动脚本已处理,勿绕过 |
| CC 完成任务但浮窗没反应 | ①浮窗是否在运行(`Alt+Q` 试试) ②`settings.json` 里 hook 路径是否正确 ③改过 hook 后需重启 CC 会话 |
| 换端口 | 同时改 `main.js` 顶部 `PORT` 和 `hooks/stop-notify.ps1` 里的 URL(两处保持一致) |
| `Alt+Q` 无效 | 被其它程序占用;改 `main.js` 中 `globalShortcut.register('Alt+Q', ...)` |
| 没有通知音效 | 复制音效文件(见安装步骤) |
| PowerShell 中文乱码 | 脚本已内建 UTF-8 处理;若自行修改脚本,**务必保存为带 BOM 的 UTF-8**(PS 5.1 无 BOM 会按 GBK 误读) |

## License

[MIT](LICENSE)
