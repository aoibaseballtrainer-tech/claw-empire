import { useState } from "react";
import type { Department, Agent, CompanySettings } from "../types";
import type { UserAuthInfo } from "../api/core";
import { useI18n, localeName } from "../i18n";

type View = "office" | "agents" | "dashboard" | "tasks" | "skills" | "threads" | "meo" | "gmail" | "website" | "daily-tasks" | "settings";

interface SidebarProps {
  currentView: View;
  onChangeView: (v: View) => void;
  departments: Department[];
  agents: Agent[];
  settings: CompanySettings;
  connected: boolean;
  userAuth?: UserAuthInfo | null;
  onLogout?: () => void;
}

const NAV_ITEMS: { view: View; icon: string; sprite?: string }[] = [
  { view: "office", icon: "🏢" },
  { view: "agents", icon: "👥", sprite: "/sprites/3-D-1.png" },
  { view: "skills", icon: "📚" },
  { view: "dashboard", icon: "📊" },
  { view: "tasks", icon: "📋" },
  { view: "threads", icon: "🧵" },
  { view: "meo", icon: "📍" },
  { view: "gmail", icon: "📧" },
  { view: "website", icon: "🌐" },
  { view: "daily-tasks", icon: "🔄" },
  { view: "settings", icon: "⚙️" },
];

