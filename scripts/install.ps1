<#
把本插件安装进当前 DSH profile 的 node_modules，并在 profile 补丁里登记。

为什么要“复制”而不是软链接：
  宿主半边 `index.js` 会 `import z from '@deepseek-ai/schemastery'`，
  Node 解析包时用的是**符号链接的真实路径**，所以链接进 profile 的插件会从
  源码目录向上找 node_modules，从而找不到 schemastery。真实目录才是标准安装形态
  （和 profile 里其它第三方插件一致）。

用法：
  pwsh -File scripts/install.ps1              # 装进当前 DSH profile
  pwsh -File scripts/install.ps1 -ProfileDir C:\Users\me\.dsh\profiles\web
#>
param(
  [string]$ProfileDir = $env:DSH_PROFILE_DIR
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ProfileDir)) {
  $ProfileDir = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
  Write-Host "未检测到 DSH_PROFILE_DIR，回退到 $ProfileDir"
}
if (-not (Test-Path $ProfileDir)) { throw "profile 目录不存在：$ProfileDir" }

$source = Split-Path -Parent $PSScriptRoot
$target = Join-Path $ProfileDir 'node_modules\@local\dsh-plugin-brand'

New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
if (Test-Path $target) {
  # 软链接要用 rmdir 单独处理，避免跟着链接删到源码
  $item = Get-Item $target -Force
  if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
    cmd /c rmdir "$target"
  } else {
    Remove-Item $target -Recurse -Force
  }
}
New-Item -ItemType Directory -Force -Path $target | Out-Null

foreach ($name in @('package.json', 'host.js', 'client.js', 'cordis.patch.yml', 'README.md')) {
  Copy-Item (Join-Path $source $name) (Join-Path $target $name) -Force
}

$patch = Join-Path $ProfileDir 'cordis.patch.yml'
if (-not (Test-Path $patch)) { throw "profile 补丁不存在：$patch" }
if ((Get-Content $patch -Raw) -notmatch 'id:\s*custom-brand') {
  Add-Content -Path $patch -Value "`n# 自定义品牌（logo / 标语）`n- insert:`n    - id: custom-brand`n      name: '@local/dsh-plugin-brand'"
  Write-Host "已在 profile 补丁中登记 custom-brand"
} else {
  Write-Host "profile 补丁中已有 custom-brand，跳过登记"
}

Write-Host "已安装到 $target"
Write-Host "刷新页面即可看到「设置 → 品牌」"
