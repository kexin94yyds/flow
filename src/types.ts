export interface Card {
  id: string;
  url: string;
  title: string;
  description?: string;
  favicon?: string;
  screenshot?: string;
  createdAt: number;
  tags?: string[];
}

export interface CardInput {
  url: string;
  title: string;
  description?: string;
  favicon?: string;
  tags?: string[];
}
