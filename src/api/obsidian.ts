import { request, post } from "./core";

export interface ObsidianStatus {
  ok: boolean;
  url?: string;
  vault_prefix?: string;
  error?: string;
}

export async function getObsidianStatus(): Promise<ObsidianStatus> {
  return request<ObsidianStatus>("/api/obsidian/status");
}

export async function saveTaskResultToObsidian(taskId: string): Promise<{ ok: boolean }> {
  return post<{ ok: boolean }>(`/api/obsidian/save-task-result/${taskId}`, {});
}

export async function generateWeeklyReport(): Promise<{ ok: boolean; report_length?: number }> {
  return post<{ ok: boolean; report_length?: number }>("/api/obsidian/weekly-report", {});
}

export async function readObsidianFile(path: string): Promise<{ ok: boolean; content?: string }> {
  return request<{ ok: boolean; content?: string }>(`/api/obsidian/vault/${encodeURIComponent(path)}`);
}
