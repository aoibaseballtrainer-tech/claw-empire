import { describe, expect, it } from "vitest";
import type { Agent, Department } from "../types";
import { resolvePackAgentViews, resolvePackDepartmentsForDisplay } from "./office-pack-display";

function makeAgent(input: Partial<Agent> & { id: string; name: string; name_ko: string }): Agent {
  return {
    id: input.id,
    name: input.name,
    name_ko: input.name_ko,
    name_ja: input.name_ja ?? input.name,
    name_zh: input.name_zh ?? input.name,
    department_id: input.department_id ?? "planning",
    role: input.role ?? "senior",
    cli_provider: input.cli_provider ?? "codex",
    avatar_emoji: input.avatar_emoji ?? "🤖",
    sprite_number: input.sprite_number ?? null,
    personality: input.personality ?? null,
    status: input.status ?? "idle",
    current_task_id: input.current_task_id ?? null,
    stats_tasks_done: input.stats_tasks_done ?? 0,
    stats_xp: input.stats_xp ?? 0,
    created_at: input.created_at ?? 1,
  };
}

function makeDepartment(input: Partial<Department> & { id: string; name: string; name_ko: string }): Department {
  return {
    id: input.id,
    name: input.name,
    name_ko: input.name_ko,
    name_ja: input.name_ja ?? input.name,
    name_zh: input.name_zh ?? input.name,
    icon: input.icon ?? "🏢",
    color: input.color ?? "#64748b",
    description: input.description ?? null,
    prompt: input.prompt ?? null,
    sort_order: input.sort_order ?? 1,
    created_at: input.created_at ?? 1,
  };
}

describe("office pack display helpers", () => {
  it("DB 에이전트를 우선 사용하고 pack 에이전트는 fallback 으로만 사용한다", () => {
    const globalAgent = makeAgent({
      id: "report-seed-1",
      name: "Global Name",
      name_ko: "글로벌",
      avatar_emoji: "🧠",
      sprite_number: 3,
      status: "working",
      current_task_id: "task-1",
      stats_tasks_done: 7,
      stats_xp: 80,
      created_at: 10,
    });
    const packAgent = makeAgent({
      id: "report-seed-1",
      name: "Pack Name",
      name_ko: "팩",
      avatar_emoji: "📚",
      sprite_number: 11,
      status: "idle",
      current_task_id: null,
      stats_tasks_done: 0,
      stats_xp: 0,
      created_at: 999,
    });

    const { scopedAgents, mergedAgents } = resolvePackAgentViews({
      packKey: "report",
      globalAgents: [globalAgent],
      packAgents: [packAgent],
    });

    expect(scopedAgents[0]?.name).toBe("Global Name");
    expect(scopedAgents[0]?.avatar_emoji).toBe("🧠");
    expect(scopedAgents[0]?.sprite_number).toBe(3);
    expect(scopedAgents[0]?.status).toBe("working");
    expect(scopedAgents[0]?.current_task_id).toBe("task-1");
    expect(scopedAgents[0]?.stats_tasks_done).toBe(7);
    expect(scopedAgents[0]?.stats_xp).toBe(80);
    expect(mergedAgents).toHaveLength(1);
  });

  it("팩 부서명을 우선 사용하고 DB 메타데이터는 fallback 으로 병합한다", () => {
    const globalDepartments: Department[] = [
      makeDepartment({ id: "planning", name: "Planning", name_ko: "기획팀", icon: "🧠", created_at: 77 }),
      makeDepartment({ id: "operations", name: "Operations", name_ko: "운영팀", icon: "📦" }),
    ];
    const packDepartments: Department[] = [
      makeDepartment({ id: "planning", name: "Editorial Planning", name_ko: "편집기획실", icon: "📚" }),
    ];

    const output = resolvePackDepartmentsForDisplay({
      packKey: "report",
      globalDepartments,
      packDepartments,
    });

    expect(output[0]?.id).toBe("planning");
    expect(output[0]?.name_ko).toBe("편집기획실");
    expect(output[0]?.icon).toBe("📚");
    expect(output[0]?.created_at).toBe(1);
    expect(output.some((dept) => dept.id === "operations")).toBe(true);
  });

  it("비개발 팩에서는 다른 팩 seed 에이전트를 merged 목록에서 숨긴다", () => {
    const currentPackAgent = makeAgent({
      id: "novel-seed-1",
      name: "Novel Seed",
      name_ko: "노벨 시드",
    });
    const foreignPackAgent = makeAgent({
      id: "report-seed-1",
      name: "Report Seed",
      name_ko: "리포트 시드",
    });
    const nonSeedGlobal = makeAgent({
      id: "dev-leader",
      name: "Dev Leader",
      name_ko: "개발 리더",
    });

    const { mergedAgents } = resolvePackAgentViews({
      packKey: "novel",
      globalAgents: [currentPackAgent, foreignPackAgent, nonSeedGlobal],
      packAgents: [currentPackAgent],
    });

    expect(mergedAgents.some((agent) => agent.id === "novel-seed-1")).toBe(true);
    expect(mergedAgents.some((agent) => agent.id === "report-seed-1")).toBe(false);
    expect(mergedAgents.some((agent) => agent.id === "dev-leader")).toBe(true);
  });
});
