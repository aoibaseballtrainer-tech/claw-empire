import { request, post, put, del, patch } from "./core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CmsSection {
  id: string;
  page_id: string;
  section_type: string;
  sort_order: number;
  title: string | null;
  subtitle: string | null;
  body: string | null;
  image_url: string | null;
  metadata_json: string | null;
  is_published: number;
  created_at: number;
  updated_at: number;
}

export interface CmsPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  body: string;
  cover_image_url: string | null;
  author_name: string | null;
  status: "draft" | "published";
  published_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface CmsImage {
  id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  alt_text: string | null;
  created_at: number;
}

export interface CmsPageInfo {
  page_id: string;
  section_count: number;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export function getSections(pageId?: string): Promise<CmsSection[]> {
  const qs = pageId ? `?page_id=${encodeURIComponent(pageId)}` : "";
  return request<CmsSection[]>(`/api/cms/sections${qs}`);
}

export function getSection(id: string): Promise<CmsSection> {
  return request<CmsSection>(`/api/cms/sections/${id}`);
}

export function createSection(data: Partial<CmsSection> & { metadata_json?: unknown }): Promise<CmsSection> {
  return post<CmsSection>("/api/cms/sections", data);
}

export function updateSection(id: string, data: Partial<CmsSection> & { metadata_json?: unknown }): Promise<CmsSection> {
  return put<CmsSection>(`/api/cms/sections/${id}`, data);
}

export function deleteSection(id: string): Promise<{ ok: boolean }> {
  return del<{ ok: boolean }>(`/api/cms/sections/${id}`);
}

export function reorderSections(pageId: string, ids: string[]): Promise<{ ok: boolean }> {
  return patch<{ ok: boolean }>("/api/cms/sections/reorder", { page_id: pageId, ids });
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

export function getPosts(): Promise<CmsPost[]> {
  return request<CmsPost[]>("/api/cms/posts");
}

export function getPost(id: string): Promise<CmsPost> {
  return request<CmsPost>(`/api/cms/posts/${id}`);
}

export function createPost(data: Partial<CmsPost>): Promise<CmsPost> {
  return post<CmsPost>("/api/cms/posts", data);
}

export function updatePost(id: string, data: Partial<CmsPost>): Promise<CmsPost> {
  return put<CmsPost>(`/api/cms/posts/${id}`, data);
}

export function deletePost(id: string): Promise<{ ok: boolean }> {
  return del<{ ok: boolean }>(`/api/cms/posts/${id}`);
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export function getImages(): Promise<CmsImage[]> {
  return request<CmsImage[]>("/api/cms/images");
}

export function uploadImage(data: string, filename: string, altText?: string): Promise<CmsImage> {
  return post<CmsImage>("/api/cms/images", { data, filename, alt_text: altText });
}

export function deleteImage(id: string): Promise<{ ok: boolean }> {
  return del<{ ok: boolean }>(`/api/cms/images/${id}`);
}

// ---------------------------------------------------------------------------
// Site Settings
// ---------------------------------------------------------------------------

export function getSiteSettings(): Promise<Record<string, string>> {
  return request<Record<string, string>>("/api/cms/site-settings");
}

export function saveSiteSettings(settings: Record<string, string>): Promise<{ ok: boolean }> {
  return put<{ ok: boolean }>("/api/cms/site-settings", settings);
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export function getPages(): Promise<CmsPageInfo[]> {
  return request<CmsPageInfo[]>("/api/cms/pages");
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export interface CmsAnalytics {
  totalViews: number;
  totalPosts: number;
  publishedPosts: number;
  topArticles: Array<{ id: string; title: string; slug: string; view_count: number; published_at: number | null }>;
  dailyViews: Array<{ date: string; views: number; unique_views: number }>;
  autoGen: { today: number; total: number; errorsToday: number; dailyTarget: number };
}

export interface AutoGenStatus {
  dailyTarget: number;
  todayGenerated: number;
  todayErrors: number;
  totalGenerated: number;
  schedulerActive: boolean;
}

export interface AutoGenLogEntry {
  id: number;
  post_id: string | null;
  topic_category: string | null;
  keywords_json: string | null;
  char_count: number | null;
  model: string | null;
  status: string;
  error_message: string | null;
  generation_time_ms: number | null;
  created_at: number;
  post_title: string | null;
  post_slug: string | null;
}

export function getAnalytics(days = 30): Promise<CmsAnalytics> {
  return request<CmsAnalytics>(`/api/cms/analytics?days=${days}`);
}

export function getAutoGenStatus(): Promise<AutoGenStatus> {
  return request<AutoGenStatus>("/api/cms/autogen/status");
}

export function triggerAutoGen(): Promise<{ ok: boolean; post: { id: string; title: string; slug: string; charCount: number } }> {
  return post("/api/cms/autogen/trigger", {});
}

export function getAutoGenLog(): Promise<AutoGenLogEntry[]> {
  return request<AutoGenLogEntry[]>("/api/cms/autogen/log");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function imageUrl(filename: string): string {
  return `/cms-uploads/${filename}`;
}

export function thumbUrl(filename: string): string {
  return `/cms-uploads/${filename.replace(".webp", "-thumb.webp")}`;
}
