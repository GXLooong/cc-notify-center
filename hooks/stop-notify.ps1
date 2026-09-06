# cc-notify-center:Claude Code Stop hook → 通知聚合浮窗
# 每次 CC 回合结束触发:解析 stdin → 取项目路径 + 触发 prompt → POST 到浮窗(127.0.0.1:39129)
# 浮窗负责播系统音效(替代原 stop-toast.ps1 的 Windows Toast)

# PowerShell 5.1 读 stdin 默认按系统代码页(GBK)解码,$input 自动变量不受 InputEncoding 控制
# 正确做法:从标准输入流读原始字节,按 UTF-8 解码(CC 传的 hook JSON 是 UTF-8)
$stdin = [Console]::OpenStandardInput()
$ms = New-Object System.IO.MemoryStream
$stdin.CopyTo($ms)
$inputJson = [System.Text.Encoding]::UTF8.GetString($ms.ToArray())

$hookData = $inputJson | ConvertFrom-Json

# "阻止停止"续接触发(exit code 2 后再次触发):不重复通知
if ($hookData.stop_hook_active -eq $true) {
    exit 0
}

$project = $hookData.cwd
if (-not $project) { $project = $env:CLAUDE_PROJECT_DIR }

# 触发 prompt:优先 stdin 的 prompt 字段;为空则从 transcript 兜底取最后一条用户文本
$prompt = $hookData.prompt

if (-not $prompt -and $hookData.transcript_path) {
    try {
        # JSONL 是 UTF-8,PS 5.1 的 Get-Content 默认按 ANSI 读会乱码——必须指定编码
        $lines = Get-Content $hookData.transcript_path -Encoding UTF8 -ErrorAction Stop
        for ($i = $lines.Length - 1; $i -ge 0; $i--) {
            try { $line = $lines[$i] | ConvertFrom-Json } catch { continue }
            if ($line.type -eq 'user' -and $line.message.role -eq 'user') {
                $c = $line.message.content
                if ($c -is [string]) {
                    $prompt = $c
                } elseif ($c -is [array]) {
                    $texts = @($c | Where-Object { $_.type -eq 'text' } | ForEach-Object { $_.text })
                    if ($texts.Count -gt 0) { $prompt = $texts -join "`n" }
                }
                if ($prompt) { break }
            }
        }
    } catch {}
}

# fallback 用纯 ASCII:脚本文件是无 BOM UTF-8,PS 5.1 会按 GBK 误读中文(乱码无碍逻辑,但值会脏)
# 系统注入的唤醒回合(非用户真实 prompt)不通知:
# 后台任务完成 <task-notification>、本地命令回显 <local-command-*>、系统提醒 <system-reminder> 等
# 判定法:剥掉所有已知系统块后若剩余为空 → 本回合是纯系统唤醒,跳过(不 POST、不计统计)
# 用户消息里粘贴了系统块但后面还有自己文字 → 剥完有剩余,正常通知
$stripped = $prompt
$stripped = $stripped -replace '(?s)<task-notification\b.*?</task-notification>', ''
$stripped = $stripped -replace '(?s)<local-command-caveat\b.*?</local-command-caveat>', ''
$stripped = $stripped -replace '(?s)<command-name\b.*?</command-name>', ''
$stripped = $stripped -replace '(?s)<command-message\b.*?</command-message>', ''
$stripped = $stripped -replace '(?s)<command-args\b.*?</command-args>', ''
$stripped = $stripped -replace '(?s)<local-command-stdout\b.*?</local-command-stdout>', ''
$stripped = $stripped -replace '(?s)<system-reminder\b.*?</system-reminder>', ''
$stripped = $stripped -replace '(?s)<cross-session-message\b.*?</cross-session-message>', ''
# 会话恢复标记(裸文本,无标签):整行精确匹配才剥,避免误杀引用这句话的真实消息
$stripped = $stripped -replace '(?im)^\s*Continue from where you left off\.?\s*$', ''
if ($stripped.Trim() -eq '') { exit 0 }

if (-not $prompt) { $prompt = '(no prompt)' }

# 会话唯一标识:stdin 的 session_id(部分 CC 版本没有);兜底从 transcript_path 文件名提取
# transcript 路径形如 ...\.claude\projects\<project>\<session-id>.jsonl
$sessionId = $hookData.session_id
if (-not $sessionId -and $hookData.transcript_path) {
    try { $sessionId = [System.IO.Path]::GetFileNameWithoutExtension($hookData.transcript_path) } catch {}
}
if ($prompt.Length -gt 2000) { $prompt = $prompt.Substring(0, 2000) }

$body = @{
    ts         = (Get-Date).ToUniversalTime().ToString('o')
    project    = $project
    prompt     = $prompt
    session_id = $sessionId
} | ConvertTo-Json -Compress

try {
    # PS 5.1 的 Invoke-RestMethod 对 string body 按 ANSI 编码,中文会变 '?'
    # 显式转 UTF-8 字节数组发送,保证中文原样
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    Invoke-RestMethod -Uri 'http://127.0.0.1:39129/notify' -Method Post -Body $bodyBytes -ContentType 'application/json' -TimeoutSec 3 | Out-Null
} catch {
    # 浮窗未运行等:静默失败,不影响 CC
}

exit 0
