import AsyncStorage from "@react-native-async-storage/async-storage";

export interface WatchProgress {
  epIndex: number;
  time: number;
  duration: number;
  updatedAt: number;
}

export async function getFavorites(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem("favorites");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function toggleFavorite(bookId: string): Promise<boolean> {
  const favs = await getFavorites();
  const idx = favs.indexOf(bookId);
  if (idx === -1) {
    favs.push(bookId);
    await AsyncStorage.setItem("favorites", JSON.stringify(favs));
    return true;
  } else {
    favs.splice(idx, 1);
    await AsyncStorage.setItem("favorites", JSON.stringify(favs));
    return false;
  }
}

export async function isFavorite(bookId: string): Promise<boolean> {
  const favs = await getFavorites();
  return favs.includes(bookId);
}

export async function getProgress(bookId: string): Promise<WatchProgress | null> {
  try {
    const raw = await AsyncStorage.getItem(`progress_${bookId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveProgress(
  bookId: string,
  epIndex: number,
  time: number,
  duration: number
): Promise<void> {
  const data: WatchProgress = { epIndex, time, duration, updatedAt: Date.now() };
  await AsyncStorage.setItem(`progress_${bookId}`, JSON.stringify(data));
}

export async function clearProgress(bookId: string): Promise<void> {
  await AsyncStorage.removeItem(`progress_${bookId}`);
}
