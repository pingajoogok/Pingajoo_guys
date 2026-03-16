# SEB Tab-Switch Bypass Proxy

A lightweight Node.js HTTP proxy that sits between Safe Exam Browser and your exam server. It injects JavaScript into HTML pages to block tab-switch detection.

## Requirements

- Node.js (any recent version — v14+)
- **No npm install needed** — zero dependencies

## Quick Start

```bash
# Navigate to this directory
cd seb-proxy

# Start the proxy (replace with your exam server IP)
node proxy.js 192.168.1.50

# Or if the exam server uses a custom port
node proxy.js 192.168.1.50:3000

# Or specify a custom proxy port
node proxy.js 192.168.1.50:3000 9090
```

Then open `http://localhost:8080` in SEB instead of the exam server IP directly.

## How to Use with SEB

### Option 1: Change the exam URL (easiest)
If you can control the URL that SEB opens, point it to `http://localhost:8080` instead of the exam server IP.

### Option 2: System proxy
1. Open Windows Settings → Network & Internet → Proxy
2. Enable manual proxy: `127.0.0.1`, port `8080`
3. SEB will route traffic through the proxy

### Option 3: Hosts file redirect
Add to `C:\Windows\System32\drivers\etc\hosts`:
```
127.0.0.1  <exam-server-ip>
```
Then the proxy will intercept traffic to that IP.

## What It Bypasses

| Detection | Status |
|---|---|
| `document.hidden` | Always `false` ✓ |
| `document.visibilityState` | Always `"visible"` ✓ |
| `visibilitychange` event | Blocked ✓ |
| `blur` / `focus` events | Blocked ✓ |
| `document.hasFocus()` | Always `true` ✓ |
| `onbeforeunload` | Blocked ✓ |

## Troubleshooting

- **Port in use**: Try a different port: `node proxy.js 192.168.1.50 9090`
- **Connection refused**: Make sure the exam server IP and port are correct
- **SEB won't connect**: Ensure localhost is not blocked in SEB's URL filter
