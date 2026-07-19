# TrucVPN Windows System Proxy Helper
# Sets or clears the Windows system proxy to route through TrucVPN

param([string]$Action = "set", [string]$ProxyHost = "127.0.0.1", [int]$ProxyPort = 1080)

$regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"

if ($Action -eq "set") {
    Set-ItemProperty -Path $regPath -Name ProxyEnable -Value 1
    Set-ItemProperty -Path $regPath -Name ProxyServer -Value "$ProxyHost`:$ProxyPort"
    Set-ItemProperty -Path $regPath -Name ProxyOverride -Value "<local>"
    Write-Host "Proxy set to $ProxyHost`:$ProxyPort"
} elseif ($Action -eq "clear") {
    Set-ItemProperty -Path $regPath -Name ProxyEnable -Value 0
    Write-Host "Proxy cleared"
}

# Notify system of changes
$signature = @"
[DllImport(""wininet.dll"", SetLastError=true)]
public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
"@
$type = Add-Type -MemberDefinition $signature -Name WinINet -Namespace PInvoke -PassThru
$type::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0)
$type::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0)
