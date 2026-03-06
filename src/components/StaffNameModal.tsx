import { useState, useRef, useEffect } from "react";

interface StaffNameModalProps {
  onSubmit: (name: string) => void;
}

export default function StaffNameModal({ onSubmit }: StaffNameModalProps) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (trimmed) onSubmit(trimmed);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md rounded-2xl bg-slate-800 p-8 shadow-2xl border border-slate-600/50">
        <div className="mb-6 text-center">
          <div className="mb-3 text-4xl">👤</div>
          <h2 className="text-xl font-bold text-white">ようこそ</h2>
          <p className="mt-2 text-sm text-slate-400">
            チャットで表示される名前を入力してください
          </p>
        </div>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="例: 田中太郎"
          className="w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-3 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <button
          onClick={handleSubmit}
          disabled={!name.trim()}
          className="mt-4 w-full rounded-lg bg-indigo-600 py-3 font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          はじめる
        </button>
      </div>
    </div>
  );
}
