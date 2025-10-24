# V2Ray Proxy Worker untuk Cloudflare

Selamat datang! Proyek ini adalah skrip Cloudflare Worker yang dirancang untuk menjadi gateway langganan (subscription) V2Ray. Skrip ini secara otomatis mengambil daftar server VLESS dari sebuah file, mengolahnya, dan menyajikannya dalam format yang bisa langsung digunakan oleh aplikasi V2Ray Anda.

Fitur utamanya termasuk dukungan untuk domain wildcard (untuk menyamarkan lalu lintas) dan pengambilan proksi acak atau berdasarkan negara.

## 🚀 Cara Pemasangan (Deploy)

Pemasangan skrip ini sangat mudah karena semuanya ada dalam satu file. Cukup ikuti langkah-langkah di bawah ini.

### Langkah 1: Salin Kode Worker

1.  Buka file `_worker.js` di repositori ini.
2.  Salin seluruh isinya.

### Langkah 2: Tempel Kode di Cloudflare

1.  Masuk ke akun Cloudflare Anda.
2.  Di menu samping, buka **Workers & Pages**.
3.  Klik **Create Application** > **Create Worker**.
4.  Beri nama Worker Anda (misalnya, `v2ray-gateway`), lalu klik **Deploy**.
5.  Setelah Worker dibuat, klik **Edit code**.
6.  Hapus semua kode contoh yang ada di editor kode.
7.  Tempel (Ctrl+V atau Cmd+V) seluruh kode yang sudah Anda salin dari `_worker.js`.

### Langkah 3: Sesuaikan Konfigurasi (Paling Penting!)

Di bagian paling atas kode yang baru Anda tempel, Anda akan menemukan blok `config`. Ini adalah **satu-satunya bagian** yang perlu Anda ubah.

```javascript
//----------------- CONFIGURATION START -----------------
const config = {
    // URL daftar proksi Anda. Ganti jika perlu.
    proxyListUrl: 'https://raw.githubusercontent.com/sazkiaatas/My-v2ray/main/proxyList.txt',

    // Ganti dengan kata sandi rahasia Anda.
    password: 'ganti-dengan-password-anda',

    // PENTING: Sesuaikan dengan domain worker Anda untuk fitur wildcard.
    baseDomain: "domain-worker-anda.com",

    // Ganti dengan nama KV Namespace yang Anda buat di Cloudflare.
    kvNamespace: "ganti-dengan-nama-kv-anda"
};
//----------------- CONFIGURATION END -----------------
```

Berikut penjelasan untuk setiap item:

*   `proxyListUrl`:
    *   **Untuk Apa?** Ini adalah URL file `.txt` yang berisi daftar server VLESS Anda.
    *   **Tindakan:** Jika Anda punya file daftar proksi sendiri, ganti URL ini. Jika tidak, Anda bisa menggunakan URL bawaan.

*   `password`:
    *   **Untuk Apa?** Ini adalah kata sandi yang akan muncul di URL langganan Anda untuk keamanan.
    *   **Tindakan:** **Wajib** untuk mengubahnya menjadi kata sandi unik pilihan Anda.

*   `baseDomain`:
    *   **Untuk Apa?** Ini adalah nama domain utama tempat Worker Anda berjalan. Ini **wajib** diisi dengan benar agar fitur domain wildcard berfungsi.
    *   **Tindakan:** Ganti dengan domain Anda sendiri. Contoh:
        *   Jika Anda menggunakan domain gratis dari Cloudflare, maka akan terlihat seperti `"nama-worker.akun-anda.workers.dev"`.
        *   Jika Anda menggunakan domain kustom, gunakan domain tersebut, misalnya `"vless.domain-anda.com"`.

*   `kvNamespace`:
    *   **Untuk Apa?** Worker ini menggunakan penyimpanan KV (Key-Value) dari Cloudflare untuk menyimpan sementara (cache) daftar proksi. Ini membuat Worker lebih cepat dan efisien.
    *   **Tindakan:** Anda harus membuat sebuah "KV Namespace" di Cloudflare dan memberinya nama yang **sama persis** dengan yang tertulis di sini. Lihat panduan di bawah.

### Langkah 4: Siapkan Penyimpanan KV (KV Namespace)

1.  Kembali ke dasbor Cloudflare.
2.  Di menu samping, buka **Workers & Pages** -> **KV**.
3.  Klik **Create a namespace**.
4.  Masukkan nama yang **sama persis** seperti yang Anda tulis di `config.kvNamespace`.
5.  Klik **Add**.
6.  Sekarang, hubungkan KV ini ke Worker Anda:
    *   Buka kembali Worker Anda.
    *   Masuk ke tab **Settings** -> **Variables**.
    *   Gulir ke bawah ke bagian **KV Namespace Bindings** dan klik **Add binding**.
    *   **Variable name:** Isi dengan nama yang sama lagi (contoh: `nama-kv-anda`).
    *   **KV namespace:** Pilih KV yang baru saja Anda buat dari daftar.
    *   Klik **Save**.

### Langkah 5: Simpan dan Deploy

Kembali ke editor kode Worker Anda (**Edit code**), lalu klik tombol **Save and Deploy**.

Selamat, Worker Anda sudah aktif!

## 🌐 Pengaturan Domain Wildcard (Wajib untuk Fitur Kamuflase)

Fitur ini memungkinkan Anda menggunakan subdomain apa pun sebagai *kamuflase* untuk lalu lintas Anda.

1.  Masuk ke pengaturan **DNS** domain Anda di Cloudflare.
2.  Klik **Add record**.
3.  Buat record **CNAME** baru dengan pengaturan berikut:
    *   **Type:** `CNAME`
    *   **Name:** `*` (ini artinya wildcard atau semua subdomain)
    *   **Target:** Isi dengan domain worker Anda (misalnya, `vless.domain-anda.com` atau `nama-worker.akun-anda.workers.dev`).
    *   **Proxy status:** Pastikan ikon awan oranye **Aktif** (Proxied).
4.  Klik **Save**.

## 📋 Cara Menggunakan URL Langganan

Setelah semua diatur, Anda bisa menggunakan URL berikut di aplikasi V2Ray:

*   **URL Biasa (Host/SNI standar):**
    `https://<domain_worker_anda>/sub/<password>`
    Contoh: `https://vless.domain-anda.com/sub/rahasia123`

*   **URL dengan Negara Tertentu (misal: US):**
    `https://<domain_worker_anda>/sub/<password>?country=US`

*   **Menggunakan Domain Wildcard (Kamuflase):**
    `https://<target_domain>.<domain_worker_anda>/sub/<password>`

    Saat Anda menggunakan URL seperti ini, skrip akan secara otomatis mengatur `host` dan `SNI` di konfigurasi VLESS menjadi `<target_domain>`.

    **Contoh**:
    *   URL: `https://speedtest.net.vless.domain-anda.com/sub/rahasia123`
    *   Hasil: Konfigurasi VLESS akan menggunakan `speedtest.net` sebagai `host` dan `SNI`. Lalu lintas Anda akan terlihat seolah-olah menuju ke `speedtest.net`.