export default function Sidebar({ currentView, onChangeView, departments, agents, settings, connected, userAuth, onLogout }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { t, locale } = useI18n();
  const workingCount = agents.filter((a) => a.status === "working").length;
  const totalAgents = agents.length;

  const tr = (ko: string, en: string, ja = en, zh = en) => t({ ko, en, ja, zh });

  const navLabels: Record<View, string> = {
    office: tr("오피스", "Office", "オフィス", "办公室"),
    agents: tr("직원관리", "Agents", "社員管理", "员工管理"),
    skills: tr("문서고", "Library", "ライブラリ", "文档库"),
    dashboard: tr("대시보드", "Dashboard", "ダッシュボード", "仪表盘"),
    tasks: tr("업무 관리", "Tasks", "タスク管理", "任务管理"),
    threads: "Threads",
    meo: "MEO",
    gmail: "Gmail",
    website: tr("웹사이트", "Website", "ウェブサイト", "网站"),
    "daily-tasks": tr("일일 작업", "Daily Tasks", "デイリータスク", "每日任务"),
    settings: tr("설정", "Settings", "設定", "设置"),
  };

  return (
    <aside
      className={`flex h-full flex-col backdrop-blur-sm transition-all duration-300 ${collapsed ? "w-16" : "w-48"}`}
      style={{ background: "var(--th-bg-sidebar)", borderRight: "1px solid var(--th-border)" }}
    >
      {/* Logo */}
      <div
        className="flex items-center gap-2 px-3 py-4"
        style={{ borderBottom: "1px solid var(--th-border)", boxShadow: "0 4px 12px rgba(59, 130, 246, 0.06)" }}
      >
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 relative overflow-visible">
            <img
              src="/sprites/ceo-lobster.png"
              alt={tr("CEO", "CEO")}
              className="w-8 h-8 object-contain"
              style={{ imageRendering: "pixelated" }}
            />
            <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 text-[10px] leading-none drop-shadow">👑</span>
          </div>
          {!collapsed && (
            <div className="overflow-hidden">
              <div className="text-sm font-bold truncate" style={{ color: "var(--th-text-heading)" }}>
                {settings.companyName}
              </div>
              <div className="text-[10px]" style={{ color: "var(--th-text-muted)" }}>
                👑 {settings.ceoName}
              </div>
            </div>
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2 space-y-0.5 px-2">
        {NAV_ITEMS.filter((item) => {
          // Hide settings for non-admin users
          if (item.view === "settings" && userAuth?.role !== "admin") return false;
          return true;
        }).map((item) => (
          <button
            key={item.view}
            onClick={() => onChangeView(item.view)}
            className={`sidebar-nav-item ${
              currentView === item.view ? "active font-semibold shadow-sm shadow-blue-500/10" : ""
            }`}
          >
            <span className="text-base shrink-0">
              {item.sprite ? (
                <img
                  src={item.sprite}
                  alt=""
                  className="w-5 h-5 object-cover rounded-full"
                  style={{ imageRendering: "pixelated" }}
                />
              ) : (
                item.icon
              )}
            </span>
            {!collapsed && <span>{navLabels[item.view]}</span>}
          </button>
        ))}
      </nav>

      {/* Department quick stats */}
      {!collapsed && (
        <div className="px-3 py-2" style={{ borderTop: "1px solid var(--th-border)" }}>
          <div
            className="text-[10px] uppercase font-semibold mb-1.5 tracking-wider"
            style={{ color: "var(--th-text-muted)" }}
          >
            {tr("부서 현황", "Department Status", "部門状況", "部门状态")}
          </div>
          {departments.map((d) => {
            const deptAgents = agents.filter((a) => a.department_id === d.id);
            const working = deptAgents.filter((a) => a.status === "working").length;
            return (
              <div
                key={d.id}
                className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs hover:bg-[var(--th-bg-surface-hover)] transition-colors"
                style={{ color: "var(--th-text-secondary)" }}
              >
                <span>{d.icon}</span>
                <span className="flex-1 truncate">{localeName(locale, d)}</span>
                <span className={working > 0 ? "text-blue-400 font-medium" : ""}>
                  {working}/{deptAgents.length}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Staff name */}
      {!collapsed && (() => {
        const staffName = typeof window !== "undefined" ? window.localStorage.getItem("claw_staff_name") : null;
        if (!staffName) return null;
        return (
          <div className="px-3 py-2" style={{ borderTop: "1px solid var(--th-border)" }}>
            <button
              onClick={() => {
                const next = window.prompt(
                  tr("이름을 변경하세요", "Change your name", "名前を変更してください", "请更改您的名字"),
                  staffName,
                );
                if (next?.trim()) {
                  window.localStorage.setItem("claw_staff_name", next.trim());
                  window.location.reload();
                }
              }}
              className="flex items-center gap-1.5 w-full rounded-md px-1.5 py-1 text-xs hover:bg-[var(--th-bg-surface-hover)] transition-colors"
              style={{ color: "var(--th-text-secondary)" }}
            >
              <span>👤</span>
              <span className="flex-1 truncate text-left">{staffName}</span>
              <span className="text-[10px] opacity-50">✏️</span>
            </button>
          </div>
        );
      })()}

      {/* User info + Logout */}
      {userAuth && (
        <div className="px-3 py-2" style={{ borderTop: "1px solid var(--th-border)" }}>
          {!collapsed ? (
            <div className="flex items-center gap-1.5">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate" style={{ color: "var(--th-text-secondary)" }}>
                  {userAuth.name}
                </div>
                <div className="text-[10px] truncate" style={{ color: "var(--th-text-muted)" }}>
                  {userAuth.role === "admin" ? "Admin" : "Operator"}
                </div>
              </div>
              {onLogout && (
                <button
                  onClick={onLogout}
                  className="shrink-0 p-1 rounded-md hover:bg-[var(--th-bg-surface-hover)] transition-colors"
                  style={{ color: "var(--th-text-muted)" }}
                  title={tr("로그아웃", "Logout", "ログアウト", "退出登录")}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                </button>
              )}
            </div>
          ) : (
            onLogout && (
              <button
                onClick={onLogout}
                className="w-full flex justify-center p-1 rounded-md hover:bg-[var(--th-bg-surface-hover)] transition-colors"
                style={{ color: "var(--th-text-muted)" }}
                title={tr("로그아웃", "Logout", "ログアウト", "退出登录")}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
            )
          )}
        </div>
      )}

      {/* Status bar */}
      <div className="px-3 py-2.5" style={{ borderTop: "1px solid var(--th-border)" }}>
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${connected ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
          {!collapsed && (
            <div className="text-[10px]" style={{ color: "var(--th-text-muted)" }}>
              {connected
                ? tr("연결됨", "Connected", "接続中", "已连接")
                : tr("연결 끊김", "Disconnected", "接続なし", "已断开")}{" "}
              · {workingCount}/{totalAgents} {tr("근무중", "working", "稼働中", "工作中")}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
