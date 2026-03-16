#!/usr/bin/env node

/**
 * SEB Tab-Switch Bypass Proxy
 * 
 * A lightweight HTTP reverse proxy that intercepts HTML responses from your
 * exam server and injects JavaScript to block tab-switch detection.
 * 
 * Usage:
 *   node proxy.js <target-server> [proxy-port]
 * 
 * Examples:
 *   node proxy.js 192.168.1.50              → proxy on :8080, target on :80
 *   node proxy.js 192.168.1.50:3000         → proxy on :8080, target on :3000
 *   node proxy.js 192.168.1.50:3000 9090    → proxy on :9090, target on :3000
 * 
 * Then point SEB (or your browser) to http://localhost:8080 instead of the exam server.
 * 
 * Zero dependencies — uses only Node.js built-in modules.
 */

const http = require('http');
const url = require('url');

// ─── Parse CLI Arguments ──────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
  ╔═══════════════════════════════════════════════════════╗
  ║       SEB Tab-Switch Bypass Proxy (Pingajoo)         ║
  ╠═══════════════════════════════════════════════════════╣
  ║                                                       ║
  ║  Usage:                                               ║
  ║    node proxy.js <target-server> [proxy-port]         ║
  ║                                                       ║
  ║  Examples:                                            ║
  ║    node proxy.js 192.168.1.50                         ║
  ║    node proxy.js 192.168.1.50:3000                    ║
  ║    node proxy.js 192.168.1.50:3000 9090               ║
  ║                                                       ║
  ║  Then open http://localhost:<proxy-port> in SEB       ║
  ║  instead of the exam server IP.                       ║
  ║                                                       ║
  ╚═══════════════════════════════════════════════════════╝
  `);
    process.exit(0);
}

const targetArg = args[0];
const proxyPort = parseInt(args[1], 10) || 8080;

let targetHost, targetPort;
if (targetArg.includes(':')) {
    const parts = targetArg.split(':');
    targetHost = parts[0];
    targetPort = parseInt(parts[1], 10);
} else {
    targetHost = targetArg;
    targetPort = 80;
}

// Fix: On Windows, 'localhost' may resolve to IPv6 ::1 causing connection failures
if (targetHost === 'localhost') {
    targetHost = '127.0.0.1';
}

// ─── The Bypass Script ────────────────────────────────────────────────────────
// This JavaScript is injected into every HTML response.
// It blocks all common tab-switch / visibility detection methods.

const BYPASS_SCRIPT = `
<script data-pingajoo-bypass="true">
(function() {
  'use strict';

  // ── 1. Override document.hidden and document.visibilityState ──
  try {
    Object.defineProperty(document, 'hidden', {
      get: function() { return false; },
      configurable: false
    });
  } catch(e) {}

  try {
    Object.defineProperty(document, 'visibilityState', {
      get: function() { return 'visible'; },
      configurable: false
    });
  } catch(e) {}

  // Also handle webkitHidden (older browsers / SEB versions)
  try {
    Object.defineProperty(document, 'webkitHidden', {
      get: function() { return false; },
      configurable: false
    });
  } catch(e) {}

  try {
    Object.defineProperty(document, 'webkitVisibilityState', {
      get: function() { return 'visible'; },
      configurable: false
    });
  } catch(e) {}

  // ── 2. Override document.hasFocus() → always true ──
  document.hasFocus = function() { return true; };

  // ── 3. Block visibilitychange, blur, focus events ──
  var blockedEvents = [
    'visibilitychange', 'webkitvisibilitychange', 'mozvisibilitychange',
    'blur', 'focus',
    'focusin', 'focusout',
    'pageshow', 'pagehide'
  ];

  // Override addEventListener on EventTarget prototype
  var originalAddEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (blockedEvents.indexOf(type) !== -1) {
      // Silently drop the event listener
      return;
    }
    return originalAddEventListener.call(this, type, listener, options);
  };

  // Override removeEventListener too (for consistency)
  var originalRemoveEventListener = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.removeEventListener = function(type, listener, options) {
    if (blockedEvents.indexOf(type) !== -1) {
      return;
    }
    return originalRemoveEventListener.call(this, type, listener, options);
  };

  // ── 4. Block onblur/onfocus/onvisibilitychange setters on window ──
  try {
    Object.defineProperty(window, 'onblur', {
      get: function() { return null; },
      set: function() {},
      configurable: false
    });
  } catch(e) {}

  try {
    Object.defineProperty(window, 'onfocus', {
      get: function() { return null; },
      set: function() {},
      configurable: false
    });
  } catch(e) {}

  // ── 5. Block onvisibilitychange on document ──
  try {
    Object.defineProperty(document, 'onvisibilitychange', {
      get: function() { return null; },
      set: function() {},
      configurable: false
    });
  } catch(e) {}

  // ── 6. Override window.onbeforeunload to prevent "are you sure" prompts ──
  try {
    Object.defineProperty(window, 'onbeforeunload', {
      get: function() { return null; },
      set: function() {},
      configurable: false
    });
  } catch(e) {}

  // ── 7. Prevent dispatching of blocked events ──
  var originalDispatchEvent = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function(event) {
    if (event && blockedEvents.indexOf(event.type) !== -1) {
      return true; // Pretend it was dispatched successfully
    }
    return originalDispatchEvent.call(this, event);
  };

  // ── 8. Override Page Visibility API on Document prototype ──
  try {
    Object.defineProperty(Document.prototype, 'hidden', {
      get: function() { return false; },
      configurable: false
    });
  } catch(e) {}

  try {
    Object.defineProperty(Document.prototype, 'visibilityState', {
      get: function() { return 'visible'; },
      configurable: false
    });
  } catch(e) {}

  console.log('[Pingajoo] Tab-switch bypass active ✓');
})();
</script>`;

// ─── Proxy Server ─────────────────────────────────────────────────────────────

function isHtmlResponse(headers) {
    const ct = headers['content-type'] || '';
    return ct.includes('text/html');
}

function injectScript(body) {
    // Try to inject before </head> for earliest execution
    if (body.includes('</head>')) {
        return body.replace('</head>', BYPASS_SCRIPT + '\n</head>');
    }
    if (body.includes('</HEAD>')) {
        return body.replace('</HEAD>', BYPASS_SCRIPT + '\n</HEAD>');
    }
    // Fallback: inject after <body> or <BODY>
    if (body.includes('<body')) {
        return body.replace(/<body[^>]*>/i, function (match) {
            return match + '\n' + BYPASS_SCRIPT;
        });
    }
    // Last resort: prepend
    return BYPASS_SCRIPT + '\n' + body;
}

const server = http.createServer(function (clientReq, clientRes) {
    // Build the proxy request options
    const options = {
        hostname: targetHost,
        port: targetPort,
        path: clientReq.url,
        method: clientReq.method,
        headers: { ...clientReq.headers }
    };

    // Replace the Host header to point to the real server
    options.headers['host'] = targetHost + (targetPort !== 80 ? ':' + targetPort : '');

    // Remove encoding headers so we get uncompressed responses we can modify
    delete options.headers['accept-encoding'];

    const proxyReq = http.request(options, function (proxyRes) {
        // Check if this is an HTML response we need to modify
        if (isHtmlResponse(proxyRes.headers)) {
            // Collect the full response body
            const chunks = [];
            proxyRes.on('data', function (chunk) {
                chunks.push(chunk);
            });
            proxyRes.on('end', function () {
                let body = Buffer.concat(chunks).toString('utf8');
                body = injectScript(body);

                // Update content-length since we modified the body
                const responseHeaders = { ...proxyRes.headers };
                responseHeaders['content-length'] = Buffer.byteLength(body, 'utf8');
                delete responseHeaders['content-encoding']; // Remove any compression header

                clientRes.writeHead(proxyRes.statusCode, responseHeaders);
                clientRes.end(body);
            });
        } else {
            // Non-HTML: pipe through unchanged
            clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(clientRes);
        }
    });

    proxyReq.on('error', function (err) {
        console.error('[Proxy Error]', err.message);
        clientRes.writeHead(502, { 'Content-Type': 'text/plain' });
        clientRes.end('Proxy Error: Could not connect to exam server at ' + targetHost + ':' + targetPort + '\n' + err.message);
    });

    // Pipe the client request body to the proxy request
    clientReq.pipe(proxyReq);
});

server.listen(proxyPort, '0.0.0.0', function () {
    console.log('');
    console.log('  ╔═══════════════════════════════════════════════════════╗');
    console.log('  ║       SEB Tab-Switch Bypass Proxy (Pingajoo)         ║');
    console.log('  ╠═══════════════════════════════════════════════════════╣');
    console.log('  ║                                                       ║');
    console.log('  ║  ✓ Proxy is running!                                  ║');
    console.log('  ║                                                       ║');
    console.log('  ║  Proxy:   http://localhost:' + proxyPort + padRight('', 30 - String(proxyPort).length) + '║');
    console.log('  ║  Target:  ' + targetHost + ':' + targetPort + padRight('', 42 - targetHost.length - String(targetPort).length) + '║');
    console.log('  ║                                                       ║');
    console.log('  ║  Open the proxy URL in SEB instead of the             ║');
    console.log('  ║  exam server IP. Tab-switch detection will            ║');
    console.log('  ║  be automatically bypassed.                           ║');
    console.log('  ║                                                       ║');
    console.log('  ╚═══════════════════════════════════════════════════════╝');
    console.log('');
});

function padRight(str, len) {
    while (str.length < len) str += ' ';
    return str;
}

server.on('error', function (err) {
    if (err.code === 'EADDRINUSE') {
        console.error('\n  ✗ Port ' + proxyPort + ' is already in use. Try a different port:');
        console.error('    node proxy.js ' + targetArg + ' ' + (proxyPort + 1) + '\n');
    } else {
        console.error('\n  ✗ Server error:', err.message, '\n');
    }
    process.exit(1);
});
