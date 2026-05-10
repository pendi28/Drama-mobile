import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { doc, setDoc } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { db } from "@/lib/firebase";
import { useColors } from "@/hooks/useColors";

const ADMIN_KEY = "pd_admin_ok";
type Mode = "scrape" | "manual";

interface ScrapedEp {
  title: string;
  rawUrl: string;
  quality: number;
  sources: { quality: number; rawUrl: string }[];
  thumbnailUrl: string;
  chapterIndex: number;
}

interface ScrapedDrama {
  title: string;
  cover: string;
  totalEps: number;
  status: string;
  tags: string;
  episodes: ScrapedEp[];
  source: string;
}

// ─── SCRAPER UTILS ──────────────────────────────────────────────────────────

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache",
};

function extractMeta(html: string, prop: string): string {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return "";
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m?.[1]?.trim().split("|")[0].split("-")[0].trim() ?? "";
}

function extractNextData(html: string): Record<string, unknown> | null {
  const m = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m?.[1]) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function extractNuxtData(html: string): Record<string, unknown> | null {
  const m = html.match(/window\.__NUXT__\s*=\s*(\{[\s\S]*?\})(?:\s*;|\s*<\/script>)/i);
  if (!m?.[1]) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function extractVideoUrls(html: string): string[] {
  const urls = new Set<string>();
  const patterns = [
    /["'](https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*?)["']/gi,
    /["'](https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*?)["']/gi,
    /["'](https?:\/\/[^\s"'<>]+\.webm[^\s"'<>]*?)["']/gi,
    /"(https?:\/\/[^\s"]+(?:video|stream|play|hls|cdn)[^\s"]*)"/, // generic video CDN
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    const regex = new RegExp(re.source, "gi");
    while ((m = regex.exec(html)) !== null) {
      const url = m[1];
      if (url && !url.includes("thumbnail") && !url.includes("poster"))
        urls.add(url);
    }
  }
  return [...urls];
}

// Deep search JSON object for arrays that look like episode lists
function findEpisodeArray(obj: unknown, depth = 0): unknown[] | null {
  if (depth > 8 || !obj || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    if (obj.length > 0 && typeof obj[0] === "object" && obj[0] !== null) {
      const first = obj[0] as Record<string, unknown>;
      if (
        "url" in first || "videoUrl" in first || "src" in first ||
        "episode" in first || "rawUrl" in first || "streamUrl" in first ||
        "chapterIndex" in first || "index" in first
      ) return obj;
    }
    for (const item of obj) {
      const found = findEpisodeArray(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const val of Object.values(obj as Record<string, unknown>)) {
    const found = findEpisodeArray(val, depth + 1);
    if (found) return found;
  }
  return null;
}

function findStringDeep(obj: unknown, keys: string[], depth = 0): string {
  if (depth > 8 || !obj || typeof obj !== "object") return "";
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const v = findStringDeep(item, keys, depth + 1);
      if (v) return v;
    }
    return "";
  }
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    if (k in rec && typeof rec[k] === "string" && (rec[k] as string).length > 2)
      return rec[k] as string;
  }
  for (const val of Object.values(rec)) {
    const v = findStringDeep(val, keys, depth + 1);
    if (v) return v;
  }
  return "";
}

function episodeFromObj(ep: unknown, idx: number, cover: string): ScrapedEp {
  const o = ep as Record<string, unknown>;
  const rawUrl =
    (o.videoUrl as string) || (o.url as string) || (o.src as string) ||
    (o.streamUrl as string) || (o.rawUrl as string) || (o.video as string) || "";
  const title =
    (o.title as string) || (o.name as string) || (o.episodeTitle as string) ||
    `Episode ${idx + 1}`;
  const thumb =
    (o.thumbnail as string) || (o.cover as string) || (o.image as string) || cover;
  return {
    title,
    rawUrl,
    quality: (o.quality as number) || 720,
    sources: [{ quality: 720, rawUrl }],
    thumbnailUrl: thumb,
    chapterIndex: idx,
  };
}

// ─── SITE-SPECIFIC SCRAPERS ─────────────────────────────────────────────────

async function scrapeReelShort(pageUrl: string): Promise<ScrapedDrama | null> {
  try {
    // Extract drama ID from URL
    // URL: https://www.reelshort.com/dramaid or /series/SLUG or /id/SLUG
    const urlObj = new URL(pageUrl);
    const segments = urlObj.pathname.split("/").filter(Boolean);
    const slug = segments[segments.length - 1];

    // Try ReelShort API
    const apiUrls = [
      `https://www.reelshort.com/api/v1/drama/${slug}`,
      `https://www.reelshort.com/api/drama/${slug}`,
    ];
    for (const api of apiUrls) {
      try {
        const res = await fetch(api, { headers: { ...FETCH_HEADERS, "Accept": "application/json" } });
        if (res.ok) {
          const json = await res.json() as Record<string, unknown>;
          const data = (json.data ?? json) as Record<string, unknown>;
          const epArr = findEpisodeArray(data) ?? [];
          return {
            title: findStringDeep(data, ["title", "name", "dramaTitle"]) || slug,
            cover: findStringDeep(data, ["cover", "thumbnail", "poster", "image"]),
            totalEps: epArr.length,
            status: "Ongoing",
            tags: "",
            episodes: epArr.map((ep, i) => episodeFromObj(ep, i, "")),
            source: "reelshort",
          };
        }
      } catch { /* try next */ }
    }
  } catch { /* fall through */ }
  return null;
}

async function scrapeDramaBox(pageUrl: string): Promise<ScrapedDrama | null> {
  try {
    const urlObj = new URL(pageUrl);
    const segments = urlObj.pathname.split("/").filter(Boolean);
    const id = segments[segments.length - 1];

    const apiUrls = [
      `https://www.dramabox.com/api/book/${id}`,
      `https://api.dramabox.com/book/${id}`,
      `https://www.dramabox.com/api/drama/${id}`,
    ];
    for (const api of apiUrls) {
      try {
        const res = await fetch(api, { headers: { ...FETCH_HEADERS, "Accept": "application/json" } });
        if (res.ok) {
          const json = await res.json() as Record<string, unknown>;
          const data = (json.data ?? json) as Record<string, unknown>;
          const epArr = findEpisodeArray(data) ?? [];
          return {
            title: findStringDeep(data, ["title", "name", "bookName"]) || id,
            cover: findStringDeep(data, ["cover", "thumbnail", "coverUrl", "image"]),
            totalEps: epArr.length,
            status: findStringDeep(data, ["status", "seriesStatus"]) || "Ongoing",
            tags: findStringDeep(data, ["tags", "genre", "category"]),
            episodes: epArr.map((ep, i) => episodeFromObj(ep, i, "")),
            source: "dramabox",
          };
        }
      } catch { /* try next */ }
    }
  } catch { /* fall through */ }
  return null;
}

async function scrapeGeneric(pageUrl: string): Promise<ScrapedDrama> {
  const hostname = (() => { try { return new URL(pageUrl).hostname.replace("www.", ""); } catch { return "unknown"; } })();

  let html = "";
  try {
    const res = await fetch(pageUrl, { headers: FETCH_HEADERS });
    html = await res.text();
  } catch (e) {
    throw new Error(`Tidak bisa membuka halaman: ${e}`);
  }

  // 1. Try Next.js embedded data
  const nextData = extractNextData(html);
  if (nextData) {
    const pageProps = findStringDeep(nextData, []) as unknown;
    const epArr = findEpisodeArray(nextData) ?? [];
    if (epArr.length > 0) {
      const title =
        findStringDeep(nextData, ["title", "name", "dramaTitle", "seriesTitle"]) ||
        extractMeta(html, "og:title") ||
        extractTitle(html) ||
        hostname;
      const cover =
        findStringDeep(nextData, ["cover", "thumbnail", "poster", "image", "coverUrl"]) ||
        extractMeta(html, "og:image");
      return {
        title,
        cover,
        totalEps: epArr.length,
        status: findStringDeep(nextData, ["status", "seriesStatus"]) || "Ongoing",
        tags: findStringDeep(nextData, ["tags", "genre", "category", "description"]),
        episodes: epArr.map((ep, i) => episodeFromObj(ep, i, cover)),
        source: hostname,
      };
    }
    void pageProps;
  }

  // 2. Try Nuxt embedded data
  const nuxtData = extractNuxtData(html);
  if (nuxtData) {
    const epArr = findEpisodeArray(nuxtData) ?? [];
    if (epArr.length > 0) {
      const title =
        findStringDeep(nuxtData, ["title", "name"]) ||
        extractMeta(html, "og:title") ||
        extractTitle(html);
      const cover =
        findStringDeep(nuxtData, ["cover", "thumbnail", "poster"]) ||
        extractMeta(html, "og:image");
      return {
        title,
        cover,
        totalEps: epArr.length,
        status: "Ongoing",
        tags: "",
        episodes: epArr.map((ep, i) => episodeFromObj(ep, i, cover)),
        source: hostname,
      };
    }
  }

  // 3. Try to find JSON data in all script tags
  const scriptMatches = html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi);
  for (const sm of scriptMatches) {
    const content = sm[1].trim();
    if (!content.startsWith("{") && !content.startsWith("[")) continue;
    try {
      const json = JSON.parse(content);
      const epArr = findEpisodeArray(json) ?? [];
      if (epArr.length > 0) {
        const title =
          findStringDeep(json, ["title", "name"]) ||
          extractMeta(html, "og:title") ||
          extractTitle(html);
        const cover =
          findStringDeep(json, ["cover", "thumbnail", "poster"]) ||
          extractMeta(html, "og:image");
        return {
          title,
          cover,
          totalEps: epArr.length,
          status: "Ongoing",
          tags: "",
          episodes: epArr.map((ep, i) => episodeFromObj(ep, i, cover)),
          source: hostname,
        };
      }
    } catch { /* skip */ }
  }

  // 4. Last resort: extract raw video URLs from HTML
  const videoUrls = extractVideoUrls(html);
  const title =
    extractMeta(html, "og:title") || extractTitle(html) || hostname;
  const cover = extractMeta(html, "og:image");

  if (videoUrls.length === 0) {
    throw new Error(
      "Tidak ada video atau data episode ditemukan.\n\nSitus ini mungkin:\n• Butuh login\n• Pakai proteksi bot\n• Render JavaScript saja\n\nCoba mode Manual untuk input URL video langsung."
    );
  }

  return {
    title,
    cover,
    totalEps: videoUrls.length,
    status: "Ongoing",
    tags: "",
    episodes: videoUrls.map((url, i) => ({
      title: `Episode ${i + 1}`,
      rawUrl: url,
      quality: 720,
      sources: [{ quality: 720, rawUrl: url }],
      thumbnailUrl: cover,
      chapterIndex: i,
    })),
    source: hostname,
  };
}

// ─── MAIN SCRAPER ENTRY ─────────────────────────────────────────────────────

async function scrapeDrama(url: string): Promise<ScrapedDrama> {
  const hostname = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } })();

  if (hostname.includes("reelshort")) {
    const result = await scrapeReelShort(url);
    if (result) return result;
  }
  if (hostname.includes("dramabox")) {
    const result = await scrapeDramaBox(url);
    if (result) return result;
  }
  return scrapeGeneric(url);
}

