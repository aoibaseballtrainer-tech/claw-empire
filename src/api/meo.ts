import { request, post, patch, del } from "./core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface MeoLead {
  id: string;
  google_place_id: string | null;
  business_name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  google_maps_url: string | null;
  rating: number | null;
  review_count: number;
  business_type: string;
  reviews_json: string | null;
  stage: "prospect" | "researched" | "contacted" | "meeting" | "negotiating" | "won" | "lost";
  stage_changed_at: number;
  meo_score: number | null;
  meo_issues_json: string | null;
  priority: number;
  notes: string | null;
  search_area: string | null;
  created_at: number;
  updated_at: number;
}

export interface MeoActivity {
  id: number;
  lead_id: string;
  activity_type: string;
  subject: string | null;
  content: string | null;
  performed_by: string;
  created_at: number;
}

export interface MeoEmail {
  id: number;
  lead_id: string;
  email_type: string;
  subject: string;
  body: string;
  status: "draft" | "approved" | "sent";
  generated_by: string;
  created_at: number;
  business_name?: string;
  scheduled_at: number | null;
  send_to: string | null;
}

export interface PlaceSearchResult {
  place_id: string;
  name: string;
  address: string;
  phone: string;
  website: string;
  google_maps_url: string;
  rating: number | null;
  review_count: number;
  photo_count: number;
  already_imported: boolean;
}

export interface MeoPipelineStats {
  by_stage: Record<string, number>;
  by_area: Record<string, number>;
  total_leads: number;
  won_this_month: number;
  contacted_this_week: number;
  conversion_rate: number;
  pending_follow_ups: number;
}

// ---------------------------------------------------------------------------
// Search & Import
// ---------------------------------------------------------------------------
export async function searchPlaces(
  query: string,
  area?: string,
  maxResults?: number,
): Promise<{ results: PlaceSearchResult[]; total: number; query: string }> {
  const res = await post<{
    ok: boolean;
    results: PlaceSearchResult[];
    total: number;
    query: string;
    error?: string;
  }>("/api/meo/search", { query, area, max_results: maxResults });
  return { results: res.results || [], total: res.total || 0, query: res.query || query };
}

export async function importLeads(
  placeIds: string[],
  area?: string,
): Promise<{ imported: number; skipped: number; leads: MeoLead[] }> {
  const res = await post<{
    ok: boolean;
    imported: number;
    skipped: number;
    leads: MeoLead[];
  }>("/api/meo/import", { place_ids: placeIds, area });
  return { imported: res.imported, skipped: res.skipped, leads: res.leads };
}

// ---------------------------------------------------------------------------
// Lead CRUD
// ---------------------------------------------------------------------------
export async function getMeoLeads(params?: {
  stage?: string;
  area?: string;
}): Promise<MeoLead[]> {
  const qs = new URLSearchParams();
  if (params?.stage) qs.set("stage", params.stage);
  if (params?.area) qs.set("area", params.area);
  const url = `/api/meo/leads${qs.toString() ? "?" + qs : ""}`;
  const res = await request<{ ok: boolean; leads: MeoLead[] }>(url);
  return res.leads;
}

export async function getMeoLead(id: string): Promise<{
  lead: MeoLead;
  activities: MeoActivity[];
  emails: MeoEmail[];
}> {
  return request<{ ok: boolean; lead: MeoLead; activities: MeoActivity[]; emails: MeoEmail[] }>(
    `/api/meo/leads/${id}`,
  );
}

export async function updateMeoLead(
  id: string,
  data: Partial<MeoLead>,
): Promise<void> {
  await patch(`/api/meo/leads/${id}`, data);
}

export async function deleteMeoLead(id: string): Promise<void> {
  await del(`/api/meo/leads/${id}`);
}

// ---------------------------------------------------------------------------
// Pipeline Stats
// ---------------------------------------------------------------------------
export async function getMeoPipelineStats(): Promise<MeoPipelineStats> {
  const res = await request<{ ok: boolean; stats: MeoPipelineStats }>("/api/meo/stats");
  return res.stats;
}

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------
export async function addLeadActivity(
  leadId: string,
  data: { activity_type: string; subject?: string; content?: string },
): Promise<{ id: number }> {
  return post<{ ok: boolean; id: number }>(`/api/meo/leads/${leadId}/activities`, data);
}

