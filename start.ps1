# 連線遊戲・一鍵啟動（炸彈超人＋十六張）
#   .\start.ps1          只開本機與區網（最穩，同一個家裡的人可以玩）
#   .\start.ps1 -Public  另外開一條臨時公開通道（外面的朋友可以玩，但網址每次都不一樣）
param([switch]$Public)

$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot

# 先把舊的收掉，免得連到上一輪的殘骸
# 只收掉「這個資料夾」的伺服器與「指向這個埠」的通道。
# 原本是無差別砍 node *server.mjs* 與所有 cloudflared，
# 會把其他專案（例如 japan-menu）的伺服器和通道一起殺掉 —— 實測踩過。
$here = (Resolve-Path $PSScriptRoot).Path
function Stop-Mine {
  $n = 0
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$here\server.mjs*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $n++ }
  Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*localhost:8787*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $n++ }
  return $n
}
$null = Stop-Mine
Start-Sleep 1

if (-not (Test-Path node_modules)) { Write-Host "第一次執行，安裝相依套件…"; npm install --no-audit --no-fund | Out-Null }

Start-Process node -ArgumentList "`"$here\server.mjs`"" -WorkingDirectory $here -WindowStyle Hidden -RedirectStandardOutput "server.log" -RedirectStandardError "server.err"
Start-Sleep 2
try { Invoke-WebRequest "http://localhost:8787/" -UseBasicParsing -TimeoutSec 5 | Out-Null }
catch { Write-Host "✗ 伺服器沒起來，看 server.err" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "✓ 伺服器已啟動" -ForegroundColor Green
Write-Host "  這台電腦　炸彈超人：http://localhost:8787/"
Write-Host "  這台電腦　十六張　：http://localhost:8787/mahjong.html"
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
  ForEach-Object {
    Write-Host "  同網路　　炸彈超人：http://$($_.IPAddress):8787/"
    Write-Host "  同網路　　十六張　：http://$($_.IPAddress):8787/mahjong.html"
  }

if (-not $Public) {
  Write-Host ""
  Write-Host "要讓外面的朋友連進來，改用：  .\start.ps1 -Public" -ForegroundColor Yellow
  exit 0
}

Write-Host ""
Write-Host "開臨時公開通道…（網址每次都會變，且要等 DNS 生效）"
Remove-Item tunnel.log -ErrorAction SilentlyContinue
Start-Process cmd.exe -ArgumentList "/c npx -y cloudflared tunnel --url http://localhost:8787 > tunnel.log 2>&1" -WindowStyle Hidden

$url = $null
for ($i = 0; $i -lt 25; $i++) {
  Start-Sleep 3
  if (Test-Path tunnel.log) {
    $m = Select-String -Path tunnel.log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -AllMatches |
         ForEach-Object { $_.Matches.Value } | Select-Object -First 1
    if ($m) { $url = $m; break }
  }
}
if (-not $url) { Write-Host "✗ 沒拿到公開網址，看 tunnel.log" -ForegroundColor Red; exit 1 }

Write-Host "  拿到網址：$url"
Write-Host "  等 DNS 生效…（最多兩分鐘，這一步不能跳過）"
$ok = $false
for ($i = 1; $i -le 16; $i++) {
  Start-Sleep 8
  try { Invoke-WebRequest "$url/" -UseBasicParsing -TimeoutSec 12 | Out-Null; $ok = $true; break }
  catch { Write-Host "    第 $i 次還沒生效…" }
}
Write-Host ""
if ($ok) {
  Write-Host "✓ 公開網址可以用了：" -ForegroundColor Green
  Write-Host "  炸彈超人：$url/" -ForegroundColor Cyan
  Write-Host "  十六張　：$url/mahjong.html" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "  傳給朋友前，自己先用瀏覽器開一次確認。"
  Write-Host "  如果對方說開不了，多半是 DNS 還沒傳到他那邊，等一兩分鐘再試。"
} else {
  Write-Host "✗ 通道建立了但網址還連不上：$url" -ForegroundColor Red
  Write-Host "  臨時通道本來就不穩。要穩定請改用 Render（見 README）。"
}
Write-Host ""
Write-Host "要關掉：  .\stop.ps1"
