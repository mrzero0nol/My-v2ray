import { connect } from "cloudflare:sockets";

// ----------------- CONFIGURATION START -----------------
// Sesuaikan nilai-nilai di bawah ini sesuai kebutuhan Anda.
const config = {
    // URL file mentah (raw) dari daftar proksi Anda di GitHub.
    proxyListUrl: 'https://raw.githubusercontent.com/sazkiaatas/My-v2ray/main/proxyList.txt',

    // Ganti dengan kata sandi rahasia Anda.
    password: 'ganti-dengan-password-anda',

    // PENTING: Sesuaikan dengan domain worker Anda untuk fitur wildcard.
    baseDomain: "sazkiaatas.eu.org",

    // Ganti dengan nama KV Namespace yang Anda buat di dasbor Cloudflare.
    kvNamespace: "ganti-dengan-nama-kv-anda",

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
        console.error(`KV Namespace "${config.kvNamespace}" not bound. Pastikan nama sudah benar dan sudah di-bind di Settings > Variables.`);
        // Fallback jika KV tidak tersedia, langsung fetch.
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
        // Simpan ke cache KV selama 1 jam (3600 detik)
        await kv.put('proxyListCache', proxyListText, { expirationTtl: 3600 });
    } else {
        console.log("Cache hit. Using proxy list from KV.");
    }
    
    return proxyListText.split('\n').filter(Boolean);
}

export default {
    async fetch(request, env) {
        try {
            const url = new URL(request.url);
            APP_DOMAIN = url.hostname;

            if (request.headers.get("Upgrade") === "websocket") {
                return await handleWebSocket(request, env);
            }

            if (url.pathname.startsWith("/sub")) {
                return await handleSubscription(request, env);
            }

            // Semua path lain akan menampilkan halaman info.
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

    if (path.length > 1 && !prxMatch) {
        // Mode negara: /ID atau /ID,US
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
        // Mode IP:PORT langsung
        prxIP = prxMatch[1];
    } else {
        // Mode acak: pilih proxy random
        const randomProxyLine = proxyLines[Math.floor(Math.random() * proxyLines.length)];
        const parts = randomProxyLine.split(',');
        prxIP = `${parts[0].trim()}-${parts[1].trim()}`;
    }

    const webSocketPair = new WebSocketPair();
    const [client, webSocket] = Object.values(webSocketPair);

    webSocket.accept();

    const earlyDataHeader = request.headers.get("sec-websocket-protocol") || "";
    const readableStream = makeReadableWebSocketStream(webSocket, earlyDataHeader);

    let remoteSocketWrapper = { value: null };

    readableStream.pipeTo(
        new WritableStream({
            async write(chunk) {
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
                    webSocket
                );
            },
            close() {
                console.log("Stream closed");
            },
            abort(reason) {
                console.log(`Stream aborted: ${reason}`);
            }
        })
    ).catch(err => {
        console.log(`Stream error: ${err.message}`);
    });

    return new Response(null, {
        status: 101,
        webSocket: client
    });
}

// Handler koneksi TCP
async function handleTCP(remoteSocket, address, port, data, webSocket) {
    try {
        const tcpSocket = connect({
            hostname: address,
            port: parseInt(port)
        });

        remoteSocket.value = tcpSocket;
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
                    safeCloseWebSocket(webSocket);
                },
                abort(reason) {
                     console.log(`TCP aborted: ${reason}`);
                }
            })
        );
    } catch (error) {
        console.log(`TCP error: ${error.message}`);
        throw error;
    }
}

// Membuat stream yang bisa dibaca dari WebSocket
function makeReadableWebSocketStream(webSocket, earlyDataHeader) {
    let readableStreamCancel = false;
    return new ReadableStream({
        start(controller) {
            webSocket.addEventListener("message", (event) => {
                if (readableStreamCancel) return;
                controller.enqueue(event.data);
            });
            webSocket.addEventListener("close", () => {
                safeCloseWebSocket(webSocket);
                if (!readableStreamCancel) controller.close();
            });
            webSocket.addEventListener("error", (err) => controller.error(err));
            if (earlyDataHeader) {
                try {
                    const decoded = atob(earlyDataHeader.replace(/-/g, "+").replace(/_/g, "/"));
                    controller.enqueue(Uint8Array.from(decoded, c => c.charCodeAt(0)).buffer);
                } catch (error) { /* Ignore */ }
            }
        },
        pull() {},
        cancel() {
            readableStreamCancel = true;
            safeCloseWebSocket(webSocket);
        }
    });
}

