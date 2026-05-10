import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { collection, getDocs } from "firebase/firestore";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { db } from "@/lib/firebase";
import { getFavorites } from "@/lib/storage";
import { Drama } from "@/lib/types";
import { useColors } from "@/hooks/useColors";

const { width: SCREEN_W } = Dimensions.get("window");
const CARD_W = (SCREEN_W - 48) / 2;

export default function FavoritesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [dramas, setDramas] = useState<Drama[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const favIds = await getFavorites();
      if (!favIds.length) { setDramas([]); return; }
      const snap = await getDocs(collection(db, "dramas"));
      const all = snap.docs.map((d) => ({ bookId: d.id, ...d.data() } as Drama));
      setDramas(all.filter((d) => favIds.includes(d.bookId)));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

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
        data={dramas}
        keyExtractor={(d) => d.bookId}
        numColumns={2}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 34 : 16 }}
        ListHeaderComponent={
          <View style={[styles.header, { paddingTop: Platform.OS === "web" ? 67 : insets.top + 8 }]}>
            <Text style={[styles.title, { color: colors.foreground }]}>Favorit</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Ionicons name="heart-outline" size={52} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Belum Ada Favorit</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Tekan ikon hati di halaman drama untuk menyimpannya di sini
            </Text>
          </View>
        }
        renderItem={({ item, index }) => {
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
                <Text style={styles.cardMeta}>{item.totalEps ?? 0} Eps</Text>
              </LinearGradient>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { paddingHorizontal: 16, paddingBottom: 16 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold" },
  card: { width: CARD_W, borderRadius: 12, overflow: "hidden", aspectRatio: 9 / 13, marginBottom: 12 },
  cardGrad: { justifyContent: "flex-end", padding: 10 },
  cardTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff", marginBottom: 2 },
  cardMeta: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.65)" },
  emptyWrap: { alignItems: "center", paddingTop: 80, paddingHorizontal: 40, gap: 12 },
  emptyTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
});
