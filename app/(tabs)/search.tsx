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
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { db } from "@/lib/firebase";
import { Drama } from "@/lib/types";
import { useColors } from "@/hooks/useColors";

const { width: SCREEN_W } = Dimensions.get("window");
const CARD_W = (SCREEN_W - 48) / 2;

export default function SearchScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [allDramas, setAllDramas] = useState<Drama[]>([]);
  const [results, setResults] = useState<Drama[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    getDocs(collection(db, "dramas")).then((snap) => {
      const data = snap.docs.map((d) => ({ bookId: d.id, ...d.data() } as Drama));
      setAllDramas(data);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q) { setResults([]); return; }
    setResults(allDramas.filter((d) => d.title?.toLowerCase().includes(q)));
  }, [query, allDramas]);

  const renderCard = useCallback(
    ({ item, index }: { item: Drama; index: number }) => {
      const isLeft = index % 2 === 0;
      return (
        <Pressable
          onPress={() => router.push(`/player/${item.bookId}`)}
          style={[styles.card, { marginLeft: isLeft ? 16 : 8, marginRight: isLeft ? 8 : 16 }]}
        >
          {item.cover ? (
            <Image source={{ uri: item.cover }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }]}>
              <Ionicons name="film-outline" size={32} color={colors.mutedForeground} />
            </View>
          )}
          <LinearGradient colors={["transparent", "rgba(0,0,0,0.88)"]} style={[StyleSheet.absoluteFill, styles.cardGrad]}>
            <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
            <Text style={styles.cardMeta}>{item.totalEps ?? 0} Eps · {item.status}</Text>
          </LinearGradient>
        </Pressable>
      );
    },
    [colors]
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Search bar */}
      <View style={[styles.searchBar, { paddingTop: Platform.OS === "web" ? 67 : insets.top + 8, backgroundColor: colors.background }]}>
        <View style={[styles.inputWrap, { borderColor: colors.border }]}>
          <Ionicons name="search" size={18} color={colors.mutedForeground} style={styles.searchIcon} />
          <TextInput
            ref={inputRef}
            style={[styles.input, { color: colors.foreground }]}
            placeholder="Cari judul drama..."
            placeholderTextColor={colors.mutedForeground}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            autoFocus
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")} hitSlop={10}>
              <Ionicons name="close-circle" size={18} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : query.trim() === "" ? (
        <View style={styles.centered}>
          <Ionicons name="search-outline" size={52} color={colors.mutedForeground} />
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>Ketik untuk mencari drama</Text>
        </View>
      ) : results.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="film-outline" size={52} color={colors.mutedForeground} />
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>"{query}" tidak ditemukan</Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(d) => d.bookId}
          numColumns={2}
          renderItem={renderCard}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: Platform.OS === "web" ? 34 : 16 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  searchBar: { paddingHorizontal: 16, paddingBottom: 12 },
  inputWrap: {
    flexDirection: "row", alignItems: "center",
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, height: 46,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  searchIcon: { marginRight: 8 },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  card: { width: CARD_W, borderRadius: 12, overflow: "hidden", aspectRatio: 9 / 13, marginBottom: 12 },
  cardGrad: { justifyContent: "flex-end", padding: 10 },
  cardTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff", marginBottom: 2 },
  cardMeta: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.65)" },
  hint: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
});
