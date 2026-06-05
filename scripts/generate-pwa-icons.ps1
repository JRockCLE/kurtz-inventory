# Generates the PWA icon set for both Kurtz Inventory and Kurtz Scans into
# /public. Run once from the repo root:
#
#   pwsh scripts/generate-pwa-icons.ps1
#
# Re-run any time you want to refresh icons. Replace these with branded
# artwork later — these are just clean placeholders that satisfy Chrome's
# PWA install criteria.

Add-Type -AssemblyName System.Drawing

function New-AppIcon {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][int]   $Size,
        [Parameter(Mandatory)][string]$BgHex,
        [Parameter(Mandatory)][string]$Letter,
        [switch]$Maskable
    )
    $bg = [System.Drawing.ColorTranslator]::FromHtml($BgHex)
    $bmp = New-Object System.Drawing.Bitmap $Size, $Size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.Clear($bg)

    # Maskable icons need 40% safe-zone padding; clip letter to the safe area.
    $padFactor = if ($Maskable) { 0.55 } else { 0.78 }
    $fontSize  = [int]($Size * $padFactor)
    $font  = New-Object System.Drawing.Font 'Segoe UI', $fontSize, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment     = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    # Slight vertical lift — letters look better not perfectly centered
    $g.DrawString($Letter, $font, $brush, ($Size / 2), ($Size / 2 - $Size * 0.04), $sf)

    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $brush.Dispose(); $font.Dispose(); $g.Dispose(); $bmp.Dispose()
    Write-Host "  wrote $Path"
}

$root  = Split-Path -Parent $PSScriptRoot
$out   = Join-Path $root 'public'

Write-Host "Generating Kurtz Inventory icons (amber)..."
New-AppIcon -Path (Join-Path $out 'icon-inventory-192.png')          -Size 192 -BgHex '#d97706' -Letter 'K'
New-AppIcon -Path (Join-Path $out 'icon-inventory-512.png')          -Size 512 -BgHex '#d97706' -Letter 'K'
New-AppIcon -Path (Join-Path $out 'icon-inventory-512-maskable.png') -Size 512 -BgHex '#d97706' -Letter 'K' -Maskable

Write-Host "Generating Kurtz Scans icons (slate)..."
New-AppIcon -Path (Join-Path $out 'icon-scans-192.png')          -Size 192 -BgHex '#1f2937' -Letter 'S'
New-AppIcon -Path (Join-Path $out 'icon-scans-512.png')          -Size 512 -BgHex '#1f2937' -Letter 'S'
New-AppIcon -Path (Join-Path $out 'icon-scans-512-maskable.png') -Size 512 -BgHex '#1f2937' -Letter 'S' -Maskable

Write-Host ""
Write-Host "Done. Hard-reload the browser after re-running build."
