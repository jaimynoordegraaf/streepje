# Starts the Expo dev server, pinned to this PC's real LAN address.
#
# Without the pin, Expo can advertise one of the VMware virtual adapters
# (192.168.196.1 / 192.168.149.1) in the QR code, which your phone cannot reach.
# This picks the address on the interface that actually has the default route.

$route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    Sort-Object RouteMetric | Select-Object -First 1

if ($null -eq $route) {
    Write-Host "No network connection found." -ForegroundColor Red
    exit 1
}

$ip = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex |
    Select-Object -First 1).IPAddress

Write-Host "Serving on $ip (interface: $($route.InterfaceAlias))" -ForegroundColor Green
Write-Host "Your phone must be on the same network. If it will not connect, run:" -ForegroundColor DarkGray
Write-Host "  npx expo start --tunnel" -ForegroundColor DarkGray
Write-Host ""

$env:REACT_NATIVE_PACKAGER_HOSTNAME = $ip
npx expo start
