# Pendi Drama

Aplikasi streaming drama pendek berbasis Expo (React Native). Data drama disimpan di Firebase Firestore, video diputar via `expo-video`, dan OTA update menggunakan EAS Update.

## Stack

- **Expo** ~54 + **Expo Router** ~6
- **Firebase Firestore** — penyimpanan data drama & episode
- **EAS Build** — build APK Android
- **EAS Update** — OTA update tanpa re-publish ke store

## Fitur

- Beranda: daftar drama + carousel unggulan + filter status
- Pencarian: real-time search by judul
- Favorit: simpan drama favorit (AsyncStorage)
- Player: video player + resume progress + swipe episode
- Admin Panel: scrape URL drama atau tambah manual ke Firestore

## Setup Dev

```bash
# Install dependencies (dari root workspace)
pnpm install

# Jalankan dev server
pnpm --filter @workspace/pendi-drama run dev
```

Scan QR code dengan **Expo Go** (Android/iOS).

## Build APK (EAS)

> Butuh akun [Expo](https://expo.dev) dan login via `eas login`

```bash
# Install EAS CLI
npm install -g eas-cli

# Login ke akun Expo
eas login

# Build APK preview (internal testing)
cd artifacts/pendi-drama
eas build --platform android --profile preview

# Build APK production
eas build --platform android --profile production
```

APK bisa didownload dari dashboard [expo.dev](https://expo.dev) setelah build selesai.

## OTA Update (EAS Update)

Setelah app sudah di-install lewat APK, update JS bundle bisa dikirim tanpa rebuild APK:

```bash
# Kirim update ke semua user (channel production)
eas update --branch production --message "Fix: deskripsi perubahan"

# Kirim update ke channel preview (testing)
eas update --branch preview --message "Test: fitur baru"
```

Update akan otomatis diterapkan saat user membuka app (sesuai config `checkAutomatically: ON_LOAD`).

## Konfigurasi Firebase

Edit `lib/firebase.ts` untuk mengganti Firebase project:

```ts
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "...",
};
```

## Struktur Folder

```
app/
  (tabs)/
    index.tsx       — Beranda
    search.tsx      — Pencarian
    favorites.tsx   — Favorit
    admin.tsx       — Admin Panel
  player/[id].tsx   — Video player
assets/             — Icon & splash
components/         — ErrorBoundary
constants/colors.ts — Design tokens (dark theme)
hooks/useColors.ts  — Hook tema warna
lib/
  firebase.ts       — Firebase init + buildVideoUrl
  storage.ts        — AsyncStorage: favorit & progress
  types.ts          — Interface Drama, Episode
eas.json            — Konfigurasi EAS build & update
app.json            — Expo config (termasuk EAS Update URL)
```

## Catatan

- `app.json` tidak lagi menggunakan domain Replit — aman untuk build APK standalone
- `runtimeVersion` menggunakan `appVersion` policy — pastikan update `version` di `app.json` saat ada breaking change native
- Admin PIN default: `admin123` (ganti di `app/(tabs)/admin.tsx`)
