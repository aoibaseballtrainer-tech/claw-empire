import { useEffect, useState } from "react";
import { useVoiceCall } from "../hooks/useVoiceCall";
import type { WSEventType } from "../types";

interface VoiceCallProps {
  myEmail: string;
  wsSend: (type: string, payload: unknown) => void;
  wsOn: (type: WSEventType, fn: (payload: unknown) => void) => () => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const PhoneIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
  </svg>
);

export default function VoiceCall({ myEmail, wsSend, wsOn }: VoiceCallProps) {
  const vc = useVoiceCall({ myEmail, wsSend, wsOn });
  const [showPanel, setShowPanel] = useState(false);

  // Periodically refresh online users
  useEffect(() => {
    vc.refreshOnlineUsers();
    const timer = setInterval(() => vc.refreshOnlineUsers(), 10_000);
    return () => clearInterval(timer);
  }, [vc.refreshOnlineUsers]);

  // Incoming call overlay
  if (vc.status === "incoming") {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="bg-slate-800 border border-slate-600 rounded-2xl p-8 shadow-2xl max-w-sm w-full mx-4 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center animate-pulse">
            <PhoneIcon className="w-8 h-8 text-green-400" />
          </div>
          <p className="text-slate-400 text-sm mb-1">Incoming voice call</p>
          <p className="text-white text-lg font-semibold mb-6">
            {vc.peerName || vc.peerEmail}
          </p>
          <div className="flex gap-4 justify-center">
            <button
              onClick={vc.rejectCall}
              className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-500 transition-colors flex items-center justify-center"
              title="Reject"
            >
              <PhoneIcon className="w-6 h-6 text-white rotate-[135deg]" />
            </button>
            <button
              onClick={vc.acceptCall}
              className="w-14 h-14 rounded-full bg-green-600 hover:bg-green-500 transition-colors flex items-center justify-center"
              title="Accept"
            >
              <PhoneIcon className="w-6 h-6 text-white" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // In-call floating bar (calling or connected)
  if (vc.status === "connected" || vc.status === "calling") {
    return (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999]">
        <div className="bg-slate-800 border border-slate-600 rounded-full px-6 py-3 shadow-2xl flex items-center gap-4">
          {vc.status === "calling" ? (
            <>
              <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
              <span className="text-slate-300 text-sm">
                Calling {vc.peerName || vc.peerEmail}...
              </span>
            </>
          ) : (
            <>
              <div className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-white text-sm font-medium">
                {vc.peerName || vc.peerEmail}
              </span>
              <span className="text-slate-400 text-xs font-mono">
                {formatDuration(vc.callDuration)}
              </span>
            </>
          )}

          {vc.status === "connected" && (
            <button
              onClick={vc.toggleMute}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                vc.isMuted ? "bg-red-600/80 hover:bg-red-500" : "bg-slate-600 hover:bg-slate-500"
              }`}
              title={vc.isMuted ? "Unmute" : "Mute"}
            >
              {vc.isMuted ? (
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                </svg>
              )}
            </button>
          )}

          <button
            onClick={vc.endCall}
            className="w-9 h-9 rounded-full bg-red-600 hover:bg-red-500 transition-colors flex items-center justify-center"
            title="End call"
          >
            <PhoneIcon className="w-4 h-4 text-white rotate-[135deg]" />
          </button>
        </div>
      </div>
    );
  }

  // Idle: floating call button (bottom-right) with popover for online users
  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setShowPanel((p) => !p)}
        className={`fixed bottom-6 right-6 z-[9998] w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-colors ${
          showPanel ? "bg-indigo-600 hover:bg-indigo-500" : "bg-slate-700 hover:bg-slate-600"
        }`}
        title="Voice Call"
      >
        <PhoneIcon className="w-5 h-5 text-white" />
        {vc.onlineUsers.length > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-green-500 text-white text-[10px] font-bold flex items-center justify-center">
            {vc.onlineUsers.length}
          </span>
        )}
      </button>

      {/* Online users panel */}
      {showPanel && (
        <div className="fixed bottom-20 right-6 z-[9998] w-64 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700">
            <p className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Online Users
            </p>
          </div>
          {vc.onlineUsers.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-slate-500">
              No other users online
            </div>
          ) : (
            <div className="py-1 max-h-60 overflow-y-auto">
              {vc.onlineUsers.map((email) => (
                <button
                  key={email}
                  onClick={() => {
                    vc.startCall(email);
                    setShowPanel(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-700/50 transition-colors group"
                >
                  <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                  <span className="text-sm text-slate-300 truncate flex-1">{email}</span>
                  <PhoneIcon className="w-4 h-4 text-slate-500 group-hover:text-green-400 transition-colors shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
