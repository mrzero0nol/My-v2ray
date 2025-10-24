import { connect } from "cloudflare:sockets";

// ----------------- CONFIGURATION START -----------------
// Sesuaikan nilai-nilai di bawah ini sesuai kebutuhan Anda.
const config = {
    // URL file mentah (raw) dari daftar proksi Anda di GitHub.
    proxyListUrl: 'https://raw.githubusercontent.com/sazkiaatas/My-v2ray/main/proxyList.txt',

    // Kata sandi rahasia untuk mengakses link langganan.
    password: 'sazkia',

    // Domain dasar worker Anda untuk fitur wildcard.
    baseDomain: "sazkiaatas.eu.org",

    // Nama KV Namespace yang Anda buat di dasbor Cloudflare.
    kvNamespace: "sazkiaatas",

    // Opsi Internal (biasanya tidak perlu diubah)
    dnsServer: "8.8.8.8",
    dnsPort: 53,
    udpRelay: {
        host: "udp-relay.hobihaus.space",
        port: 7300,
    },
};
// ----------------- CONFIGURATION END -----------------

let APP_DOMAIN = "";
let prxIP = "";

const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSING = 2;

// Memuat daftar proksi, dengan cache KV
async function loadProxyList(env) {
    const kv = env[config.kvNamespace];
    if (!kv) {
        console.error(`KV Namespace "${config.kvNamespace}" not bound.`);
        // Fallback to fetch directly if KV is not available
        const response = await fetch(config.proxyListUrl);
        if (!response.ok) return [];
        const text = await response.text();
        return text.split('\n').filter(Boolean);
    }

    let proxyListText = await kv.get('proxyListCache');
    if (!proxyListText) {
        console.log("Cache miss. Fetching proxy list from URL...");
        const response = await fetch(config.proxyListUrl);
        if (!response.ok) {
            console.error("Failed to fetch proxy list.");
            return [];
        }
        proxyListText = await response.text();
        await kv.put('proxyListCache', proxyListText, { expirationTtl: 3600 });
    } else {
        console.log("Cache hit. Using proxy list from KV.");
    }
    
    return proxyListText.split('\n').filter(Boolean);
}

// Fungsi ini tidak lagi digunakan, daftar negara diambil dari file proxy utama.
async function loadKVProxyList(url) {
    // Deprecated
    return {};
}

