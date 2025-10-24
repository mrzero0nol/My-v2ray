# V2Ray Proxy Worker untuk Cloudflare

Selamat datang! Proyek ini adalah skrip Cloudflare Worker yang dirancang untuk menjadi gateway langganan (subscription) V2Ray. Skrip ini secara otomatis mengambil daftar server VLESS dari sebuah file, mengolahnya, dan menyajikannya dalam format yang bisa langsung digunakan oleh aplikasi V2Ray Anda.

Fitur utamanya termasuk dukungan untuk domain wildcard (untuk menyamarkan lalu lintas) dan pengambilan proksi acak atau berdasarkan negara.

## 🚀 Cara Pemasangan (Deploy)

Pemasangan skrip ini sangat mudah karena semuanya ada dalam satu file. Cukup ikuti langkah-langkah di bawah ini.

### Langkah 1: Salin Kode Worker

1.  Buka file `_worker.js` di repositori ini.
2.  Klik tombol "Copy raw file" (ikon dua kotak tumpang tindih) di pojok kanan atas, atau pilih semua teks secara manual (Ctrl+A atau Cmd+A) dan salin (Ctrl+C atau Cmd+C).

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
    password: 'sazkia',

    // PENTING: Sesuaikan dengan domain worker Anda untuk fitur wildcard.
    baseDomain: "sazkiaatas.eu.org",

    // Nama KV Namespace yang Anda buat di Cloudflare.
    kvNamespace: "sazkiaatas"
};
//----------------- CONFIGURATION END -----------------
```

Berikut penjelasan untuk setiap item:

*   `proxyListUrl`:
    *   **Untuk Apa?** Ini adalah URL file `.txt` yang berisi daftar server VLESS Anda.
    *   **Tindakan:** Jika Anda punya file daftar proksi sendiri, ganti URL ini. Jika tidak, Anda bisa menggunakan URL bawaan.

*   `password`:
    *   **Untuk Apa?** Ini adalah kata sandi yang akan muncul di URL langganan Anda untuk keamanan.
    *   **Tindakan:** **Sangat disarankan** untuk mengubah `'sazkia'` menjadi kata sandi unik pilihan Anda.

*   `baseDomain`:
    *   **Untuk Apa?** Ini adalah nama domain utama tempat Worker Anda berjalan. Ini **wajib** diisi dengan benar agar fitur domain wildcard berfungsi.
    *   **Tindakan:** Ganti `"sazkiaatas.eu.org"` dengan domain Anda sendiri. Contoh:
        *   Jika Anda menggunakan domain gratis dari Cloudflare, maka akan terlihat seperti `"nama-worker.akun-anda.workers.dev"`.
        *   Jika Anda menggunakan domain kustom, gunakan domain tersebut, misalnya `"subdomain.domain-anda.com"`.

*   `kvNamespace`:
    *   **Untuk Apa?** Worker ini menggunakan penyimpanan KV (Key-Value) dari Cloudflare untuk menyimpan sementara (cache) daftar proksi, sehingga tidak perlu mengunduhnya setiap saat. Ini membuat Worker lebih cepat dan efisien.
    *   **Tindakan:** Anda harus membuat sebuah "KV Namespace" di Cloudflare dan memberinya nama yang **sama persis** dengan yang tertulis di sini. Lihat panduan di bawah.

### Langkah 4: Siapkan Penyimpanan KV (KV Namespace)

1.  Kembali ke halaman utama dasbor Cloudflare Anda.
2.  Di menu samping, buka **Workers & Pages** -> **KV**.
3.  Klik **Create a namespace**.
4.  Masukkan nama yang **sama persis** seperti yang Anda tulis di `config.kvNamespace` (contoh: `sazkiaatas`).
5.  Klik **Add**.
6.  Sekarang, kita perlu menghubungkan KV ini ke Worker Anda:
    *   Buka kembali Worker Anda (**Workers & Pages** -> pilih Worker Anda).
    *   Masuk ke tab **Settings** -> **Variables**.
    *   Gulir ke bawah ke bagian **KV Namespace Bindings** dan klik **Add binding**.
    *   **Variable name:** Isi dengan nama yang sama lagi (contoh: `sazkiaatas`).
    *   **KV namespace:** Pilih KV yang baru saja Anda buat dari daftar.
    *   Klik **Save**.

### Langkah 5: Simpan dan Deploy

Kembali ke editor kode Worker Anda (**Edit code**), lalu klik tombol **Save and Deploy**.

Selamat, Worker Anda sudah aktif!

## 🌐 Pengaturan Domain Wildcard (Opsional tapi Direkomendasikan)

Fitur ini memungkinkan Anda menggunakan domain apa pun sebagai *kamuflase* untuk lalu lintas Anda.

1.  Masuk ke pengaturan DNS domain Anda di Cloudflare.
2.  Klik **Add record**.
3.  Buat record **CNAME** baru dengan pengaturan berikut:
    *   **Type:** `CNAME`
    *   **Name:** `*` (ini artinya wildcard atau semua subdomain)
    *   **Target:** Isi dengan domain worker Anda (misalnya, `nama-worker.akun-anda.workers.dev`).
    *   **Proxy status:** Pastikan ikon awan oranye **Aktif** (Proxied).
4.  Klik **Save**.

## 📋 Cara Menggunakan URL Langganan

Setelah semua diatur, Anda bisa menggunakan URL berikut di aplikasi V2Ray (seperti v2rayNG, Nekoray, dll):

*   **Untuk mendapatkan daftar proksi acak:**
    `https://<domain_worker_anda>/sub/<password>`
    Contoh: `https://v2ray-gateway.sazkia.workers.dev/sub/rahasia123`

*   **Untuk mendapatkan proksi dari negara tertentu (misal: US):**
    `https://<domain_worker_anda>/sub/<password>?country=US`

*   **Menggunakan Domain Wildcard:**
    `https://<target_domain>.<domain_worker_anda>/sub/<password>`
    Contoh: `https://speed.cloudflare.com.v2ray-gateway.sazkia.workers.dev/sub/rahasia123`
    Dalam contoh ini, lalu lintas Anda akan terlihat seolah-olah menuju ke `speed.cloudflare.com`.
