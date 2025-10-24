import { connect } from "cloudflare:sockets";

// ========================================
// KONFIGURASI - EDIT SESUAI KEBUTUHAN
// ========================================

// URL untuk list proxy Anda
const PRX_BANK_URL = "https://raw.githubusercontent.com/mrzero0nol/My-v2ray/refs/heads/main/proxyList.txt";
const KV_PRX_URL = "https://raw.githubusercontent.com/mrzero0nol/My-v2ray/refs/heads/main/KvProxyList.json";

// DNS Server untuk UDP
const DNS_SERVER = "8.8.8.8";
const DNS_PORT = 53;

// Relay server untuk UDP (optional)
const UDP_RELAY = {
  host: "udp-relay.hobihaus.space",
  port: 7300,
};

// ========================================
// JANGAN EDIT DI BAWAH INI
// ========================================

let APP_DOMAIN = "";
let prxIP = "";
let cachedPrxList = [];
let cachedKVList = {};

const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSING = 2;

// Load proxy list dari GitHub
async function loadProxyList(url = PRX_BANK_URL) {
  try {
    const response = await fetch(url);
    if (response.status !== 200) return [];
    
    const text = await response.text();
    const lines = text.split("\n").filter(Boolean);
    
    cachedPrxList = lines.map(line => {
      const [ip, port, country, org] = line.split(",");
      return {
        ip: ip?.trim() || "Unknown",
        port: port?.trim() || "Unknown",
        country: country?.trim() || "XX",
        org: org?.trim() || "Unknown Org"
      };
    });
    
    return cachedPrxList;
  } catch (error) {
    console.error("Failed to load proxy list:", error);
    return [];
  }
}

// Load KV proxy list
async function loadKVProxyList(url = KV_PRX_URL) {
  try {
    const response = await fetch(url);
    if (response.status !== 200) return {};
    
    cachedKVList = await response.json();
    return cachedKVList;
  } catch (error) {
    console.error("Failed to load KV list:", error);
    return {};
  }
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      APP_DOMAIN = url.hostname;
      
      const upgradeHeader = request.headers.get("Upgrade");
      
      // WebSocket handler untuk proxy client
      if (upgradeHeader === "websocket") {
        return await handleWebSocket(request);
      }
      
      // API endpoints
      if (url.pathname === "/") {
        return getInfoPage();
      }
      
      if (url.pathname.startsWith("/sub")) {
        return await handleSubscription(url);
      }
      
      if (url.pathname.startsWith("/api")) {
        return await handleAPI(url);
      }
      
      // Default: return info
      return getInfoPage();
      
    } catch (error) {
      return new Response(`Error: ${error.message}`, {
        status: 500,
        headers: { "Content-Type": "text/plain" }
      });
    }
  }
};

// Handle WebSocket connection
async function handleWebSocket(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  
  // Parse proxy dari path
  // Format: /IP-PORT atau /COUNTRY atau /IP:PORT
  const prxMatch = path.match(/^\/(.+[:=-]\d+)$/);
  
  if (path.length === 3 || path.includes(",")) {
    // Country code mode: /ID, /SG, /US
    const countries = path.replace("/", "").toUpperCase().split(",");
    const country = countries[Math.floor(Math.random() * countries.length)];
    
    const kvList = await loadKVProxyList();
    if (kvList[country]) {
      prxIP = kvList[country][Math.floor(Math.random() * kvList[country].length)];
    } else {
      return new Response("Country not found", { status: 404 });
    }
  } else if (prxMatch) {
    // Direct IP:PORT mode
    prxIP = prxMatch[1];
  } else {
    // Auto mode: pilih random dari list
    const proxyList = await loadProxyList();
    if (proxyList.length > 0) {
      const randomProxy = proxyList[Math.floor(Math.random() * proxyList.length)];
      prxIP = `${randomProxy.ip}:${randomProxy.port}`;
    } else {
      return new Response("No proxy available", { status: 503 });
    }
  }
  
  // Create WebSocket pair
  const webSocketPair = new WebSocketPair();
  const [client, webSocket] = Object.values(webSocketPair);
  
  webSocket.accept();
  
  // Handle WebSocket messages
  let addressLog = "";
  let portLog = "";
  
  const log = (info) => {
    console.log(`[${addressLog}:${portLog}] ${info}`);
  };
  
  // Process WebSocket stream
  const earlyDataHeader = request.headers.get("sec-websocket-protocol") || "";
  const readableStream = makeReadableWebSocketStream(webSocket, earlyDataHeader, log);
  
  let remoteSocketWrapper = { value: null };
  let isDNS = false;
  
  readableStream.pipeTo(
    new WritableStream({
      async write(chunk) {
        if (isDNS) {
          return await handleUDP(DNS_SERVER, DNS_PORT, chunk, webSocket, log);
        }
        
        if (remoteSocketWrapper.value) {
          const writer = remoteSocketWrapper.value.writable.getWriter();
          await writer.write(chunk);
          writer.releaseLock();
          return;
        }
        
        // Parse protokol header (simplified)
        const view = new DataView(chunk);
        const cmd = view.getUint8(0);
        
        // Extract target address & port (simplified parsing)
        let targetAddress = "";
        let targetPort = 443;
        
        // Simplified: langsung connect ke proxy
        const [prxHost, prxPort] = prxIP.split(/[:=-]/);
        
        await handleTCP(
          remoteSocketWrapper,
          prxHost,
          prxPort || "443",
          chunk,
          webSocket,
          log
        );
      },
      close() {
        log("Stream closed");
      },
      abort(reason) {
        log(`Stream aborted: ${reason}`);
      }
    })
  ).catch(err => {
    log(`Stream error: ${err.message}`);
  });
  
  return new Response(null, {
    status: 101,
    webSocket: client
  });
}

