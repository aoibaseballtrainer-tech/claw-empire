import { request, post, put, del } from "./core";

export interface DailyTask {
  id: string;
  name: string;
  description: string;
  task_type: string;
  prompt: string;
  schedule_hour: number;
  schedule_minute: number;
  repeat_count: number;
  interval_minutes: number;
  enabled: number;
  last_run_at: number | null;
  last_result: string | null;
  created_at: number;
  updated_at: number;
  metadata_json: string | null;
}

export interface DailyTaskLog {
  id: number;
  task_id: string;
  status: string;
  result_text: string | null;
  error_message: string | null;
  execution_time_ms: number;
  created_at: number;
}

export async function listDailyTasks(): Promise<DailyTask[]> {
  const res = await request<{ ok: boolean; tasks: DailyTask[] }>("/api/daily-tasks");
  return res.tasks;
}

export async function createDailyTask(data: Partial<DailyTask>): Promise<DailyTask> {
  const res = await post<{ ok: boolean; task: DailyTask }>("/api/daily-tasks", data);
  return res.task;
}

export async function updateDailyTask(id: string, data: Partial<DailyTask>): Promise<DailyTask> {
  const res = await put<{ ok: boolean; task: DailyTask }>(`/api/daily-tasks/${id}`, data);
  return res.task;
}

export async function deleteDailyTask(id: string): Promise<void> {
  await del(`/api/daily-tasks/${id}`);
}

export async function runDailyTask(id: string): Promise<DailyTaskLog | null> {
  const res = await post<{ ok: boolean; log: DailyTaskLog | null }>(`/api/daily-tasks/${id}/run`);
  return res.log;
}

export async function getDailyTaskLogs(id: string): Promise<DailyTaskLog[]> {
  const res = await request<{ ok: boolean; logs: DailyTaskLog[] }>(`/api/daily-tasks/${id}/logs`);
  return res.logs;
}
