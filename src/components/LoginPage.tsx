import { useState, useRef, useEffect } from "react";
import type { UserAuthInfo } from "../api/core";
import { loginUser } from "../api/core";

interface LoginPageProps {
  onLogin: (user: UserAuthInfo) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim() || loading) return;

    setError("");
    setLoading(true);

    try {
      const result = await loginUser(email.trim(), password.trim());
      if (result.ok && result.user) {
        onLogin(result.user);
      } else {
        setError(result.message || "ログインに失敗しました。");
      }
    } catch {
      setError("接続エラーが発生しました。もう一度お試しください。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{
        background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 40%, #312e81 70%, #1e1b4b 100%)",
      }}
    >
      {/* Subtle grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      <div className="relative w-full max-w-sm">
        {/* Logo / Branding */}
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
            style={{
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              boxShadow: "0 8px 32px rgba(99,102,241,0.3)",
            }}
          >
            <span className="text-3xl">🏢</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            PROST AI Office
          </h1>
          <p className="text-sm text-indigo-300/70 mt-1">
            ログインしてください
          </p>
        </div>

        {/* Login Card */}
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl p-6 space-y-5"
          style={{
            backgroundColor: "rgba(30, 27, 75, 0.6)",
            border: "1px solid rgba(99, 102, 241, 0.2)",
            backdropFilter: "blur(20px)",
            boxShadow: "0 25px 50px rgba(0, 0, 0, 0.3)",
          }}
        >
          {/* Error message */}
          {error && (
            <div
              className="px-4 py-3 rounded-xl text-sm"
              style={{
                backgroundColor: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.25)",
                color: "#fca5a5",
              }}
            >
              {error}
            </div>
          )}

          {/* Email */}
          <div>
            <label
              htmlFor="login-email"
              className="block text-xs font-medium mb-1.5"
              style={{ color: "rgba(199, 210, 254, 0.8)" }}
            >
              メールアドレス
            </label>
            <input
              ref={emailRef}
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@prost-mark.com"
              autoComplete="email"
              disabled={loading}
              className="w-full px-4 py-2.5 rounded-xl text-sm outline-none transition-colors"
              style={{
                backgroundColor: "rgba(15, 23, 42, 0.6)",
                border: "1px solid rgba(99, 102, 241, 0.25)",
                color: "#e0e7ff",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "rgba(99, 102, 241, 0.5)";
                e.currentTarget.style.boxShadow = "0 0 0 3px rgba(99, 102, 241, 0.1)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "rgba(99, 102, 241, 0.25)";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
          </div>

          {/* Password */}
          <div>
            <label
              htmlFor="login-password"
              className="block text-xs font-medium mb-1.5"
              style={{ color: "rgba(199, 210, 254, 0.8)" }}
            >
              パスワード
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              autoComplete="current-password"
              disabled={loading}
              className="w-full px-4 py-2.5 rounded-xl text-sm outline-none transition-colors"
              style={{
                backgroundColor: "rgba(15, 23, 42, 0.6)",
                border: "1px solid rgba(99, 102, 241, 0.25)",
                color: "#e0e7ff",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "rgba(99, 102, 241, 0.5)";
                e.currentTarget.style.boxShadow = "0 0 0 3px rgba(99, 102, 241, 0.1)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "rgba(99, 102, 241, 0.25)";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={!email.trim() || !password.trim() || loading}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all cursor-pointer"
            style={{
              background:
                email.trim() && password.trim() && !loading
                  ? "linear-gradient(135deg, #6366f1, #8b5cf6)"
                  : "rgba(99, 102, 241, 0.2)",
              opacity: email.trim() && password.trim() && !loading ? 1 : 0.5,
              boxShadow:
                email.trim() && password.trim() && !loading
                  ? "0 4px 15px rgba(99, 102, 241, 0.3)"
                  : "none",
            }}
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <span
                  className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"
                />
                ログイン中...
              </span>
            ) : (
              "ログイン"
            )}
          </button>
        </form>

        {/* Footer */}
        <p className="text-center text-xs mt-6" style={{ color: "rgba(165, 180, 252, 0.4)" }}>
          PROST AI Office &copy; 2026
        </p>
      </div>
    </div>
  );
}
