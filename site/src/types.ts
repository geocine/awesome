export interface StarList {
  name: string;
  slug: string;
  description: string;
  count: number;
}

/** A starred repo, or an archive entry (previously starred repo, book or site). */
export interface Repo {
  name: string;
  url: string;
  description: string | null;
  homepage: string | null;
  /** null for archive entries that are not GitHub repos */
  stars: number | null;
  forks: number | null;
  language: string | null;
  languageColor: string | null;
  topics: string[];
  /** archived by its owner on GitHub (read-only) */
  archived: boolean;
  pushedAt: string | null;
  /** null for archive entries */
  starredAt: string | null;
  avatar: string | null;
  lists: string[];
  source: 'starred' | 'archive';
}

export interface StarsData {
  user: string;
  generatedAt: string;
  lists: StarList[];
  stars: Repo[];
  archive?: Repo[];
}

export type SortKey = 'starred' | 'stars' | 'updated' | 'name';
export type Collection = 'all' | 'starred' | 'archive';
