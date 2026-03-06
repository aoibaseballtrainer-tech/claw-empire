type ChatMode = "chat" | "task" | "announcement" | "report" | "staff_chat";

type Tr = (ko: string, en: string, ja?: string, zh?: string) => string;

interface ChatModeHintProps {
  mode: ChatMode;
  isDirectiveMode: boolean;
  tr: Tr;
}

export default function ChatModeHint({ mode, isDirectiveMode, tr }: ChatModeHintProps) {
  if (mode === "chat" && !isDirectiveMode) return null;

  return (
    <div className="px-4 py-1 flex-shrink-0">
      {isDirectiveMode ? (
        <p className="text-xs text-red-400 font-medium">
          {tr(
            "업무지시 모드 — 기획팀이 자동으로 주관합니다",
            "Directive mode - Planning team auto-coordinates",
            "業務指示モード — 企画チームが自動的に主管します",
            "业务指示模式 — 企划组自动主管",
          )}
        </p>
      ) : (
        <>
          {mode === "task" && (
            <p className="text-xs text-blue-400">
              📋{" "}
              {tr(
                "업무 지시 모드 — 에이전트에게 작업을 할당합니다",
                "Task mode - assign work to the agent",
                "タスク指示モード — エージェントに作業を割り当てます",
                "任务指示模式 — 向代理分配工作",
              )}
            </p>
          )}
          {mode === "announcement" && (
            <p className="text-xs text-yellow-400">
              📢{" "}
              {tr(
                "전사 공지 모드 — 모든 에이전트에게 전달됩니다",
                "Announcement mode - sent to all agents",
                "全体告知モード — すべてのエージェントに送信",
                "全员公告模式 — 将发送给所有代理",
              )}
            </p>
          )}
          {mode === "report" && (
            <p className="text-xs text-emerald-400">
              📊{" "}
              {tr(
                "보고 요청 모드 — 보고서/발표자료 작성 작업을 요청합니다",
                "Report mode - request report/deck authoring",
                "レポート依頼モード — レポート/資料作成を依頼します",
                "报告请求模式 — 请求撰写报告/演示资料",
              )}
            </p>
          )}
          {mode === "staff_chat" && (
            <p className="text-xs text-purple-400">
              👥{" "}
              {tr(
                "팀 채팅 — 스태프끼리 메시지를 주고받습니다",
                "Team chat - staff-to-staff messages",
                "チームチャット — スタッフ同士でメッセージのやり取り",
                "团队聊天 — 员工间消息交流",
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}