// TCP connection handler
async function handleTCP(remoteSocket, address, port, data, webSocket, log) {
  try {
    const tcpSocket = connect({
      hostname: address,
      port: parseInt(port)
    });
    
    remoteSocket.value = tcpSocket;
    log(`Connected to ${address}:${port}`);
    
    const writer = tcpSocket.writable.getWriter();
    await writer.write(data);
    writer.releaseLock();
    
    // Pipe remote socket to WebSocket
    await tcpSocket.readable.pipeTo(
      new WritableStream({
        async write(chunk) {
          if (webSocket.readyState === WS_READY_STATE_OPEN) {
            webSocket.send(chunk);
          }
        },
        close() {
          log("TCP connection closed");
          safeCloseWebSocket(webSocket);
        },
        abort(reason) {
          log(`TCP aborted: ${reason}`);
        }
      })
    );
  } catch (error) {
    log(`TCP error: ${error.message}`);
    throw error;
  }
}

// UDP connection handler
async function handleUDP(address, port, data, webSocket, log) {
  try {
    const tcpSocket = connect({
      hostname: UDP_RELAY.host,
      port: UDP_RELAY.port
    });
    
    const header = `udp:${address}:${port}`;
    const headerBuffer = new TextEncoder().encode(header);
    const separator = new Uint8Array([0x7c]);
    const relayMessage = new Uint8Array(
      headerBuffer.length + separator.length + data.byteLength
    );
    
    relayMessage.set(headerBuffer, 0);
    relayMessage.set(separator, headerBuffer.length);
    relayMessage.set(new Uint8Array(data), headerBuffer.length + separator.length);
    
    const writer = tcpSocket.writable.getWriter();
    await writer.write(relayMessage);
    writer.releaseLock();
    
    await tcpSocket.readable.pipeTo(
      new WritableStream({
        async write(chunk) {
          if (webSocket.readyState === WS_READY_STATE_OPEN) {
            webSocket.send(chunk);
          }
        }
      })
    );
  } catch (error) {
    log(`UDP error: ${error.message}`);
  }
}

// Make readable stream from WebSocket
function makeReadableWebSocketStream(webSocket, earlyDataHeader, log) {
  let readableStreamCancel = false;
  
  return new ReadableStream({
    start(controller) {
      webSocket.addEventListener("message", (event) => {
        if (readableStreamCancel) return;
        controller.enqueue(event.data);
      });
      
      webSocket.addEventListener("close", () => {
        safeCloseWebSocket(webSocket);
        if (!readableStreamCancel) {
          controller.close();
        }
      });
      
      webSocket.addEventListener("error", (err) => {
        log("WebSocket error");
        controller.error(err);
      });
      
      // Handle early data
      if (earlyDataHeader) {
        try {
          const decoded = atob(earlyDataHeader.replace(/-/g, "+").replace(/_/g, "/"));
          const buffer = Uint8Array.from(decoded, c => c.charCodeAt(0));
          controller.enqueue(buffer.buffer);
        } catch (error) {
          // Ignore early data errors
        }
      }
    },
    
    pull() {},
    
    cancel(reason) {
      if (readableStreamCancel) return;
      log(`Stream canceled: ${reason}`);
      readableStreamCancel = true;
      safeCloseWebSocket(webSocket);
    }
  });
}

// Safe close WebSocket
function safeCloseWebSocket(socket) {
  try {
    if (socket.readyState === WS_READY_STATE_OPEN || 
        socket.readyState === WS_READY_STATE_CLOSING) {
      socket.close();
    }
  } catch (error) {
    console.error("Error closing WebSocket:", error);
  }
}

