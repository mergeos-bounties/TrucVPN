// PAC File Generator for TrucVPN
function FindProxyForURL(url, host) {
  // Domains that should bypass the VPN
  var bypass = ["localhost", "127.0.0.1", "*.local", "10.*", "192.168.*"];
  for (var i = 0; i < bypass.length; i++) {
    if (shExpMatch(host, bypass[i])) return "DIRECT";
  }
  // All other traffic goes through the SOCKS proxy
  return "SOCKS5 127.0.0.1:1080; DIRECT";
}
