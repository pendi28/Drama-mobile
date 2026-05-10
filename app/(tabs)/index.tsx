import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { collection, getDocs } from "firebase/firestore";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { db } from "@/lib/firebase";
import { Drama } from "@/lib/types";
import { useColors } from "@/hooks/useColors";

const { width: SCREEN_W } = Dimensions.get("window");
const CARD_W = (SCREEN_W - 48) / 2;
const CAROUSEL_W = SCREEN_W - 48;

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [dramas, setDramas] = useState<Drama[]>([]);
  const [filtered, setFiltered] = useState<Drama[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "Ongoing" | "Completed">("all");

  const loadDramas = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, "dramas"));
      const data = snap.docs.map((d) => ({ bookId: d.id, ...d.data() } as Drama));
      data.sort((a, b) => (b.lastScraped?.seconds ?? 0) - (a.lastScraped?.seconds ?? 0));
      setDramas(data);
      setFiltered(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadDramas(); }, [loadDramas]);

  useEffect(() => {
    let list = dramas;
    if (filter !== "all") list = list.filter((d) => d.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((d) => d.title?.toLowerCase().includes(q));
    }
    setFiltered(list);
  }, [search, filter, dramas]);

  const featured = dramas.filter((d) => d.cover).slice(0, 5);

  const renderDrama = useCallback(
    ({ item, index }: { item: Drama; index: number }) => {
      const isLeft = index % 2 === 0;
      return (
        <Pressable
          onPress={() => router.push(`/player/${item.bookId}`)}
          style={[
            styles.dramaCard,
            { marginLeft: isLeft ? 16 : 8, marginRight: isLeft ? 8 : 16 },
          ]}
        >
          {item.cover ? (
            <Image
              source={{ uri: item.cover }}
              style={styles.dramaPoster}
              contentFit="cover"
              transition={200}
            />
          ) : (
            <View style={[styles.dramaPoster, { backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }]}>
              <Ionicons name="film-outline" size={32} color={colors.mutedForeground} />
            </View>
          )}
          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.85)"]}
            style={styles.dramaGrad}
          >
            <Text style={styles.dramaTitle} numberOfLines={2}>{item.title}</Text>
            <Text style={styles.dramaMeta}>{item.totalEps ?? 0} Eps</Text>
          </LinearGradient>
          <View style={[styles.statusBadge, { backgroundColor: item.status === "Ongoing" ? colors.primary : colors.accent }]}>
            <Text style={styles.statusText}>{item.status === "Ongoing" ? "Live" : "Done"}</Text>
          </View>
        </Pressable>
      );
    },
    [colors]
  );

  const renderHeader = () => (
    <View>
      {/* Search */}
      <View style={[styles.searchWrap, { marginTop: Platform.OS === "web" ? 67 : 0 }]}>
        <Ionicons name="search" size={18} color={colors.mutedForeground} style={styles.searchIcon} />
        <TextInput
          style={[styles.searchInput, { color: colors.foreground, borderColor: colors.border }]}
          placeholder="Cari drama..."
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
        />
      </View>

      {/* Filter chips */}
      <View style={styles.filterRow}>
        {(["all", "Ongoing", "Completed"] as const).map((f) => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={[
              styles.chip,
              { backgroundColor: filter === f ? colors.primary : colors.secondary, borderColor: filter === f ? colors.primary : colors.border },
            ]}
          >
            <Text style={[styles.chipText, { color: filter === f ? "#fff" : colors.mutedForeground }]}>
              {f === "all" ? "Semua" : f === "Ongoing" ? "Ongoing" : "Selesai"}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Featured carousel */}
      {featured.length > 0 && (
        <View style={styles.carouselSection}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>UNGGULAN</Text>
          <FlatList
            data={featured}
            keyExtractor={(d) => d.bookId}
            horizontal
            showsHorizontalScrollIndicator={false}
            pagingEnabled={false}
            snapToInterval={CAROUSEL_W + 12}
            decelerationRate="fast"
            contentContainerStyle={{ paddingLeft: 16, paddingRight: 4 }}
            renderItem={({ item }) => (
              <Pressable onPress={() => router.push(`/player/${item.bookId}`)} style={styles.carCard}>
                <Image source={{ uri: item.cover }} style={styles.carImage} contentFit="cover" transition={200} />
                <LinearGradient colors={["transparent", "rgba(0,0,0,0.9)"]} style={styles.carGrad}>
                  <Text style={styles.carTitle} numberOfLines={2}>{item.title}</Text>
                  <Text style={styles.carMeta}>{item.totalEps ?? 0} Episode · {item.status}</Text>
                </LinearGradient>
              </Pressable>
            )}
          />
        </View>
      )}

      <Text style={[styles.sectionLabel, { color: colors.mutedForeground, paddingHorizontal: 16 }]}>
        SEMUA DRAMA {filtered.length > 0 ? `· ${filtered.length}` : ""}
      </Text>
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={filtered}
        keyExtractor={(d) => d.bookId}
        numColumns={2}
        renderItem={renderDrama}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Ionicons name="film-outline" size={48} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              {search ? "Tidak ditemukan" : "Belum ada drama\nGunakan Admin Panel"}
            </Text>
          </View>
        }
        contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 34 : 16 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); loadDramas(); }}
            tintColor={colors.primary}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },

  searchWrap: { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginTop: 12, marginBottom: 10 },
  searchIcon: { position: "absolute", left: 12, zIndex: 1 },
  searchInput: {
    flex: 1, height: 44, paddingLeft: 38, paddingRight: 14,
    borderRadius: 12, borderWidth: 1, fontSize: 15,
    backgroundColor: "rgba(255,255,255,0.05)",
    fontFamily: "Inter_400Regular",
  },

  filterRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 16 },
  chip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  carouselSection: { marginBottom: 20 },
  sectionLabel: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 1, marginBottom: 10 },
  carCard: { width: CAROUSEL_W, height: CAROUSEL_W * 0.56, borderRadius: 14, overflow: "hidden", marginRight: 12 },
  carImage: { ...StyleSheet.absoluteFillObject },
  carGrad: { ...StyleSheet.absoluteFillObject, justifyContent: "flex-end", padding: 14 },
  carTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff", marginBottom: 4 },
  carMeta: { fontSize: 12, color: "rgba(255,255,255,0.7)", fontFamily: "Inter_400Regular" },

  dramaCard: { width: CARD_W, marginBottom: 12, borderRadius: 12, overflow: "hidden", aspectRatio: 9 / 13 },
  dramaPoster: { ...StyleSheet.absoluteFillObject },
  dramaGrad: { ...StyleSheet.absoluteFillObject, justifyContent: "flex-end", padding: 10 },
  dramaTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff", marginBottom: 2 },
  dramaMeta: { fontSize: 11, color: "rgba(255,255,255,0.65)", fontFamily: "Inter_400Regular" },
  statusBadge: { position: "absolute", top: 8, right: 8, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  statusText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" },

  emptyWrap: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
});