export default {
    async fetch(request, env) {
        try {
            const url = new URL(request.url);
            APP_DOMAIN = url.hostname;

            const upgradeHeader = request.headers.get("Upgrade");

            if (upgradeHeader === "websocket") {
                return await handleWebSocket(request, env);
            }

            if (url.pathname === "/") {
                return getInfoPage();
            }

            const pathSegments = url.pathname.slice(1).split('/');
            if (pathSegments[0] === 'sub') {
                return await handleSubscription(request, env, pathSegments[1]);
            }

            if (url.pathname.startsWith("/api")) {
                return await handleAPI(request, env);
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
async function handleWebSocket(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    const prxMatch = path.match(/^\/(.+[:=-]\d+)$/);

    const proxyLines = await loadProxyList(env);
    if (proxyLines.length === 0) {
        return new Response("No proxy available", { status: 503 });
    }

    if (path.length === 3 || path.includes(",")) {
        // Country code mode: /ID or /ID,US
        const requestedCountries = path.replace("/", "").toUpperCase().split(",");
        const availableProxies = proxyLines.filter(line => {
            const parts = line.split(',');
            return parts.length >= 3 && requestedCountries.includes(parts[2].trim().toUpperCase());
        });

        if (availableProxies.length > 0) {
            const randomProxyLine = availableProxies[Math.floor(Math.random() * availableProxies.length)];
            const parts = randomProxyLine.split(',');
            prxIP = `${parts[0].trim()}-${parts[1].trim()}`;
        } else {
            return new Response("Country not found or no proxies for this country", { status: 404 });
        }
    } else if (prxMatch) {
        // Direct IP:PORT mode
        prxIP = prxMatch[1];
    } else {
        // Auto mode: pick a random proxy
        const randomProxyLine = proxyLines[Math.floor(Math.random() * proxyLines.length)];
        const parts = randomProxyLine.split(',');
        prxIP = `${parts[0].trim()}-${parts[1].trim()}`;
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
                    return await handleUDP(config.dnsServer, config.dnsPort, chunk, webSocket, log);
                }

                if (remoteSocketWrapper.value) {
                    const writer = remoteSocketWrapper.value.writable.getWriter();
                    await writer.write(chunk);
                    writer.releaseLock();
                    return;
                }

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
            hostname: config.udpRelay.host,
            port: config.udpRelay.port
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

            if (earlyDataHeader) {
                try {
                    const decoded = atob(earlyDataHeader.replace(/-/g, "+").replace(/_/g, "/"));
                    const buffer = Uint8Array.from(decoded, c => c.charCodeAt(0));
                    controller.enqueue(buffer.buffer);
                } catch (error) {
                    // Ignore
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
async function handleSubscription(request, env, reqPassword) {
    if (reqPassword !== config.password) {
        return new Response('Unauthorized: Invalid password', { status: 403 });
    }

    const url = new URL(request.url);
    const countryParam = url.searchParams.get('country')?.toUpperCase();
    const limit = parseInt(url.searchParams.get("limit")) || 50;
    const format = url.searchParams.get("format") || "base64";

    let proxyLines = await loadProxyList(env);
    
    if (countryParam) {
        const countries = countryParam.split(",");
        proxyLines = proxyLines.filter(line => {
            const parts = line.split(",");
            return parts.length >= 3 && countries.includes(parts[2].trim().toUpperCase());
        });
    }

    if (proxyLines.length === 0) {
        return new Response(`No proxies found for the specified criteria.`, { status: 404 });
    }

    shuffleArray(proxyLines);
    let selectedProxies = proxyLines.slice(0, limit);

    const configs = [];
    const uuid = crypto.randomUUID();

    const requestHost = url.hostname;
    const subscriptionAddress = requestHost;
    let sniAndHost = requestHost;

    if (config.baseDomain && requestHost.endsWith(`.${config.baseDomain}`) && requestHost !== config.baseDomain) {
        sniAndHost = requestHost.substring(0, requestHost.length - config.baseDomain.length - 1);
    }

    for (const line of selectedProxies) {
        const parts = line.split(",");
        if (parts.length < 2) continue;
        const ip = parts[0].trim();
        const port = parts[1].trim();
        const country = (parts.length > 2) ? parts[2].trim() : 'XX';
        const org = (parts.length > 3) ? parts[3].trim() : 'Proxy';

        const vlessConfig = `vless://${uuid}@${subscriptionAddress}:443?` +
          `type=ws&` +
          `encryption=none&` +
          `host=${sniAndHost}&` +
          `path=/${ip}-${port}&` +
          `security=tls&` +
          `sni=${sniAndHost}#` +
          `${getFlagEmoji(country)} ${country} ${org}`;

        configs.push(vlessConfig);
    }

    let result = configs.join("\n");
    if (format === "base64" || format === "v2ray") {
      result = btoa(result);
    }

    return new Response(result, {
        headers: {
            "Content-Type": "text/plain;charset=utf-8",
            "Access-Control-Allow-Origin": "*"
        }
    });
}


// Handle API endpoint
async function handleAPI(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/proxies") {
        const proxyLines = await loadProxyList(env);
        const proxyObjects = proxyLines.map(line => {
            const parts = line.split(",");
            return {
                ip: parts[0]?.trim() || "Unknown",
                port: parts[1]?.trim() || "Unknown",
                country: parts[2]?.trim() || "XX",
                org: parts[3]?.trim() || "Unknown Org"
            };
        });
        return new Response(JSON.stringify(proxyObjects), {
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            }
        });
    }

    if (path === "/api/countries") {
        const proxyLines = await loadProxyList(env);
        const countries = new Set();
        proxyLines.forEach(line => {
            const parts = line.split(",");
            if (parts.length >= 3) {
                countries.add(parts[2].trim().toUpperCase());
            }
        });
        return new Response(JSON.stringify(Array.from(countries)), {
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
        <strong>GET</strong> <code>/sub/${config.password}?country=ID,SG</code>
        <p style="margin-top:10px; font-size:0.9em;">Generate subscription configs</p>
      </div>
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
vless://YOUR-UUID@${APP_DOMAIN}:443/?<br>
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
PANDUAN SETUP LENGKAP (disederhanakan)
================================================================================

UNTUK PANDUAN LENGKAP, SILAKAN LIHAT FILE `README.md` DI REPOSITORY.

LANGKAH DASAR:
1.  Salin seluruh kode ini ke dalam editor Cloudflare Worker.
2.  Sesuaikan objek `config` di bagian paling atas skrip.
    -   `proxyListUrl`: Pastikan URL ini benar.
    -   `password`: Ganti dengan kata sandi unik Anda.
    -   `baseDomain`: Atur ke domain worker Anda (wajib untuk fitur wildcard).
    -   `kvNamespace`: Beri nama untuk KV Namespace Anda.
3.  Buat KV Namespace di Cloudflare dengan nama yang sama persis seperti di `kvNamespace`.
4.  Ikat (bind) KV Namespace tersebut ke Worker ini melalui menu Settings > Variables.
5.  Simpan dan Deploy.

================================================================================
*/
