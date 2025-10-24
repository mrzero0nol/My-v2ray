# V2Ray Proxy Worker untuk Cloudflare

Selamat datang! Proyek ini adalah skrip Cloudflare Worker yang dirancang untuk menjadi gateway langganan (subscription) V2Ray. Skrip ini secara otomatis mengambil daftar server VLESS dari sebuah file, mengolahnya, dan menyajikannya dalam format yang bisa langsung digunakan oleh aplikasi V2Ray Anda.

Fitur utamanya termasuk dukungan untuk domain wildcard (untuk menyamarkan lalu lintas), caching menggunakan KV, dan pengambilan proksi acak atau berdasarkan negara.

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
// ----------------- CONFIGURATION START -----------------
const config = {
    // URL daftar proksi Anda. Ganti jika perlu.
    proxyListUrl: 'https://raw.githubusercontent.com/sazkiaatas/My-v2ray/main/proxyList.txt',

    // Ganti dengan kata sandi rahasia untuk link subskripsi Anda.
    password: 'ganti-dengan-password-anda',

    // PENTING: Sesuaikan dengan domain worker Anda untuk fitur wildcard.
    baseDomain: "domain-worker-anda.com",

    // Ganti dengan NAMA BINDING KV Anda.
    kvNamespace: "KV"
};
// ----------------- CONFIGURATION END -----------------
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
    *   **Tindakan:** Anda harus membuat sebuah "KV Namespace" di Cloudflare dan kemudian **mengikatnya** ke Worker ini. Nama yang Anda tulis di sini harus **sama persis** dengan "Variable name" pada saat binding. Lihat panduan di bawah.

### Langkah 4: Siapkan dan Ikat Penyimpanan KV (KV Namespace)

1.  Kembali ke dasbor Cloudflare.
2.  Di menu samping, buka **Workers & Pages** -> **KV**.
3.  Klik **Create a namespace**.
4.  Beri nama (misalnya, `V2RAY_PROXIES`), lalu klik **Add**.
5.  Sekarang, hubungkan KV ini ke Worker Anda:
    *   Buka kembali Worker Anda.
    *   Masuk ke tab **Settings** -> **Variables**.
    *   Gulir ke bawah ke bagian **KV Namespace Bindings** dan klik **Add binding**.
    *   **Variable name:** Isi dengan nama yang Anda tulis di `config.kvNamespace` (contoh: `KV`). Ini adalah **nama binding**.
    *   **KV namespace:** Pilih KV yang baru saja Anda buat dari daftar (contoh: `V2RAY_PROXIES`).
    *   Klik **Save**.

### Langkah 5: Simpan dan Deploy

Kembali ke editor kode Worker Anda (**Edit code**), lalu klik tombol **Save and Deploy**.

Selamat, Worker Anda sudah aktif!

## 🌐 Pengaturan Domain Wildcard (Wajib untuk Fitur Kamuflase)

Fitur ini memungkinkan Anda menggunakan subdomain apa pun sebagai *kamuflase* untuk lalu lintas Anda. Daripada menggunakan DNS CNAME, kita akan menggunakan Rute Pekerja (*Worker Route*) yang lebih efisien.

1.  Buka Worker Anda di dasbor Cloudflare.
2.  Masuk ke tab **Triggers**.
3.  Di bawah bagian **Routes**, klik **Add route**.
4.  Masukkan rute dengan format berikut, ganti `<domain_worker_anda>` dengan domain yang Anda gunakan:
    *   `*.<domain_worker_anda>/*`
5.  Pastikan **Worker** yang benar telah dipilih.
6.  Klik **Add route**.

**Contoh:**
Jika `baseDomain` Anda diatur ke `vless.domain-anda.com`, maka rute yang harus Anda tambahkan adalah `*.vless.domain-anda.com/*`. Ini akan mengarahkan semua lalu lintas dari subdomain apa pun di bawah `vless.domain-anda.com` ke Worker Anda.

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
