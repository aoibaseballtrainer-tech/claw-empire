import type { Lang } from "../../../types/lang.ts";
import type { AgentRow } from "./direct-chat.ts";
import type { L10n } from "./language-policy.ts";
import type { SubtaskRow } from "./subtask-summary.ts";

type ParentTaskRow = {
  id: string;
  title: string;
  description: string | null;
  project_id: string | null;
  project_path: string | null;
};

interface PromptDeps {
  db: any;
  l: (ko: string[], en: string[], ja?: string[], zh?: string[]) => L10n;
  pickL: (pool: L10n, lang: Lang) => string;
  resolveLang: (text?: string, fallback?: Lang) => Lang;
  getDeptName: (deptId: string) => string;
  getDeptRoleConstraint: (deptId: string, deptName: string) => string;
  getRecentConversationContext: (agentId: string, limit?: number) => string;
  getAgentDisplayName: (agent: AgentRow, lang: string) => string;
  buildTaskExecutionPrompt: (parts: string[], opts?: { allowWarningFix?: boolean }) => string;
  hasExplicitWarningFixRequest: (...textParts: Array<string | null | undefined>) => boolean;
}

export function createSubtaskDelegationPromptBuilder(deps: PromptDeps) {
  const {
    db,
    l,
    pickL,
    resolveLang,
    getDeptName,
    getDeptRoleConstraint,
    getRecentConversationContext,
    getAgentDisplayName,
    buildTaskExecutionPrompt,
    hasExplicitWarningFixRequest,
  } = deps;

  function buildSubtaskDelegationPrompt(
    parentTask: ParentTaskRow,
    assignedSubtasks: SubtaskRow[],
    execAgent: AgentRow,
    targetDeptId: string,
    targetDeptName: string,
  ): string {
    const lang = resolveLang(parentTask.description ?? parentTask.title);
    const assignedIds = new Set(assignedSubtasks.map((st) => st.id));
    const orderedChecklist = assignedSubtasks
      .map((st, idx) => {
        const detail = st.description ? ` - ${st.description}` : "";
        return `${idx + 1}. ${st.title}${detail}`;
      })
      .join("\n");

    const allSubtasks = db
      .prepare("SELECT id, title, status, target_department_id, delegated_task_id FROM subtasks WHERE task_id = ? ORDER BY created_at")
      .all(parentTask.id) as Array<{ id: string; title: string; status: string; target_department_id: string | null; delegated_task_id: string | null }>;

    const statusIcon: Record<string, string> = {
      done: "✅",
      in_progress: "🔨",
      pending: "⏳",
      blocked: "🔒",
    };

    const parentDept = db.prepare("SELECT department_id FROM tasks WHERE id = ?").get(parentTask.id) as
      | { department_id: string | null }
      | undefined;

    const subtaskLines = allSubtasks
      .map((st) => {
        const icon = statusIcon[st.status] || "⏳";
        const dept = st.target_department_id
          ? getDeptName(st.target_department_id)
          : getDeptName(parentDept?.department_id ?? "");
        const marker = assignedIds.has(st.id)
          ? pickL(l([" ← 당신의 담당"], [" <- assigned to you"], [" ← あなたの担당"], [" <- 你的负责项"]), lang)
          : "";
        return `${icon} ${st.title} (${dept} - ${st.status})${marker}`;
      })
      .join("\n");

    // Collect completed sibling subtask artifacts so downstream teams can reference prior work
    const completedSiblings = allSubtasks.filter(
      (st) => st.status === "done" && !assignedIds.has(st.id),
    );
    let completedArtifactsBlock = "";
    if (completedSiblings.length > 0) {
      const artifactSections: string[] = [];
      for (const sibling of completedSiblings) {
        const deptName = sibling.target_department_id
          ? getDeptName(sibling.target_department_id)
          : getDeptName(parentDept?.department_id ?? "");

        if (sibling.delegated_task_id) {
          // Delegated subtask — collect logs from delegated task
          const recentLogs = db
            .prepare(
              "SELECT message FROM task_logs WHERE task_id = ? AND kind = 'system' ORDER BY created_at DESC LIMIT 10",
            )
            .all(sibling.delegated_task_id) as Array<{ message: string }>;
          const logSummary = recentLogs
            .map((row) => row.message)
            .filter((m) => m && !m.startsWith("RUN ") && !m.startsWith("Status →"))
            .slice(0, 5)
            .reverse()
            .join("\n  ");
          const delegatedTask = db
            .prepare("SELECT title, description, project_path FROM tasks WHERE id = ?")
            .get(sibling.delegated_task_id) as { title: string; description: string | null; project_path: string | null } | undefined;
          const desc = delegatedTask?.description
            ? delegatedTask.description.split("\n").slice(0, 15).join("\n  ")
            : "";
          artifactSections.push(
            `[${deptName}] ${sibling.title} (DONE)` +
            (desc ? `\n  ${desc}` : "") +
            (logSummary ? `\n  ---\n  ${logSummary}` : ""),
          );
        } else {
          // Own-department subtask — completed by parent team directly (planning/documentation)
          const siblingRow = db
            .prepare("SELECT description FROM subtasks WHERE id = ?")
            .get(sibling.id) as { description: string | null } | undefined;
          const desc = siblingRow?.description
            ? siblingRow.description.split("\n").slice(0, 10).join("\n  ")
            : "";
          artifactSections.push(
            `[${deptName}] ${sibling.title} (DONE — completed by origin team)` +
            (desc ? `\n  ${desc}` : ""),
          );
        }
      }

      // Also include parent task's recent meaningful logs as origin team context
      const parentLogs = db
        .prepare(
          "SELECT message FROM task_logs WHERE task_id = ? AND kind = 'system' ORDER BY created_at DESC LIMIT 15",
        )
        .all(parentTask.id) as Array<{ message: string }>;
      const parentLogSummary = parentLogs
        .map((row) => row.message)
        .filter((m) => m && !m.startsWith("RUN ") && !m.startsWith("Status →") && !m.startsWith("Subtask delegation"))
        .slice(0, 5)
        .reverse()
        .join("\n  ");
      if (parentLogSummary) {
        const originDeptName = getDeptName(parentDept?.department_id ?? "");
        artifactSections.unshift(
          `[${originDeptName}] ${parentTask.title} (origin task summary)\n  ${parentLogSummary}`,
        );
      }

      const completedLabel = pickL(
        l(
          ["[모체 팀 및 이전 팀 완료 산출물 — 반드시 참고하여 작업하세요]"],
          ["[Completed artifacts from origin & prior teams — use these as reference for your work]"],
          ["[元チーム及び先行チーム完了成果物 — 必ず参照して作業してください]"],
          ["[主体团队及前序团队已完成产出物 — 请务必参考进行工作]"],
        ),
        lang,
      );
      completedArtifactsBlock = `${completedLabel}\n${artifactSections.join("\n\n")}`;
    }

    const roleLabel =
      { team_leader: "Team Leader", senior: "Senior", junior: "Junior", intern: "Intern" }[execAgent.role] ||
      execAgent.role;
    const deptConstraint = getDeptRoleConstraint(targetDeptId, targetDeptName);
    const deptPromptRaw = (
      db.prepare("SELECT prompt FROM departments WHERE id = ?").get(targetDeptId) as
        | { prompt?: string | null }
        | undefined
    )?.prompt;
    const deptPrompt = typeof deptPromptRaw === "string" ? deptPromptRaw.trim() : "";
    const deptPromptBlock = deptPrompt ? `[Department Shared Prompt]\n${deptPrompt}` : "";
    const conversationCtx = getRecentConversationContext(execAgent.id);
    const agentDisplayName = getAgentDisplayName(execAgent, lang);
    const header = pickL(
      l(
        [`[프로젝트 협업 업무 - ${targetDeptName}]`],
        [`[Project collaboration task - ${targetDeptName}]`],
        [`[プロジェクト協業タスク - ${targetDeptName}]`],
        [`[项目协作任务 - ${targetDeptName}]`],
      ),
      lang,
    );
    const originalTaskLabel = pickL(l(["원본 업무"], ["Original task"], ["元タスク"], ["原始任务"]), lang);
    const ceoRequestLabel = pickL(l(["CEO 요청"], ["CEO request"], ["CEO依頼"], ["CEO指示"]), lang);
    const allSubtasksLabel = pickL(
      l(["전체 서브태스크 현황"], ["All subtask status"], ["全サブタスク状況"], ["全部 SubTask 状态"]),
      lang,
    );
    const deptOwnedLabel = pickL(
      l(
        [`[${targetDeptName} 담당 업무 묶음]`],
        [`[${targetDeptName} owned batch]`],
        [`[${targetDeptName}担当タスク一式]`],
        [`[${targetDeptName}负责项集合]`],
      ),
      lang,
    );
    const checklistLabel = pickL(
      l(["순차 실행 체크리스트"], ["Sequential execution checklist"], ["順次実行チェックリスト"], ["顺序执行清单"]),
      lang,
    );
    const finalInstruction = pickL(
      l(
        [
          "위 순차 체크리스트를 1번부터 끝까지 순서대로 처리하고, 중간에 분할하지 말고 한 번의 작업 흐름으로 완료하세요.",
        ],
        [
          "Execute the checklist in order from 1 to end, and finish it in one continuous run without splitting into separate requests.",
        ],
        ["上記チェックリストを1番から順番に実行し、分割せず1回の作業フローで完了してください。"],
        ["请按 1 到末尾顺序执行清单，不要拆分为多次请求，在一次连续流程中完成。"],
      ),
      lang,
    );

    return buildTaskExecutionPrompt(
      [
        header,
        ``,
        `${originalTaskLabel}: ${parentTask.title}`,
        parentTask.description ? `${ceoRequestLabel}: ${parentTask.description}` : "",
        ``,
        `[${allSubtasksLabel}]`,
        subtaskLines,
        completedArtifactsBlock ? `\n${completedArtifactsBlock}` : "",
        ``,
        deptOwnedLabel,
        `${checklistLabel}:`,
        orderedChecklist,
        conversationCtx ? `\n${conversationCtx}` : "",
        ``,
        `---`,
        `Agent: ${agentDisplayName} (${roleLabel}, ${targetDeptName})`,
        execAgent.personality ? `Personality: ${execAgent.personality}` : "",
        deptConstraint,
        deptPromptBlock,
        ``,
        finalInstruction,
      ],
      {
        allowWarningFix: hasExplicitWarningFixRequest(
          parentTask.title,
          parentTask.description,
          assignedSubtasks.map((st) => st.title).join(" / "),
          assignedSubtasks
            .map((st) => st.description)
            .filter((v): v is string => !!v)
            .join(" / "),
        ),
      },
    );
  }

  return { buildSubtaskDelegationPrompt };
}
