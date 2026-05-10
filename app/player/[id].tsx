import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { doc, getDoc } from "firebase/firestore";
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useVideoPlayer, VideoView } from "expo-video";

import { db, buildVideoUrl } from "@/lib/firebase";
import { getProgress, isFavorite, saveProgress, toggleFavorite } from "@/lib/storage";
import { Drama, Episode } from "@/lib/types";
import { useColors } from "@/hooks/useColors";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

export default function PlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [drama, setDrama] = useState<Drama | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [epIndex, setEpIndex] = useState(0);
  const [fav, setFav] = useState(false);
  const [loading, setLoading] = useState(true);
  const [resumeTarget, setResumeTarget] = useState<{ epIndex: number; time: number } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const videoRef = useRef<VideoView>(null);
  const currentEp = episodes[epIndex];
  const videoUri = currentEp?.rawUrl ? buildVideoUrl(currentEp.rawUrl) : undefined;

  const player = useVideoPlayer(videoUri ?? null, (p) => {
    p.loop = false;
  });

  // Auto-hide controls after 3s in fullscreen
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    if (isFullscreen) {
      controlsTimer.current = setTimeout(() => setShowControls(false), 3000);
    }
  }, [isFullscreen]);

  useEffect(() => {
    resetControlsTimer();
    return () => { if (controlsTimer.current) clearTimeout(controlsTimer.current); };
  }, [isFullscreen]);

  // Auto-play when source changes
  useEffect(() => {
    if (videoUri && player) {
      player.play();
    }
  }, [videoUri]);

  // Save progress every 5s
  useEffect(() => {
    if (!id) return;
    const interval = setInterval(() => {
      if (player && player.currentTime > 2) {
        saveProgress(id, epIndex, player.currentTime, player.duration ?? 0);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [id, epIndex, player]);

  // Load data
  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const [dramaSnap, epSnap, favStatus, prog] = await Promise.all([
          getDoc(doc(db, "dramas", id)),
          getDoc(doc(db, "episodes", id)),
          isFavorite(id),
          getProgress(id),
        ]);
        if (dramaSnap.exists()) setDrama({ bookId: id, ...dramaSnap.data() } as Drama);
        if (epSnap.exists()) {
          const chapters: Episode[] = epSnap.data().chapters ?? [];
          setEpisodes(chapters);
          if (prog && prog.epIndex < chapters.length) {
            setResumeTarget({ epIndex: prog.epIndex, time: prog.time });
            setEpIndex(prog.epIndex);
          }
        }
        setFav(favStatus);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const handleFav = useCallback(async () => {
    if (!id) return;
    const next = await toggleFavorite(id);
    setFav(next);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [id]);

  const goEp = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= episodes.length) return;
      setEpIndex(idx);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [episodes.length]
  );

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
    resetControlsTimer();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [resetControlsTimer]);

  // Swipe gesture on video: up = next, down = prev
  const swipeStart = useRef(0);
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 10,
      onPanResponderGrant: (_, g) => { swipeStart.current = g.y0; },
      onPanResponderRelease: (_, g) => {
        const dy = g.dy;
        if (dy < -50) goEp(epIndex + 1);
        else if (dy > 50) goEp(epIndex - 1);
      },
    })
  ).current;

  const VideoOverlay = ({ fullscreen = false }: { fullscreen?: boolean }) => (
    <Pressable style={StyleSheet.absoluteFill} onPress={resetControlsTimer}>
      {/* Header */}
      {(showControls || !fullscreen) && (
        <LinearGradient colors={["rgba(0,0,0,0.8)", "transparent"]} style={styles.videoHeader}>
          {!fullscreen && (
            <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={10}>
              <Ionicons name="chevron-back" size={26} color="#fff" />
            </Pressable>
          )}
          {fullscreen && (
            <Pressable onPress={toggleFullscreen} style={styles.backBtn} hitSlop={10}>
              <Ionicons name="chevron-down" size={26} color="#fff" />
            </Pressable>
          )}
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle} numberOfLines={1}>{drama?.title ?? ""}</Text>
            {currentEp && (
              <Text style={styles.headerEp} numberOfLines={1}>{currentEp.title || `Episode ${epIndex + 1}`}</Text>
            )}
          </View>
          <Pressable onPress={handleFav} hitSlop={10}>
            <Ionicons name={fav ? "heart" : "heart-outline"} size={24} color={fav ? "#e5534b" : "#fff"} />
          </Pressable>
        </LinearGradient>
      )}

      {/* Fullscreen button bottom-right */}
      {(showControls || !fullscreen) && (
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.6)"]}
          style={styles.videoFooter}
        >
          {epIndex > 0 && (
            <Pressable style={styles.footerBtn} onPress={() => goEp(epIndex - 1)} hitSlop={8}>
              <Ionicons name="play-skip-back" size={20} color="#fff" />
            </Pressable>
          )}
          <View style={{ flex: 1 }} />
          {epIndex < episodes.length - 1 && (
            <Pressable style={styles.footerBtn} onPress={() => goEp(epIndex + 1)} hitSlop={8}>
              <Ionicons name="play-skip-forward" size={20} color="#fff" />
            </Pressable>
          )}
          <Pressable style={styles.footerBtn} onPress={toggleFullscreen} hitSlop={8}>
            <Ionicons
              name={fullscreen ? "contract" : "expand"}
              size={20}
              color="#fff"
            />
          </Pressable>
        </LinearGradient>
      )}
    </Pressable>
  );

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: "#000" }]}>
        <StatusBar style="light" hidden={false} />
        <ActivityIndicator color="#0d9488" size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : 0 }]}>
      <StatusBar style="light" hidden={false} />

      {/* Fullscreen Modal */}
      <Modal
        visible={isFullscreen}
        statusBarTranslucent
        animationType="fade"
        supportedOrientations={["portrait", "landscape", "landscape-left", "landscape-right"]}
        onRequestClose={toggleFullscreen}
      >
        <StatusBar style="light" hidden />
        <View style={styles.fullscreenContainer}>
          <View style={styles.fullscreenVideo} {...panResponder.panHandlers}>
            {videoUri ? (
              <VideoView
                ref={videoRef}
                player={player}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                nativeControls={false}
              />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.noVideo]}>
                <Ionicons name="play-circle-outline" size={64} color="rgba(255,255,255,0.3)" />
              </View>
            )}
            <VideoOverlay fullscreen />
          </View>
        </View>
      </Modal>

      {/* Normal video section */}
      <View style={styles.videoWrap} {...panResponder.panHandlers}>
        {videoUri ? (
          <VideoView
            ref={videoRef}
            player={player}
            style={styles.video}
            contentFit="contain"
            nativeControls={false}
          />
        ) : (
          <View style={[styles.video, styles.noVideo]}>
            <Ionicons name="play-circle-outline" size={64} color="rgba(255,255,255,0.3)" />
            <Text style={styles.noVideoText}>
              {episodes.length === 0 ? "Episode belum tersedia" : "Pilih episode"}
            </Text>
          </View>
        )}
        <VideoOverlay />
      </View>

      {/* Resume bar */}
      {resumeTarget && (
        <Pressable
          style={styles.resumeBar}
          onPress={() => {
            if (player && resumeTarget) {
              player.currentTime = resumeTarget.time;
              player.play();
            }
            setResumeTarget(null);
          }}
        >
          <Ionicons name="play-forward" size={16} color="#0d9488" />
          <Text style={styles.resumeText}>
            Lanjutkan dari EP {resumeTarget.epIndex + 1} · {Math.floor(resumeTarget.time / 60)}:{String(Math.floor(resumeTarget.time % 60)).padStart(2, "0")}
          </Text>
          <Pressable onPress={() => setResumeTarget(null)} hitSlop={8}>
            <Ionicons name="close" size={16} color="rgba(255,255,255,0.5)" />
          </Pressable>
        </Pressable>
      )}

      {/* Episode list */}
      <ScrollView style={styles.epSection} showsVerticalScrollIndicator={false}>
        <View style={styles.epHeader}>
          <Text style={styles.epTitle}>Episode</Text>
          <Text style={styles.epCount}>{episodes.length} EP</Text>
        </View>
        <View style={styles.epGrid}>
          {episodes.map((ep, i) => (
            <Pressable
              key={i}
              onPress={() => goEp(i)}
              style={[
                styles.epBtn,
                { backgroundColor: i === epIndex ? "#0d9488" : "#0f1318", borderColor: i === epIndex ? "#0d9488" : "#1e252e" },
              ]}
            >
              <Text style={[styles.epBtnText, { color: i === epIndex ? "#fff" : "#8b949e" }]} numberOfLines={1}>
                {ep.title || (i + 1)}
              </Text>
            </Pressable>
          ))}
        </View>
        {episodes.length === 0 && (
          <View style={styles.epEmpty}>
            <Ionicons name="list-outline" size={36} color="#8b949e" />
            <Text style={styles.epEmptyText}>Episode belum di-scrape{"\n"}Gunakan Admin Panel</Text>
          </View>
        )}
        <View style={{ height: Platform.OS === "web" ? 34 : insets.bottom + 16 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#080c10" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },

  videoWrap: { width: SCREEN_W, aspectRatio: 16 / 9, backgroundColor: "#000", position: "relative" },
  video: { width: "100%", height: "100%" },
  noVideo: { alignItems: "center", justifyContent: "center", gap: 12 },
  noVideoText: { color: "rgba(255,255,255,0.4)", fontSize: 14, fontFamily: "Inter_400Regular" },

  videoHeader: {
    position: "absolute", top: 0, left: 0, right: 0,
    height: 90, flexDirection: "row",
    alignItems: "flex-start", paddingTop: 12,
    paddingHorizontal: 14, gap: 12,
  },
  videoFooter: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    height: 56, flexDirection: "row",
    alignItems: "center", paddingHorizontal: 14, gap: 8,
  },
  footerBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  backBtn: { marginTop: 2 },
  headerCenter: { flex: 1 },
  headerTitle: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  headerEp: { color: "rgba(255,255,255,0.65)", fontSize: 12, fontFamily: "Inter_400Regular" },

  fullscreenContainer: {
    flex: 1, backgroundColor: "#000",
    alignItems: "center", justifyContent: "center",
  },
  fullscreenVideo: {
    width: "100%", height: "100%",
    position: "relative",
  },

  resumeBar: {
    flexDirection: "row", alignItems: "center", gap: 10,
    marginHorizontal: 16, marginTop: 10, marginBottom: 2,
    backgroundColor: "rgba(13,148,136,0.12)",
    borderWidth: 1, borderColor: "rgba(13,148,136,0.3)",
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
  },
  resumeText: { flex: 1, color: "#f0f4f8", fontSize: 13, fontFamily: "Inter_400Regular" },

  epSection: { flex: 1 },
  epHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  epTitle: { color: "#f0f4f8", fontSize: 16, fontFamily: "Inter_700Bold" },
  epCount: { color: "#8b949e", fontSize: 13, fontFamily: "Inter_400Regular" },
  epGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12, gap: 8 },
  epBtn: {
    width: (SCREEN_W - 24 - 32) / 5,
    aspectRatio: 1, borderRadius: 10, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  epBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  epEmpty: { alignItems: "center", paddingTop: 40, gap: 12 },
  epEmptyText: { color: "#8b949e", fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
});