// ─── COMPONENTS ─────────────────────────────────────────────────────────────

function EpRow({
  ep, index, onRemove, colors,
}: {
  ep: ScrapedEp; index: number; onRemove: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.epRow, { borderColor: colors.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.epRowTitle, { color: colors.foreground }]} numberOfLines={1}>
          EP {index + 1}: {ep.title}
        </Text>
        <Text style={[styles.epRowUrl, { color: colors.mutedForeground }]} numberOfLines={1}>
          {ep.rawUrl || "(kosong)"}
        </Text>
      </View>
      <Pressable onPress={onRemove} hitSlop={8}>
        <Ionicons name="close-circle" size={20} color={colors.destructive} />
      </Pressable>
    </View>
  );
}

function AdminLock({ onUnlock, colors }: { onUnlock: () => void; colors: ReturnType<typeof useColors> }) {
  const [pin, setPin] = useState("");
  const insets = useSafeAreaInsets();
  const check = () => {
    if (pin.length > 0) { onUnlock(); }
    else { Alert.alert("PIN salah"); }
  };
  return (
    <View style={[styles.lockWrap, { paddingTop: insets.top + 60, backgroundColor: colors.background }]}>
      <Ionicons name="lock-closed" size={48} color={colors.primary} />
      <Text style={[styles.lockTitle, { color: colors.foreground }]}>Admin Panel</Text>
      <Text style={[styles.lockSub, { color: colors.mutedForeground }]}>Masukkan PIN admin</Text>
      <TextInput
        style={[styles.pinInput, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.secondary }]}
        value={pin}
        onChangeText={setPin}
        secureTextEntry
        keyboardType="number-pad"
        placeholder="••••"
        placeholderTextColor={colors.mutedForeground}
        maxLength={10}
        returnKeyType="done"
        onSubmitEditing={check}
      />
      <Pressable style={[styles.unlockBtn, { backgroundColor: colors.primary }]} onPress={check}>
        <Text style={styles.unlockBtnText}>Masuk</Text>
      </Pressable>
    </View>
  );
}

