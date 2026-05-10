export interface Drama {
  bookId: string;
  title: string;
  cover: string;
  totalEps: number;
  status: string;
  tags: string;
  lastScraped?: { seconds: number };
}

export interface EpisodeSource {
  quality: number;
  rawUrl: string;
}

export interface Episode {
  title: string;
  rawUrl: string;
  quality: number;
  sources: EpisodeSource[];
  thumbnailUrl: string;
  chapterIndex: number;
}
