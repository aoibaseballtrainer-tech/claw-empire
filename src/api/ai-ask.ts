import { post } from "./core";

// --- Structured section types ---
export interface SectionItemMetric {
  label: string;
  value: string;
}

export interface SectionItem {
  text: string;
  sub?: string;
  date?: string;
  badge?: string;
  badgeColor?: string;
  metrics?: SectionItemMetric[];
}

export interface SectionGroup {
  title: string;
  items: SectionItem[];
}

export interface DataSection {
  key: string;
  label: string;
  icon: string;
  stats?: { label: string; value: string }[];
  groups?: SectionGroup[];
}

// --- API response ---
export interface AiAskResponse {
  ok: boolean;
  answer: string;
  sources?: string[];
  sections?: DataSection[];
  error?: string;
}

export async function askAi(question: string): Promise<AiAskResponse> {
  return post<AiAskResponse>("/api/ai-ask", { question });
}
