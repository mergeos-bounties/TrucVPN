param(
    [switch]$Enable,
    [switch]$Disable,
    [switch]$DryRun
)

if (-not $Enable -and -not $Disable) {
    Write-Host "Please specify -Enable or -Disable"
    exit 1
}

$regKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
$proxyServer = "127.0.0.1:17881"

if ($Enable) {
    if ($DryRun) {
        Write-Host "[DRY-RUN] Would enable system proxy and set to $proxyServer"
    } else {
        Set-ItemProperty -Path $regKey -Name ProxyEnable -Value 1
        Set-ItemProperty -Path $regKey -Name ProxyServer -Value $proxyServer
        Write-Host "System proxy enabled ($proxyServer)"
    }
} elseif ($Disable) {
    if ($DryRun) {
        Write-Host "[DRY-RUN] Would disable system proxy"
    } else {
        Set-ItemProperty -Path $regKey -Name ProxyEnable -Value 0
        Write-Host "System proxy disabled"
    }
}
