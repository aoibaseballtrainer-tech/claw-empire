import { request, post, del } from "./core";

export interface ThreadsPost {
  id: number;
  account_id: string;
  text: string;
  scheduled_at: number | null;
  status: "pending" | "publishing" | "published" | "failed";
  threads_post_id: string | null;
  error: string | null;
  created_at: number;
  published_at: number | null;
}

export interface ThreadsAccountInfo {
  id: string;
  user_id: string;
  username: string;
  label: string;
  status: "active" | "inactive";
  created_at: number;
  updated_at: number;
}

// Legacy compat
export interface ThreadsAccount {
  ok: boolean;
  user_id?: string;
  configured?: boolean;
  error?: string;
}

export async function getThreadsAccount(): Promise<ThreadsAccount> {
  return request<ThreadsAccount>("/api/threads/account");
}

export async function getThreadsAccounts(): Promise<ThreadsAccountInfo[]> {
  const res = await request<{ ok: boolean; accounts: ThreadsAccountInfo[] }>("/api/threads/accounts");
  return res.accounts;
}

export async function addThreadsAccount(accessToken: string, label: string): Promise<{ ok: boolean; id?: string; user_id?: string; username?: string; error?: string }> {
  return post<{ ok: boolean; id?: string; user_id?: string; username?: string; error?: string }>("/api/threads/accounts", {
    access_token: accessToken,
    label,
  });
}

export async function updateThreadsAccount(id: string, data: { label?: string; status?: string }): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/threads/accounts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(data),
  });
  return res.json() as Promise<{ ok: boolean }>;
}

export async function deleteThreadsAccount(id: string): Promise<void> {
  await del(`/api/threads/accounts/${id}`);
}

export async function getThreadsPosts(accountId?: string): Promise<ThreadsPost[]> {
  const url = accountId ? `/api/threads/posts?account_id=${accountId}` : "/api/threads/posts";
  const res = await request<{ ok: boolean; posts: ThreadsPost[] }>(url);
  return res.posts;
}

export async function createThreadsPost(text: string, accountId: string, scheduledAt?: number): Promise<{ ok: boolean; id: number }> {
  return post<{ ok: boolean; id: number }>("/api/threads/posts", {
    text,
    account_id: accountId,
    scheduled_at: scheduledAt ?? null,
  });
}

export async function publishThreadsPostNow(text: string, accountId: string): Promise<{ ok: boolean; threads_post_id?: string; error?: string }> {
  return post<{ ok: boolean; threads_post_id?: string; error?: string }>("/api/threads/posts/now", { text, account_id: accountId });
}

export async function deleteThreadsPost(id: number): Promise<void> {
  await del(`/api/threads/posts/${id}`);
}

export async function retryThreadsPost(id: number): Promise<void> {
  await post(`/api/threads/posts/${id}/retry`, {});
}

export interface ThreadsInsight {
  id: number;
  post_id: number;
  interval_minutes: number;
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  fetched_at: number;
}

export async function getThreadsPostInsights(postId: number): Promise<ThreadsInsight[]> {
  const res = await request<{ ok: boolean; insights: ThreadsInsight[] }>(`/api/threads/posts/${postId}/insights`);
  return res.insights;
}

export async function getAllThreadsInsights(accountId?: string): Promise<Record<number, ThreadsInsight[]>> {
  const url = accountId ? `/api/threads/insights?account_id=${accountId}` : "/api/threads/insights";
  const res = await request<{ ok: boolean; insights: Record<number, ThreadsInsight[]> }>(url);
  return res.insights;
}