// Menutup WebSocket dengan aman
function safeCloseWebSocket(socket) {
    try {
        if (socket.readyState === WS_READY_STATE_OPEN || socket.readyState === WS_READY_STATE_CLOSING) {
            socket.close();
        }
    } catch (error) {
        console.error("Error closing WebSocket:", error);
    }
}

// Handle endpoint subskripsi
async function handleSubscription(request, env) {
    const url = new URL(request.url);
    const reqPassword = url.pathname.slice(5); // Menghapus '/sub/'

    if (reqPassword !== config.password) {
        return new Response('Unauthorized: Invalid password', { status: 403 });
    }

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
    let sniAndHost = requestHost;

    // **IMPLEMENTASI LOGIKA WILDCARD SUBDOMAIN**
    // Jika baseDomain diatur dan requestHost adalah subdomain dari baseDomain,
    // maka gunakan bagian subdomain sebagai host/SNI.
    // Contoh: 'speedtest.mydomain.com' akan menjadi 'speedtest.com'
    if (config.baseDomain && requestHost.endsWith(`.${config.baseDomain}`) && requestHost !== config.baseDomain) {
        const subdomainPart = requestHost.substring(0, requestHost.length - config.baseDomain.length - 1);
        // Heuristik sederhana: jika subdomain tidak mengandung titik, tambahkan '.com'
        sniAndHost = subdomainPart.includes('.') ? subdomainPart : `${subdomainPart}.com`;
    }

    for (const line of selectedProxies) {
        const parts = line.split(",");
        if (parts.length < 2) continue;
        const ip = parts[0].trim();
        const port = parts[1].trim();
        const country = (parts.length > 2) ? parts[2].trim() : 'XX';
        const org = (parts.length > 3) ? parts[3].trim() : 'Proxy';

        const vlessConfig = `vless://${uuid}@${requestHost}:443?` +
          `type=ws&` +
          `encryption=none&` +
          `host=${sniAndHost}&` +
          `path=/${ip}-${port}&` +
          `security=tls&` +
          `sni=${sniAndHost}#` +
          `${getFlagEmoji(country)} ${country} ${org} (${sniAndHost})`;

        configs.push(vlessConfig);
    }

    let result = configs.join("\n");
    if (format === "base64") {
      result = btoa(result);
    }

    return new Response(result, {
        headers: {
            "Content-Type": "text/plain;charset=utf-8",
        }
    });
}

// Halaman Informasi
function getInfoPage() {
    return new Response(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>V2Ray Proxy Gateway</title>
  <style>body{font-family:sans-serif;background:#f0f2f5;display:flex;justify-content:center;align-items:center;min-height:100vh;}.container{background:#fff;padding:2rem;border-radius:10px;box-shadow:0 4px 12px rgba(0,0,0,0.1);max-width:600px;text-align:center;}h1{color:#1a73e8;}code{background:#e8eaed;padding:0.5rem;border-radius:4px;display:block;margin-top:1rem;word-break:break-all;}</style>
</head>
<body>
  <div class="container">
    <h1>🚀 V2Ray Proxy Gateway</h1>
    <p>Worker Anda sedang berjalan. Gunakan link subskripsi yang benar untuk mendapatkan konfigurasi.</p>
    <code>https://{worker_domain}/sub/{password}?country=US</code>
  </div>
</body>
</html>`, {
        headers: { "Content-Type": "text/html" }
    });
}

// Fungsi utilitas
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function getFlagEmoji(countryCode) {
    if (!countryCode || countryCode.length !== 2) return '🌐';
    const codePoints = countryCode
        .toUpperCase()
        .split("")
        .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
}
