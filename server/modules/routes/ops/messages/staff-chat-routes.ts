import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import type { DatabaseSync } from "node:sqlite";

interface StaffChatDeps {
  app: Express;
  db: DatabaseSync;
  nowMs: () => number;
  broadcast: (type: string, payload: unknown) => void;
}

export function registerStaffChatRoutes({ app, db, nowMs, broadcast }: StaffChatDeps): void {
  // GET /api/staff-messages — Fetch staff-to-staff messages (general channel)
  app.get("/api/staff-messages", (_req: Request, res: Response) => {
    const limit = Math.min(Number(_req.query.limit) || 100, 500);
    const messages = db
      .prepare(
        `SELECT id, sender_type, sender_id, sender_name, receiver_type, receiver_id,
                content, message_type, created_at
         FROM messages
         WHERE message_type = 'staff_chat'
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(limit);
    // Return in chronological order
    (messages as unknown[]).reverse();
    res.json({ ok: true, messages });
  });

  // POST /api/staff-messages — Send a staff chat message
  app.post("/api/staff-messages", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) return res.status(400).json({ error: "content_required" });

    const senderName = typeof body.sender_name === "string" ? body.sender_name.trim() : null;
    if (!senderName) return res.status(400).json({ error: "sender_name_required" });

    const id = randomUUID();
    const createdAt = nowMs();

    db.prepare(
      `INSERT INTO messages (id, sender_type, sender_id, sender_name, receiver_type, receiver_id, content, message_type, created_at)
       VALUES (?, 'staff', ?, ?, 'all', NULL, ?, 'staff_chat', ?)`,
    ).run(id, senderName, senderName, content, createdAt);

    const msg = {
      id,
      sender_type: "staff",
      sender_id: senderName,
      sender_name: senderName,
      receiver_type: "all",
      receiver_id: null,
      content,
      message_type: "staff_chat",
      created_at: createdAt,
    };

    broadcast("new_staff_message", msg);
    res.json({ ok: true, message: msg });
  });
}