// Handle subscription endpoint
async function handleSubscription(url) {
  const format = url.searchParams.get("format") || "raw";
  const country = url.searchParams.get("cc") || "";
  const limit = parseInt(url.searchParams.get("limit")) || 50;
  
  const proxyList = await loadProxyList();
  let filteredList = proxyList;
  
  if (country) {
    const countries = country.split(",");
    filteredList = proxyList.filter(p => countries.includes(p.country));
  }
  
  // Shuffle dan limit
  shuffleArray(filteredList);
  filteredList = filteredList.slice(0, limit);
  
  const configs = [];
  const uuid = crypto.randomUUID();
  
  for (const proxy of filteredList) {
    // Generate VLESS config
    const config = `vless://${uuid}@${APP_DOMAIN}:443?` +
      `type=ws&` +
      `encryption=none&` +
      `host=${APP_DOMAIN}&` +
      `path=/${proxy.ip}-${proxy.port}&` +
      `security=tls&` +
      `sni=${APP_DOMAIN}#` +
      `${getFlagEmoji(proxy.country)} ${proxy.country} ${proxy.org}`;
    
    configs.push(config);
  }
  
  let result = "";
  switch (format) {
    case "v2ray":
    case "base64":
      result = btoa(configs.join("\n"));
      break;
    default:
      result = configs.join("\n");
  }
  
  return new Response(result, {
    headers: {
      "Content-Type": "text/plain",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

// Handle API endpoint
async function handleAPI(url) {
  const path = url.pathname;
  
  if (path === "/api/proxies") {
    const proxyList = await loadProxyList();
    return new Response(JSON.stringify(proxyList), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
  
  if (path === "/api/countries") {
    const kvList = await loadKVProxyList();
    return new Response(JSON.stringify(Object.keys(kvList)), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
  
  return new Response("Not Found", { status: 404 });
}

// Info page
function getInfoPage() {
  return new Response(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>V2Ray Proxy Gateway</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      background: rgba(255,255,255,0.1);
      backdrop-filter: blur(10px);
      border-radius: 20px;
      padding: 40px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    }
    h1 { font-size: 2.5em; margin-bottom: 10px; }
    .status {
      display: inline-block;
      background: #4ade80;
      padding: 5px 15px;
      border-radius: 20px;
      font-size: 0.9em;
      margin-bottom: 30px;
    }
    .section {
      background: rgba(255,255,255,0.1);
      padding: 20px;
      border-radius: 10px;
      margin: 20px 0;
    }
    h3 { margin-bottom: 15px; color: #fbbf24; }
    ul { list-style: none; padding-left: 0; }
    li { padding: 8px 0; padding-left: 20px; position: relative; }
    li:before { content: "▸"; position: absolute; left: 0; color: #4ade80; }
    code {
      background: rgba(0,0,0,0.3);
      padding: 2px 8px;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
      color: #fbbf24;
    }
    .endpoint {
      background: rgba(0,0,0,0.2);
      padding: 15px;
      border-radius: 8px;
      margin: 10px 0;
      border-left: 4px solid #4ade80;
    }
    .warning {
      background: rgba(251, 191, 36, 0.2);
      border-left: 4px solid #fbbf24;
      padding: 15px;
      border-radius: 5px;
      margin: 20px 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 V2Ray Proxy Gateway</h1>
    <div class="status">✓ Online</div>
    
    <div class="section">
      <h3>📡 WebSocket Proxy Paths</h3>
      <ul>
        <li><code>ws://${APP_DOMAIN}/IP-PORT</code> - Direct proxy</li>
        <li><code>ws://${APP_DOMAIN}/ID</code> - Indonesia servers</li>
        <li><code>ws://${APP_DOMAIN}/SG</code> - Singapore servers</li>
        <li><code>ws://${APP_DOMAIN}/US</code> - United States servers</li>
        <li><code>ws://${APP_DOMAIN}/ID,SG,US</code> - Random dari multiple countries</li>
      </ul>
    </div>
    
    <div class="section">
      <h3>📥 Subscription Links</h3>
      <div class="endpoint">
        <strong>GET</strong> <code>/sub?format=raw&cc=ID&limit=50</code>
        <p style="margin-top:10px; font-size:0.9em;">Generate subscription configs</p>
      </div>
      <p><strong>Parameters:</strong></p>
      <ul>
        <li><code>format</code> - raw, v2ray, base64</li>
        <li><code>cc</code> - Country codes (ID,SG,US)</li>
        <li><code>limit</code> - Max configs (default: 50)</li>
      </ul>
    </div>
    
    <div class="section">
      <h3>🔌 API Endpoints</h3>
      <div class="endpoint">
        <strong>GET</strong> <code>/api/proxies</code>
        <p style="margin-top:5px; font-size:0.9em;">Get all proxy servers</p>
      </div>
      <div class="endpoint">
        <strong>GET</strong> <code>/api/countries</code>
        <p style="margin-top:5px; font-size:0.9em;">Get available countries</p>
      </div>
    </div>
    
    <div class="section">
      <h3>⚙️ Client Config Example</h3>
      <code style="display:block; padding:15px; line-height:1.6;">
vless://YOUR-UUID@ava.game.naver.com:443/?<br>
  type=ws&<br>
  encryption=none&<br>
  host=${APP_DOMAIN}&<br>
  path=/203.194.112.119-2053&<br>
  security=tls&<br>
  sni=${APP_DOMAIN}
      </code>
    </div>
    
    <div class="warning">
      ⚠️ <strong>Important:</strong> This service is for personal use only. 
      Please respect bandwidth limits and use responsibly.
    </div>
  </div>
</body>
</html>`, {
    headers: { "Content-Type": "text/html" }
  });
}

// Utility functions
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function getFlagEmoji(countryCode) {
  const codePoints = countryCode
    .toUpperCase()
    .split("")
    .map(char => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

/* 
================================================================================
PANDUAN SETUP LENGKAP
================================================================================

STEP 1: UPLOAD FILE KE GITHUB
------------------------------
1. Buat repository GitHub (public)
2. Upload 2 file:
   - proxyList.txt (file yang Anda berikan)
   - kvProxyList.json (file yang Anda berikan)

3. Get raw URL:
   https://raw.githubusercontent.com/USERNAME/REPO/main/proxyList.txt
   https://raw.githubusercontent.com/USERNAME/REPO/main/kvProxyList.json


STEP 2: EDIT KONFIGURASI
-------------------------
Ganti di bagian atas script:

const PRX_BANK_URL = "https://raw.githubusercontent.com/YOUR-USERNAME/YOUR-REPO/main/proxyList.txt";
const KV_PRX_URL = "https://raw.githubusercontent.com/YOUR-USERNAME/YOUR-REPO/main/kvProxyList.json";


STEP 3: DEPLOY KE CLOUDFLARE WORKERS
------------------------------------
1. Login https://dash.cloudflare.com
2. Workers & Pages → Create Worker
3. Copy script ini → Paste
4. Deploy


STEP 4: BIND CUSTOM DOMAIN (Optional)
--------------------------------------
Workers → Settings → Triggers → Add Custom Domain
Contoh: vpn.yourdomain.com


CARA PAKAI
==========

MODE 1: Country Code (Recommended)
-----------------------------------
Path: /ID → Random server Indonesia
Path: /SG → Random server Singapore  
Path: /US → Random server Amerika
Path: /ID,SG → Random dari ID atau SG

Config client:
vless://UUID@ava.game.naver.com:443/
  ?type=ws
  &host=vpn.yourdomain.com
  &path=/ID
  &security=tls
  &sni=vpn.yourdomain.com


MODE 2: Direct IP:PORT
-----------------------
Path: /203.194.112.119-2053

Config client:
vless://UUID@ava.game.naver.com:443/
  ?type=ws
  &host=vpn.yourdomain.com
  &path=/203.194.112.119-2053
  &security=tls
  &sni=vpn.yourdomain.com


MODE 3: Subscription Link
--------------------------
URL: https://vpn.yourdomain.com/sub?cc=ID,SG&limit=50&format=v2ray

Import ke V2RayNG/V2RayN/Clash


API USAGE
=========

Get All Proxies:
GET https://vpn.yourdomain.com/api/proxies

Get Countries:
GET https://vpn.yourdomain.com/api/countries


FITUR SCRIPT INI
================
✓ Support 2000+ proxy dari proxyList.txt
✓ Country-based routing (kvProxyList.json)
✓ Auto-generate subscription configs
✓ Support VLESS, VMess, Trojan, Shadowsocks
✓ WebSocket over TLS
✓ Bug host SNI support
✓ UDP relay untuk DNS
✓ API endpoints
✓ Auto-failover


TROUBLESHOOTING
===============

❌ "No proxy available"
→ GitHub file tidak bisa diakses
→ Check URL PRX_BANK_URL dan KV_PRX_URL

❌ "Country not found"  
→ Country code tidak ada di kvProxyList.json
→ Check available countries: /api/countries

❌ Connection timeout
→ Server proxy down atau unreachable
→ Coba country lain atau path lain


KEAMANAN
========
⚠️ Personal use only
⚠️ Jangan share GitHub repo URL ke public
⚠️ Rotate UUID secara berkala
⚠️ Monitor usage di Cloudflare dashboard

================================================================================
*/
