# 把這個資料夾的伺服器與通道關掉（不會動到其他專案）
Set-Location $PSScriptRoot
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
$n = Stop-Mine
Write-Host "已關閉 $n 個程序（只含這個資料夾的）。"