// ---------------------------------------------------------------------------
// MEO Analysis
// ---------------------------------------------------------------------------
export async function analyzeLead(id: string): Promise<{
  score: number;
  issues: string[];
  lead: MeoLead;
}> {
  return post<{ ok: boolean; score: number; issues: string[]; lead: MeoLead }>(
    `/api/meo/leads/${id}/analyze`,
  );
}

// ---------------------------------------------------------------------------
// Email Generation & Management
// ---------------------------------------------------------------------------
export async function generateSalesEmail(
  leadId: string,
  emailType?: string,
): Promise<MeoEmail> {
  const res = await post<{ ok: boolean; email: MeoEmail; error?: string }>(
    `/api/meo/leads/${leadId}/generate-email`,
    { email_type: emailType || "initial" },
  );
  if (!res.email) throw new Error(res.error || "Failed to generate email");
  return res.email;
}

export async function getMeoEmails(params?: {
  lead_id?: string;
  status?: string;
}): Promise<MeoEmail[]> {
  const qs = new URLSearchParams();
  if (params?.lead_id) qs.set("lead_id", params.lead_id);
  if (params?.status) qs.set("status", params.status);
  const url = `/api/meo/emails${qs.toString() ? "?" + qs : ""}`;
  const res = await request<{ ok: boolean; emails: MeoEmail[] }>(url);
  return res.emails;
}

export async function updateMeoEmail(
  id: number,
  data: Partial<MeoEmail>,
): Promise<void> {
  await patch(`/api/meo/emails/${id}`, data);
}

export async function deleteMeoEmail(id: number): Promise<void> {
  await del(`/api/meo/emails/${id}`);
}

export async function scheduleMeoEmail(
  id: number,
  to: string,
  scheduledAt: number,
): Promise<void> {
  await patch(`/api/meo/emails/${id}`, {
    send_to: to,
    scheduled_at: scheduledAt,
    status: "approved",
  });
}

export async function cancelScheduledEmail(id: number): Promise<void> {
  await patch(`/api/meo/emails/${id}`, {
    scheduled_at: null,
    send_to: null,
  });
}

export async function getScheduledEmails(): Promise<MeoEmail[]> {
  const res = await request<{ ok: boolean; emails: MeoEmail[] }>("/api/meo/emails/scheduled");
  return res.emails;
}

// ---------------------------------------------------------------------------
// Gmail Integration
// ---------------------------------------------------------------------------
export interface GmailStatus {
  connected: boolean;
  email: string | null;
}

export async function getGmailStatus(): Promise<GmailStatus> {
  return request<GmailStatus>("/api/meo/gmail/status");
}

export function startGmailOAuth(): void {
  window.open("/api/meo/gmail/start", "_blank", "width=600,height=700");
}

export async function disconnectGmail(): Promise<void> {
  await post("/api/meo/gmail/disconnect");
}

export async function sendMeoEmail(
  emailId: number,
  to: string,
): Promise<{ message_id: string }> {
  return post<{ ok: boolean; message_id: string }>(
    `/api/meo/emails/${emailId}/send`,
    { to },
  );
}

// ---------------------------------------------------------------------------
// Gmail Inbox (Received emails)
// ---------------------------------------------------------------------------
export interface ReceivedEmail {
  id: number;
  gmail_id: string;
  thread_id: string | null;
  lead_id: string | null;
  from_email: string | null;
  from_name: string | null;
  to_email: string | null;
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  received_at: number;
  is_reply: number;
  is_read: number;
  created_at: number;
}

export interface InboxStats {
  total: number;
  unread: number;
  replies: number;
  matched: number;
  today: number;
}

export async function getInboxStats(): Promise<InboxStats> {
  return request<InboxStats>("/api/meo/inbox/stats");
}

export async function getInboxEmails(params?: {
  limit?: number;
  offset?: number;
  unread?: boolean;
  lead_id?: string;
}): Promise<{ emails: ReceivedEmail[]; total: number; unread: number }> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.offset) qs.set("offset", String(params.offset));
  if (params?.unread) qs.set("unread", "true");
  if (params?.lead_id) qs.set("lead_id", params.lead_id);
  const url = `/api/meo/inbox${qs.toString() ? "?" + qs : ""}`;
  return request<{ ok: boolean; emails: ReceivedEmail[]; total: number; unread: number }>(url);
}

export async function getInboxEmail(id: number): Promise<ReceivedEmail> {
  const res = await request<{ ok: boolean; email: ReceivedEmail }>(`/api/meo/inbox/${id}`);
  return res.email;
}

export async function syncInbox(): Promise<void> {
  await post("/api/meo/inbox/sync");
}
