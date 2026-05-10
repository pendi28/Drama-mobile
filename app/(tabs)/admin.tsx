import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { addDoc, collection, doc, setDoc } from "firebase/firestore";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
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
const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN ?? "localhost"}`;

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

function EpRow({
  ep,
  index,
  onRemove,
  colors,
}: {
  ep: ScrapedEp;
  index: number;
  onRemove: () => void;
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
    if (pin === "admin123" || pin.length > 0) {
      onUnlock();
    } else {
      Alert.alert("PIN salah");
    }
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

export default function AdminScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [unlocked, setUnlocked] = useState(false);
  const [mode, setMode] = useState<Mode>("scrape");

  // Scrape mode state
  const [scrapeUrl, setScrapeUrl] = useState("");
  const [scraping, setScraping] = useState(false);
  const [scraped, setScraped] = useState<ScrapedDrama | null>(null);
  const [saving, setSaving] = useState(false);

  // Manual mode state
  const [mBookId, setMBookId] = useState("");
  const [mTitle, setMTitle] = useState("");
  const [mCover, setMCover] = useState("");
  const [mStatus, setMStatus] = useState("Ongoing");
  const [mTags, setMTags] = useState("");
  const [mEps, setMEps] = useState<ScrapedEp[]>([]);
  const [newEpUrl, setNewEpUrl] = useState("");

  useEffect(() => {
    AsyncStorage.getItem(ADMIN_KEY).then((v) => { if (v === "1") setUnlocked(true); });
  }, []);

  const handleUnlock = () => {
    AsyncStorage.setItem(ADMIN_KEY, "1");
    setUnlocked(true);
  };

  const handleScrape = async () => {
    if (!scrapeUrl.trim().startsWith("http")) {
      Alert.alert("URL tidak valid", "Masukkan URL yang dimulai dengan https://");
      return;
    }
    setScraping(true);
    setScraped(null);
    try {
      const res = await fetch(`${API_BASE}/api/scraper/fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: scrapeUrl.trim() }),
      });
      const json = await res.json() as { ok?: boolean; data?: ScrapedDrama; error?: string };
      if (json.ok && json.data) {
        setScraped(json.data);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Alert.alert("Gagal", json.error ?? "Terjadi error");
      }
    } catch (e) {
      Alert.alert("Error", String(e));
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
        bookId,
        title: scraped.title,
        cover: scraped.cover,
        totalEps: scraped.totalEps,
        status: scraped.status,
        tags: scraped.tags,
        lastScraped: { seconds: Math.floor(Date.now() / 1000) },
      });
      await setDoc(doc(db, "episodes", bookId), {
        bookId,
        chapters: scraped.episodes,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Berhasil!", `"${scraped.title}" tersimpan.\n${scraped.episodes.length} episode.`, [
        { text: "OK", onPress: () => { setScraped(null); setScrapeUrl(""); } },
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
      title: `Episode ${i + 1}`,
      rawUrl: newEpUrl.trim(),
      quality: 720,
      sources: [{ quality: 720, rawUrl: newEpUrl.trim() }],
      thumbnailUrl: mCover,
      chapterIndex: i,
    }]);
    setNewEpUrl("");
  };

  const saveManual = async () => {
    if (!mTitle.trim()) { Alert.alert("Judul wajib diisi"); return; }
    setSaving(true);
    try {
      const bookId = mBookId.trim() || `manual_${Date.now()}`;
      await setDoc(doc(db, "dramas", bookId), {
        bookId,
        title: mTitle.trim(),
        cover: mCover.trim(),
        totalEps: mEps.length,
        status: mStatus,
        tags: mTags.trim(),
        lastScraped: { seconds: Math.floor(Date.now() / 1000) },
      });
      if (mEps.length > 0) {
        await setDoc(doc(db, "episodes", bookId), {
          bookId,
          chapters: mEps,
        });
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

  if (!unlocked) {
    return <AdminLock onUnlock={handleUnlock} colors={colors} />;
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: Platform.OS === "web" ? 67 : insets.top + 8, borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Admin Panel</Text>
        <Pressable onPress={() => { AsyncStorage.removeItem(ADMIN_KEY); setUnlocked(false); }} hitSlop={10}>
          <Ionicons name="log-out-outline" size={22} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {/* Mode tabs */}
      <View style={[styles.modeBar, { borderBottomColor: colors.border }]}>
        {(["scrape", "manual"] as Mode[]).map((m) => (
          <Pressable
            key={m}
            onPress={() => setMode(m)}
            style={[styles.modeTab, { borderBottomColor: mode === m ? colors.primary : "transparent" }]}
          >
            <Ionicons
              name={m === "scrape" ? "globe-outline" : "pencil-outline"}
              size={16}
              color={mode === m ? colors.primary : colors.mutedForeground}
            />
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
              Dukung: DramaBox · ReelShort · ShortTV · dan situs drama lainnya
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
                <Pressable onPress={() => setScrapeUrl("")} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={colors.mutedForeground} />
                </Pressable>
              )}
            </View>

            <Pressable
              style={[styles.btn, { backgroundColor: scraping ? colors.muted : colors.primary, opacity: scraping ? 0.7 : 1 }]}
              onPress={handleScrape}
              disabled={scraping}
            >
              {scraping ? (
                <ActivityIndicator color="#fff" />
              ) : (
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
                    Sumber: {scraped.source.toUpperCase()}
                  </Text>
                </View>
                <Text style={[styles.previewTitle, { color: colors.foreground }]}>{scraped.title}</Text>
                {scraped.cover ? (
                  <Text style={[styles.previewMeta, { color: colors.mutedForeground }]}>Cover: ✓</Text>
                ) : null}
                <Text style={[styles.previewMeta, { color: colors.mutedForeground }]}>
                  {scraped.episodes.length} episode ditemukan
                </Text>
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

                <Pressable
                  style={[styles.btn, { backgroundColor: saving ? colors.muted : colors.accent, marginTop: 14 }]}
                  onPress={saveScrapeToFirestore}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
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
            {/* Manual form */}
            <Text style={[styles.label, { color: colors.mutedForeground }]}>ID Drama (opsional)</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.secondary }]}
              value={mBookId}
              onChangeText={setMBookId}
              placeholder="drama_001 (otomatis jika kosong)"
              placeholderTextColor={colors.mutedForeground}
            />

            <Text style={[styles.label, { color: colors.mutedForeground }]}>Judul *</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.secondary }]}
              value={mTitle}
              onChangeText={setMTitle}
              placeholder="Nama drama..."
              placeholderTextColor={colors.mutedForeground}
            />

            <Text style={[styles.label, { color: colors.mutedForeground }]}>URL Cover</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.secondary }]}
              value={mCover}
              onChangeText={setMCover}
              placeholder="https://..."
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              keyboardType="url"
            />

            <Text style={[styles.label, { color: colors.mutedForeground }]}>Status</Text>
            <View style={styles.statusRow}>
              {["Ongoing", "Completed"].map((s) => (
                <Pressable
                  key={s}
                  onPress={() => setMStatus(s)}
                  style={[styles.chip, { backgroundColor: mStatus === s ? colors.primary : colors.secondary, borderColor: mStatus === s ? colors.primary : colors.border }]}
                >
                  <Text style={[styles.chipText, { color: mStatus === s ? "#fff" : colors.mutedForeground }]}>{s}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[styles.label, { color: colors.mutedForeground }]}>Tags / Deskripsi</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.secondary }]}
              value={mTags}
              onChangeText={setMTags}
              placeholder="Romance, Action, ..."
              placeholderTextColor={colors.mutedForeground}
            />

            <Text style={[styles.label, { color: colors.mutedForeground }]}>Tambah Episode (URL Video)</Text>
            <View style={[styles.inputRow, { borderColor: colors.border }]}>
              <TextInput
                style={[styles.inputFlex, { color: colors.foreground }]}
                value={newEpUrl}
                onChangeText={setNewEpUrl}
                placeholder="https://...episode1.mp4"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                keyboardType="url"
                returnKeyType="done"
                onSubmitEditing={addManualEp}
              />
              <Pressable onPress={addManualEp} style={[styles.addEpBtn, { backgroundColor: colors.primary }]}>
                <Ionicons name="add" size={20} color="#fff" />
              </Pressable>
            </View>

            {mEps.length > 0 && (
              <View style={{ marginTop: 8 }}>
                {mEps.map((ep, i) => (
                  <EpRow
                    key={i}
                    ep={ep}
                    index={i}
                    onRemove={() => setMEps(mEps.filter((_, idx) => idx !== i))}
                    colors={colors}
                  />
                ))}
              </View>
            )}

            <Pressable
              style={[styles.btn, { backgroundColor: saving ? colors.muted : colors.accent, marginTop: 16 }]}
              onPress={saveManual}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
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
});
