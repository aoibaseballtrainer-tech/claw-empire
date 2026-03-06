/**
 * Voice Call Signaling — WebRTC P2P voice call signaling via existing WebSocket server.
 *
 * Routes offer/answer/ice-candidate messages between authenticated users.
 * Each user is identified by their email (from claw_user session cookie).
 */
import type { WebSocket as WsSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { lookupUserSession } from "./routes/ops/user-auth.ts";

// Map email → WebSocket connection (only latest connection per user)
const userWsMap = new Map<string, WsSocket>();

/** Extract user info from WS upgrade request cookie */
export function extractUserFromRequest(req: IncomingMessage): { email: string; name: string; role: string } | null {
  const rawCookie = req.headers.cookie;
  if (!rawCookie || typeof rawCookie !== "string") return null;
  for (const part of rawCookie.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    if (key !== "claw_user") continue;
    const value = part.slice(idx + 1).trim();
    let decoded: string;
    try { decoded = decodeURIComponent(value); } catch { decoded = value; }
    if (decoded) {
      const user = lookupUserSession(decoded);
      if (user) return user;
    }
  }
  return null;
}

/** Register a user's WebSocket connection for voice call routing */
export function registerUserWs(email: string, ws: WsSocket): void {
  userWsMap.set(email, ws);
}

/** Unregister a user's WebSocket connection */
export function unregisterUserWs(email: string, ws: WsSocket): void {
  // Only remove if it's the same connection (avoid removing a newer connection)
  if (userWsMap.get(email) === ws) {
    userWsMap.delete(email);
  }
}

/** Get list of online user emails (for showing who's available to call) */
export function getOnlineUsers(): string[] {
  const online: string[] = [];
  for (const [email, ws] of userWsMap) {
    if (ws.readyState === 1 /* OPEN */) {
      online.push(email);
    } else {
      userWsMap.delete(email);
    }
  }
  return online;
}

type VoiceSignalType =
  | "voice_call_request"
  | "voice_call_accept"
  | "voice_call_reject"
  | "voice_call_end"
  | "voice_offer"
  | "voice_answer"
  | "voice_ice_candidate"
  | "voice_get_online_users";

interface VoiceMessage {
  type: VoiceSignalType;
  payload: {
    targetEmail?: string;
    sdp?: unknown;
    candidate?: unknown;
  };
}

function sendToUser(email: string, type: string, payload: unknown): boolean {
  const ws = userWsMap.get(email);
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify({ type, payload, ts: Date.now() }));
  return true;
}

/** Handle incoming voice call signaling message from a user */
export function handleVoiceMessage(senderEmail: string, senderName: string, msg: VoiceMessage): void {
  const { type, payload } = msg;
  const targetEmail = payload?.targetEmail;

  switch (type) {
    case "voice_get_online_users": {
      const online = getOnlineUsers().filter((e) => e !== senderEmail);
      sendToUser(senderEmail, "voice_online_users", { users: online });
      break;
    }

    case "voice_call_request": {
      if (!targetEmail) return;
      const delivered = sendToUser(targetEmail, "voice_call_incoming", {
        fromEmail: senderEmail,
        fromName: senderName,
      });
      if (!delivered) {
        sendToUser(senderEmail, "voice_call_unavailable", { targetEmail });
      }
      break;
    }

    case "voice_call_accept": {
      if (!targetEmail) return;
      sendToUser(targetEmail, "voice_call_accepted", {
        fromEmail: senderEmail,
        fromName: senderName,
      });
      break;
    }

    case "voice_call_reject": {
      if (!targetEmail) return;
      sendToUser(targetEmail, "voice_call_rejected", {
        fromEmail: senderEmail,
      });
      break;
    }

    case "voice_call_end": {
      if (!targetEmail) return;
      sendToUser(targetEmail, "voice_call_ended", {
        fromEmail: senderEmail,
      });
      break;
    }

    case "voice_offer": {
      if (!targetEmail) return;
      sendToUser(targetEmail, "voice_offer", {
        fromEmail: senderEmail,
        sdp: payload.sdp,
      });
      break;
    }

    case "voice_answer": {
      if (!targetEmail) return;
      sendToUser(targetEmail, "voice_answer", {
        fromEmail: senderEmail,
        sdp: payload.sdp,
      });
      break;
    }

    case "voice_ice_candidate": {
      if (!targetEmail) return;
      sendToUser(targetEmail, "voice_ice_candidate", {
        fromEmail: senderEmail,
        candidate: payload.candidate,
      });
      break;
    }
  }
}