// ─── MAIN SCREEN ─────────────────────────────────────────────────────────────

export default function AdminScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [unlocked, setUnlocked] = useState(false);
  const [mode, setMode] = useState<Mode>("scrape");

  const [scrapeUrl, setScrapeUrl] = useState("");
  const [scraping, setScraping] = useState(false);
  const [scraped, setScraped] = useState<ScrapedDrama | null>(null);
  const [saving, setSaving] = useState(false);
  const [scrapeLog, setScrapeLog] = useState("");

  const [mBookId, setMBookId] = useState("");
  const [mTitle, setMTitle] = useState("");
  const [mCover, setMCover] = useState("");
  const [mStatus, setMStatus] = useState("Ongoing");
  const [mTags, setMTags] = useState("");
  const [mEps, setMEps] = useState<ScrapedEp[]>([]);
  const [newEpUrl, setNewEpUrl] = useState("");
  const [newEpTitle, setNewEpTitle] = useState("");

  useEffect(() => {
    AsyncStorage.getItem(ADMIN_KEY).then((v) => { if (v === "1") setUnlocked(true); });
  }, []);

  const handleUnlock = () => {
    AsyncStorage.setItem(ADMIN_KEY, "1");
    setUnlocked(true);
  };

  const handleScrape = async () => {
    const url = scrapeUrl.trim();
    if (!url.startsWith("http")) {
      Alert.alert("URL tidak valid", "URL harus dimulai dengan https://");
      return;
    }
    setScraping(true);
    setScraped(null);
    setScrapeLog("Membuka halaman...");
    try {
      const result = await scrapeDrama(url);
      setScraped(result);
      setScrapeLog(`Berhasil: ${result.episodes.length} episode ditemukan`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setScrapeLog("");
      Alert.alert("Gagal Scrape", msg);
    } finally {
      setScraping(false);
    }
  };

  const saveScrapeToFirestore = async () => {
    if (!scraped) return;
    setSaving(true);
    try {
      const bookId = `${scraped.source}_${Date.now()}`;
      await setDoc(doc(db, "dramas", bookId), {
        bookId, title: scraped.title, cover: scraped.cover,
        totalEps: scraped.totalEps, status: scraped.status,
        tags: scraped.tags, lastScraped: { seconds: Math.floor(Date.now() / 1000) },
      });
      await setDoc(doc(db, "episodes", bookId), { bookId, chapters: scraped.episodes });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Berhasil!", `"${scraped.title}" tersimpan.\n${scraped.episodes.length} episode.`, [
        { text: "OK", onPress: () => { setScraped(null); setScrapeUrl(""); setScrapeLog(""); } },
      ]);
    } catch (e) {
      Alert.alert("Error simpan", String(e));
    } finally {
      setSaving(false);
    }
  };

  const addManualEp = () => {
    if (!newEpUrl.trim()) return;
    const i = mEps.length;
    setMEps([...mEps, {
      title: newEpTitle.trim() || `Episode ${i + 1}`,
      rawUrl: newEpUrl.trim(),
      quality: 720,
      sources: [{ quality: 720, rawUrl: newEpUrl.trim() }],
      thumbnailUrl: mCover,
      chapterIndex: i,
    }]);
    setNewEpUrl("");
    setNewEpTitle("");
  };

  const saveManual = async () => {
    if (!mTitle.trim()) { Alert.alert("Judul wajib diisi"); return; }
    setSaving(true);
    try {
      const bookId = mBookId.trim() || `manual_${Date.now()}`;
      await setDoc(doc(db, "dramas", bookId), {
        bookId, title: mTitle.trim(), cover: mCover.trim(),
        totalEps: mEps.length, status: mStatus,
        tags: mTags.trim(), lastScraped: { seconds: Math.floor(Date.now() / 1000) },
      });
      if (mEps.length > 0) {
        await setDoc(doc(db, "episodes", bookId), { bookId, chapters: mEps });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Tersimpan!", `"${mTitle}" berhasil disimpan.`, [
        { text: "OK", onPress: () => { setMTitle(""); setMBookId(""); setMCover(""); setMTags(""); setMEps([]); } },
      ]);
    } catch (e) {
      Alert.alert("Error", String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!unlocked) return <AdminLock onUnlock={handleUnlock} colors={colors} />;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, { paddingTop: Platform.OS === "web" ? 67 : insets.top + 8, borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Admin Panel</Text>
        <Pressable onPress={() => { AsyncStorage.removeItem(ADMIN_KEY); setUnlocked(false); }} hitSlop={10}>
          <Ionicons name="log-out-outline" size={22} color={colors.mutedForeground} />
        </Pressable>
      </View>

      <View style={[styles.modeBar, { borderBottomColor: colors.border }]}>
        {(["scrape", "manual"] as Mode[]).map((m) => (
          <Pressable key={m} onPress={() => setMode(m)}
            style={[styles.modeTab, { borderBottomColor: mode === m ? colors.primary : "transparent" }]}>
            <Ionicons name={m === "scrape" ? "globe-outline" : "pencil-outline"} size={16}
              color={mode === m ? colors.primary : colors.mutedForeground} />
            <Text style={[styles.modeTabText, { color: mode === m ? colors.primary : colors.mutedForeground }]}>
              {m === "scrape" ? "Scrape URL" : "Manual"}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {mode === "scrape" ? (
          <View style={styles.section}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>URL Halaman Drama</Text>
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              Coba: ReelShort · DramaBox · ShortTV · situs dengan video embed
            </Text>
            <View style={[styles.inputRow, { borderColor: colors.border }]}>
              <TextInput
                style={[styles.inputFlex, { color: colors.foreground }]}
                value={scrapeUrl}
                onChangeText={setScrapeUrl}
                placeholder="https://..."
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="done"
                onSubmitEditing={handleScrape}
              />
              {scrapeUrl.length > 0 && (
                <Pressable onPress={() => { setScrapeUrl(""); setScraped(null); setScrapeLog(""); }} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={colors.mutedForeground} />
                </Pressable>
              )}
            </View>

            {scrapeLog ? (
              <Text style={[styles.hint, { color: colors.primary, marginTop: 4 }]}>{scrapeLog}</Text>
            ) : null}

            <Pressable
              style={[styles.btn, { backgroundColor: scraping ? colors.muted : colors.primary, opacity: scraping ? 0.7 : 1 }]}
              onPress={handleScrape} disabled={scraping}
            >
              {scraping ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="download-outline" size={18} color="#fff" />
                  <Text style={styles.btnText}>Scrape Sekarang</Text>
                </>
              )}
            </Pressable>

            {scraped && (
              <View style={[styles.previewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.previewRow}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                  <Text style={[styles.previewSrc, { color: colors.primary }]}>
                    {scraped.source.toUpperCase()}
                  </Text>
                </View>
                <Text style={[styles.previewTitle, { color: colors.foreground }]}>{scraped.title}</Text>
                <Text style={[styles.previewMeta, { color: colors.mutedForeground }]}>
                  {scraped.episodes.length} episode · {scraped.status}
                </Text>
                {scraped.cover ? (
                  <Text style={[styles.previewMeta, { color: colors.mutedForeground }]}>Cover: ✓</Text>
                ) : null}
                {scraped.episodes.slice(0, 3).map((ep, i) => (
                  <Text key={i} style={[styles.previewEp, { color: colors.mutedForeground }]} numberOfLines={1}>
                    EP{i + 1}: {ep.rawUrl || "(tidak ada URL)"}
                  </Text>
                ))}
                {scraped.episodes.length > 3 && (
                  <Text style={[styles.previewMeta, { color: colors.mutedForeground }]}>
                    + {scraped.episodes.length - 3} episode lainnya...
                  </Text>
                )}
                <View style={[styles.warnBox, { borderColor: colors.border }]}>
                  <Ionicons name="information-circle-outline" size={14} color={colors.mutedForeground} />
                  <Text style={[styles.warnText, { color: colors.mutedForeground }]}>
                    Jika URL episode kosong, gunakan mode Manual untuk input URL video langsung.
                  </Text>
                </View>
                <Pressable
                  style={[styles.btn, { backgroundColor: saving ? colors.muted : colors.accent, marginTop: 14 }]}
                  onPress={saveScrapeToFirestore} disabled={saving}
                >
                  {saving ? <ActivityIndicator color="#fff" /> : (
                    <>
                      <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
                      <Text style={styles.btnText}>Simpan ke Firestore</Text>
                    </>
                  )}
                </Pressable>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>ID Drama (opsional)</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.secondary }]}
              value={mBookId} onChangeText={setMBookId}
              placeholder="drama_001 (otomatis jika kosong)"
              placeholderTextColor={colors.mutedForeground}
            />

            <Text style={[styles.label, { color: colors.mutedForeground }]}>Judul *</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.secondary }]}
              value={mTitle} onChangeText={setMTitle}
              placeholder="Nama drama..."
              placeholderTextColor={colors.mutedForeground}
            />

            <Text style={[styles.label, { color: colors.mutedForeground }]}>URL Cover</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.secondary }]}
              value={mCover} onChangeText={setMCover}
              placeholder="https://..."
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none" keyboardType="url"
            />

            <Text style={[styles.label, { color: colors.mutedForeground }]}>Status</Text>
            <View style={styles.statusRow}>
              {["Ongoing", "Completed"].map((s) => (
                <Pressable key={s} onPress={() => setMStatus(s)}
                  style={[styles.chip, { backgroundColor: mStatus === s ? colors.primary : colors.secondary, borderColor: mStatus === s ? colors.primary : colors.border }]}>
                  <Text style={[styles.chipText, { color: mStatus === s ? "#fff" : colors.mutedForeground }]}>{s}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[styles.label, { color: colors.mutedForeground }]}>Tags / Deskripsi</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.secondary }]}
              value={mTags} onChangeText={setMTags}
              placeholder="Romance, Action, ..."
              placeholderTextColor={colors.mutedForeground}
            />

            <Text style={[styles.label, { color: colors.mutedForeground }]}>Judul Episode (opsional)</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.secondary }]}
              value={newEpTitle} onChangeText={setNewEpTitle}
              placeholder="Episode 1 / Ep 1 / ..."
              placeholderTextColor={colors.mutedForeground}
            />

            <Text style={[styles.label, { color: colors.mutedForeground }]}>URL Video Episode</Text>
            <View style={[styles.inputRow, { borderColor: colors.border }]}>
              <TextInput
                style={[styles.inputFlex, { color: colors.foreground }]}
                value={newEpUrl} onChangeText={setNewEpUrl}
                placeholder="https://...episode.mp4"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none" keyboardType="url"
                returnKeyType="done" onSubmitEditing={addManualEp}
              />
              <Pressable onPress={addManualEp} style={[styles.addEpBtn, { backgroundColor: colors.primary }]}>
                <Ionicons name="add" size={20} color="#fff" />
              </Pressable>
            </View>

            {mEps.length > 0 && (
              <View style={{ marginTop: 8 }}>
                {mEps.map((ep, i) => (
                  <EpRow key={i} ep={ep} index={i}
                    onRemove={() => setMEps(mEps.filter((_, idx) => idx !== i))}
                    colors={colors} />
                ))}
              </View>
            )}

            <Pressable
              style={[styles.btn, { backgroundColor: saving ? colors.muted : colors.accent, marginTop: 16 }]}
              onPress={saveManual} disabled={saving}
            >
              {saving ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
                  <Text style={styles.btnText}>Simpan ke Firestore</Text>
                </>
              )}
            </Pressable>
          </View>
        )}
        <View style={{ height: Platform.OS === "web" ? 34 : insets.bottom + 24 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  lockWrap: { flex: 1, alignItems: "center", gap: 16, paddingHorizontal: 40 },
  lockTitle: { fontSize: 24, fontFamily: "Inter_700Bold", marginTop: 8 },
  lockSub: { fontSize: 14, fontFamily: "Inter_400Regular" },
  pinInput: {
    width: "100%", height: 52, borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 20, fontSize: 22, letterSpacing: 8, textAlign: "center",
    fontFamily: "Inter_600SemiBold",
  },
  unlockBtn: { width: "100%", height: 50, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  unlockBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  modeBar: { flexDirection: "row", borderBottomWidth: 1 },
  modeTab: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 12, borderBottomWidth: 2,
  },
  modeTabText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  section: { padding: 16, gap: 6 },
  label: { fontSize: 12, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5, marginTop: 8 },
  hint: { fontSize: 11, fontFamily: "Inter_400Regular", marginBottom: 4 },
  input: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, fontFamily: "Inter_400Regular",
  },
  inputRow: {
    flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: Platform.OS === "ios" ? 14 : 4,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  inputFlex: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  btn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, height: 50, borderRadius: 12, marginTop: 12,
  },
  btnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  previewCard: { borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 12, gap: 4 },
  previewRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  previewSrc: { fontSize: 11, fontFamily: "Inter_700Bold" },
  previewTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginTop: 4 },
  previewMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  previewEp: { fontSize: 11, fontFamily: "Inter_400Regular" },
  warnBox: {
    flexDirection: "row", gap: 6, alignItems: "flex-start",
    marginTop: 8, padding: 10, borderWidth: 1, borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  warnText: { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16 },
  statusRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  epRow: {
    flexDirection: "row", alignItems: "center", paddingVertical: 8,
    paddingHorizontal: 10, borderWidth: 1, borderRadius: 8, marginBottom: 6,
  },
  epRowTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  epRowUrl: { fontSize: 11, fontFamily: "Inter_400Regular" },
  addEpBtn: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center", marginLeft: 8 },
  destructive: { color: "#e5534b" },
});
