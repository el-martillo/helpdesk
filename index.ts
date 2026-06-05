/**
 * El Martillo I.T. — Ticket Notify Edge Function
 * ────────────────────────────────────────────────
 * Endpoint: POST /functions/v1/ticket-notify
 *
 *   new_status = "resolved"  → email client that ticket was resolved
 *   new_status = "reopened"  → email helpdesk that client reopened a ticket
 *
 * Required secrets:
 *   HELPDESK_EMAIL   e.g. helpdesk@el-martillo.com
 *   RESEND_API_KEY   from resend.com
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

/* ── Handler ─────────────────────────────────────────────────────────────── */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  let body: Record<string, string>;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }

  const { ticket_id, new_status, changed_by, changed_by_email } = body;
  if (!ticket_id || !new_status) return json({ error: "ticket_id and new_status are required" }, 400);

  const supabaseUrl   = Deno.env.get("SUPABASE_URL")!;
  const serviceKey    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const helpdeskEmail = Deno.env.get("HELPDESK_EMAIL") || "helpdesk@el-martillo.com";
  const resendKey     = Deno.env.get("RESEND_API_KEY");

  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  /* ── Fetch ticket ── */
  const { data: ticket, error: ticketErr } = await sb
    .from("tickets")
    .select("*, requester:profiles!requester_id(id, full_name, email)")
    .eq("id", ticket_id)
    .single();

  if (ticketErr || !ticket) {
    console.error("ticket-notify: ticket not found", ticketErr);
    return json({ error: "Ticket not found" }, 404);
  }

  const ticketNum = ticket.ticket_number;
  const subject   = ticket.subject   || "(no subject)";
  const priority  = ticket.priority  || "medium";
  const category  = ticket.category  || "General";
  const requester = ticket.requester as { id: string; full_name: string; email: string } | null;

  /* ── Parse attachment URLs ── */
  let attachUrls: string[] = [];
  if (ticket.attachment_urls) {
    try { attachUrls = JSON.parse(ticket.attachment_urls); } catch { /* ignore */ }
  }
  if (!attachUrls.length && ticket.attachment_url) {
    attachUrls = [ticket.attachment_url];
  }

  /* ── Build attachment thumbnail strip for email ── */
  const attachBlock = buildAttachmentBlock(attachUrls);

  /* ── Route by status ── */
  if (new_status === "reopened") {
    // ── Rate limit: one helpdesk notification per ticket per 5 minutes ──
    const { count: recentReopened } = await sb
      .from("system_log")
      .select("*", { count: "exact", head: true })
      .eq("action", "email_sent")
      .ilike("details", `%#${ticketNum} reopened by client%`)
      .gte("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString());
    if ((recentReopened ?? 0) > 0) {
      console.warn(`ticket-notify: cooldown active for reopened #${ticketNum}`);
      return json({ skipped: "cooldown", reason: "Notification already sent within the last 5 minutes" }, 429);
    }

    const clientName  = changed_by       || requester?.full_name || "A client";
    const clientEmail = changed_by_email || requester?.email     || "";

    const emailSubject = `🔄 Ticket #${ticketNum} Reopened — ${subject}`;
    const emailHtml = `
      <div style="font-family:Inter,system-ui,sans-serif;max-width:600px;margin:0 auto;color:#1a1917">
        <div style="background:#185FA5;padding:20px 28px;border-radius:10px 10px 0 0">
          <h2 style="color:#fff;margin:0;font-size:18px">Ticket Reopened</h2>
        </div>
        <div style="background:#ffffff;padding:28px;border:1px solid #e5e5e3;border-top:none;border-radius:0 0 10px 10px">
          <p style="margin:0 0 20px;font-size:15px">
            A resolved ticket has been <strong>reopened</strong> by the client and needs your attention.
          </p>

          <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px">
            <tr style="background:#f5f5f4">
              <td style="padding:10px 14px;font-weight:600;width:140px;border:1px solid #e5e5e3">Ticket</td>
              <td style="padding:10px 14px;border:1px solid #e5e5e3">#${ticketNum} — ${escHtml(subject)}</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-weight:600;border:1px solid #e5e5e3">Reopened by</td>
              <td style="padding:10px 14px;border:1px solid #e5e5e3">${escHtml(clientName)}${clientEmail ? ` &lt;${escHtml(clientEmail)}&gt;` : ""}</td>
            </tr>
            <tr style="background:#f5f5f4">
              <td style="padding:10px 14px;font-weight:600;border:1px solid #e5e5e3">Priority</td>
              <td style="padding:10px 14px;border:1px solid #e5e5e3;text-transform:capitalize">${escHtml(priority)}</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-weight:600;border:1px solid #e5e5e3">Category</td>
              <td style="padding:10px 14px;border:1px solid #e5e5e3">${escHtml(category)}</td>
            </tr>
            <tr style="background:#f5f5f4">
              <td style="padding:10px 14px;font-weight:600;border:1px solid #e5e5e3">Reopened at</td>
              <td style="padding:10px 14px;border:1px solid #e5e5e3">${new Date().toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" })}</td>
            </tr>
          </table>

          ${attachBlock}

          <p style="margin:0 0 8px;font-size:13px;color:#6b6963">
            The ticket status has been set back to <strong>Open</strong>. Please review and follow up with the client.
          </p>
          <div style="margin-top:24px;padding-top:20px;border-top:1px solid #e5e5e3;font-size:12px;color:#9e9a94">
            El Martillo I.T. Helpdesk · This is an automated notification
          </div>
        </div>
      </div>`;

    const result = await sendEmail({ resendKey, from: `El Martillo Helpdesk <${helpdeskEmail}>`, to: helpdeskEmail, subject: emailSubject, html: emailHtml });
    console.log(`ticket-notify: reopened #${ticketNum} → ${helpdeskEmail}`, result.ok ? "sent" : "failed");
    if (result.ok) {
      await sb.from("system_log").insert({
        actor_name: changed_by || "Client",
        actor_role: "client",
        action: "email_sent",
        details: `Ticket #${ticketNum} reopened by client — helpdesk notified`,
      });
    }
    return json({ sent: result.ok, direction: "client→helpdesk", ticket: ticketNum });

  } else if (new_status === "resolved") {
    const clientEmail = requester?.email;
    if (!clientEmail) {
      console.warn(`ticket-notify: no client email for ticket #${ticketNum}`);
      return json({ sent: false, reason: "No client email on record" });
    }

    // ── Rate limit: one resolution email per ticket per 5 minutes ──
    const { count: recentResolved } = await sb
      .from("system_log")
      .select("*", { count: "exact", head: true })
      .eq("action", "email_sent")
      .ilike("details", `%#${ticketNum}%resolved%`)
      .gte("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString());
    if ((recentResolved ?? 0) > 0) {
      console.warn(`ticket-notify: cooldown active for resolved #${ticketNum}`);
      return json({ skipped: "cooldown", reason: "Email already sent within the last 5 minutes" }, 429);
    }

    const clientName  = requester?.full_name || "Customer";
    const agentName   = changed_by || "The support team";
    const emailSubject = `✅ Your ticket #${ticketNum} has been resolved [Ticket #${ticketNum}]`;
    const emailHtml = `
      <div style="font-family:Inter,system-ui,sans-serif;max-width:600px;margin:0 auto;color:#1a1917">
        <div style="background:#3B6D11;padding:20px 28px;border-radius:10px 10px 0 0">
          <h2 style="color:#fff;margin:0;font-size:18px">Ticket Resolved</h2>
        </div>
        <div style="background:#ffffff;padding:28px;border:1px solid #e5e5e3;border-top:none;border-radius:0 0 10px 10px">
          <p style="margin:0 0 20px;font-size:15px">
            Hi ${escHtml(clientName)},<br><br>
            Your support ticket has been <strong>resolved</strong> by ${escHtml(agentName)}.
          </p>

          <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px">
            <tr style="background:#f5f5f4">
              <td style="padding:10px 14px;font-weight:600;width:140px;border:1px solid #e5e5e3">Ticket</td>
              <td style="padding:10px 14px;border:1px solid #e5e5e3">#${ticketNum} — ${escHtml(subject)}</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-weight:600;border:1px solid #e5e5e3">Resolved by</td>
              <td style="padding:10px 14px;border:1px solid #e5e5e3">${escHtml(agentName)}</td>
            </tr>
            <tr style="background:#f5f5f4">
              <td style="padding:10px 14px;font-weight:600;border:1px solid #e5e5e3">Resolved at</td>
              <td style="padding:10px 14px;border:1px solid #e5e5e3">${new Date().toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" })}</td>
            </tr>
          </table>

          ${attachBlock}

          <p style="margin:0 0 8px;font-size:13px;color:#6b6963">
            If your issue is not fully resolved, you can log in to the client portal and reopen this ticket.
          </p>
          <div style="margin-top:24px;padding-top:20px;border-top:1px solid #e5e5e3;font-size:12px;color:#9e9a94">
            El Martillo I.T. Helpdesk · <a href="mailto:${helpdeskEmail}" style="color:#185FA5">${helpdeskEmail}</a>
          </div>
        </div>
      </div>`;

    const result = await sendEmail({ resendKey, from: `El Martillo I.T. Support <${helpdeskEmail}>`, to: clientEmail, subject: emailSubject, html: emailHtml });
    console.log(`ticket-notify: resolved #${ticketNum} → ${clientEmail}`, result.ok ? "sent" : "failed");
    if (result.ok) {
      await sb.from("system_log").insert({
        actor_name: changed_by || "System",
        actor_role: "admin",
        action: "email_sent",
        details: `Ticket #${ticketNum} resolved — resolution email sent to ${clientEmail}`,
      });
    }
    return json({ sent: result.ok, direction: "helpdesk→client", ticket: ticketNum });

  } else if (new_status === "client_reopened") {
    const clientEmail = requester?.email;
    const clientName  = requester?.full_name || changed_by || "Customer";

    if (!clientEmail) {
      console.warn(`ticket-notify: no client email for ticket #${ticketNum}`);
      return json({ sent: false, reason: "No client email on record" });
    }

    // ── Rate limit ──
    const { count: recentClientReopened } = await sb
      .from("system_log")
      .select("*", { count: "exact", head: true })
      .eq("action", "email_sent")
      .ilike("details", `%#${ticketNum} reopened by client — confirmation%`)
      .gte("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString());
    if ((recentClientReopened ?? 0) > 0) {
      console.warn(`ticket-notify: cooldown active for client_reopened #${ticketNum}`);
      return json({ skipped: "cooldown", reason: "Email already sent within the last 5 minutes" }, 429);
    }

    const emailSubject = `🔄 Your ticket #${ticketNum} has been reopened [Ticket #${ticketNum}]`;
    const emailHtml = `
      <div style="font-family:Inter,system-ui,sans-serif;max-width:600px;margin:0 auto;color:#1a1917">
        <div style="background:#185FA5;padding:20px 28px;border-radius:10px 10px 0 0">
          <h2 style="color:#fff;margin:0;font-size:18px">Ticket Reopened</h2>
        </div>
        <div style="background:#ffffff;padding:28px;border:1px solid #e5e5e3;border-top:none;border-radius:0 0 10px 10px">
          <p style="margin:0 0 20px;font-size:15px">
            Hi ${escHtml(clientName)},<br><br>
            Your support ticket has been <strong>reopened</strong> and is back in our queue. Our team will follow up with you shortly.
          </p>
          <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px">
            <tr style="background:#f5f5f4">
              <td style="padding:10px 14px;font-weight:600;width:140px;border:1px solid #e5e5e3">Ticket</td>
              <td style="padding:10px 14px;border:1px solid #e5e5e3">#${ticketNum} — ${escHtml(subject)}</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-weight:600;border:1px solid #e5e5e3">Status</td>
              <td style="padding:10px 14px;border:1px solid #e5e5e3">Open</td>
            </tr>
            <tr style="background:#f5f5f4">
              <td style="padding:10px 14px;font-weight:600;border:1px solid #e5e5e3">Reopened at</td>
              <td style="padding:10px 14px;border:1px solid #e5e5e3">${new Date().toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" })}</td>
            </tr>
          </table>
          ${attachBlock}
          <p style="margin:0 0 8px;font-size:13px;color:#6b6963">
            If you have additional information to share, you can reply directly to your ticket in the client portal.
          </p>
          <div style="margin-top:24px;padding-top:20px;border-top:1px solid #e5e5e3;font-size:12px;color:#9e9a94">
            El Martillo I.T. Helpdesk · <a href="mailto:${helpdeskEmail}" style="color:#185FA5">${helpdeskEmail}</a>
          </div>
        </div>
      </div>`;

    const result = await sendEmail({ resendKey, from: `El Martillo I.T. Support <${helpdeskEmail}>`, to: clientEmail, subject: emailSubject, html: emailHtml });
    console.log(`ticket-notify: client_reopened #${ticketNum} → ${clientEmail}`, result.ok ? "sent" : "failed");
    if (result.ok) {
      await sb.from("system_log").insert({
        actor_name: clientName,
        actor_role: "client",
        action: "email_sent",
        details: `Ticket #${ticketNum} reopened by client — confirmation sent to ${clientEmail}`,
      });
    }
    return json({ sent: result.ok, direction: "helpdesk→client", ticket: ticketNum });

  } else if (new_status === "closed_helpdesk") {
    // Client self-closed a ticket — notify helpdesk
    const clientName  = changed_by       || requester?.full_name || "A client";
    const clientEmail = changed_by_email || requester?.email     || "";

    // ── Rate limit ──
    const { count: recentClosed } = await sb
      .from("system_log")
      .select("*", { count: "exact", head: true })
      .eq("action", "email_sent")
      .ilike("details", `%#${ticketNum} closed by client%`)
      .gte("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString());
    if ((recentClosed ?? 0) > 0) {
      console.warn(`ticket-notify: cooldown active for closed_helpdesk #${ticketNum}`);
      return json({ skipped: "cooldown", reason: "Notification already sent within the last 5 minutes" }, 429);
    }

    const emailSubject = `✅ Ticket #${ticketNum} Closed by Client — ${subject}`;
    const emailHtml = `
      <div style="font-family:Inter,system-ui,sans-serif;max-width:600px;margin:0 auto;color:#1a1917">
        <div style="background:#3B6D11;padding:20px 28px;border-radius:10px 10px 0 0">
          <h2 style="color:#fff;margin:0;font-size:18px">Ticket Closed by Client</h2>
        </div>
        <div style="background:#ffffff;padding:28px;border:1px solid #e5e5e3;border-top:none;border-radius:0 0 10px 10px">
          <p style="margin:0 0 20px;font-size:15px">
            A ticket has been <strong>closed</strong> by the client and marked as resolved.
          </p>
          <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px">
            <tr style="background:#f5f5f4">
              <td style="padding:10px 14px;font-weight:600;width:140px;border:1px solid #e5e5e3">Ticket</td>
              <td style="padding:10px 14px;border:1px solid #e5e5e3">#${ticketNum} — ${escHtml(subject)}</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-weight:600;border:1px solid #e5e5e3">Closed by</td>
              <td style="padding:10px 14px;border:1px solid #e5e5e3">${escHtml(clientName)}${clientEmail ? ` &lt;${escHtml(clientEmail)}&gt;` : ""}</td>
            </tr>
            <tr style="background:#f5f5f4">
              <td style="padding:10px 14px;font-weight:600;border:1px solid #e5e5e3">Priority</td>
              <td style="padding:10px 14px;border:1px solid #e5e5e3;text-transform:capitalize">${escHtml(priority)}</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-weight:600;border:1px solid #e5e5e3">Closed at</td>
              <td style="padding:10px 14px;border:1px solid #e5e5e3">${new Date().toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" })}</td>
            </tr>
          </table>
          ${attachBlock}
          <div style="margin-top:24px;padding-top:20px;border-top:1px solid #e5e5e3;font-size:12px;color:#9e9a94">
            El Martillo I.T. Helpdesk · This is an automated notification
          </div>
        </div>
      </div>`;

    const result = await sendEmail({ resendKey, from: `El Martillo Helpdesk <${helpdeskEmail}>`, to: helpdeskEmail, subject: emailSubject, html: emailHtml });
    console.log(`ticket-notify: closed_helpdesk #${ticketNum} → ${helpdeskEmail}`, result.ok ? "sent" : "failed");
    if (result.ok) {
      await sb.from("system_log").insert({
        actor_name: clientName,
        actor_role: "client",
        action: "email_sent",
        details: `Ticket #${ticketNum} closed by client — helpdesk notified`,
      });
    }
    return json({ sent: result.ok, direction: "client→helpdesk", ticket: ticketNum });

  } else {
    return json({ skipped: true, reason: `No notification configured for status '${new_status}'` });
  }
});

/* ── Attachment thumbnail strip ──────────────────────────────────────────── */
function buildAttachmentBlock(urls: string[]): string {
  if (!urls.length) return "";

  // Each thumbnail: 120×120, linked to full image, table-based for email client compat
  const THUMB_SIZE = 120;
  const MAX_SHOW   = 5; // show at most 5 thumbs in email
  const visible    = urls.slice(0, MAX_SHOW);
  const extra      = urls.length - visible.length;

  const cells = visible.map((u, i) => `
    <td style="padding:4px;vertical-align:top">
      <a href="${escHtml(u)}" target="_blank" style="display:block;text-decoration:none">
        <img src="${escHtml(u)}"
             width="${THUMB_SIZE}" height="${THUMB_SIZE}"
             alt="Attachment ${i + 1}"
             style="width:${THUMB_SIZE}px;height:${THUMB_SIZE}px;object-fit:cover;border-radius:6px;border:1px solid #e5e5e3;display:block"/>
      </a>
    </td>`).join("");

  const extraNote = extra > 0
    ? `<p style="margin:6px 0 0;font-size:11px;color:#9e9a94">+ ${extra} more image${extra > 1 ? "s" : ""} — view in portal</p>`
    : "";

  return `
    <div style="margin-bottom:20px">
      <p style="margin:0 0 8px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#9e9a94">
        Attachment${urls.length > 1 ? `s (${urls.length})` : ""}
      </p>
      <table border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
        <tr>${cells}</tr>
      </table>
      ${extraNote}
    </div>`;
}

/* ── Send via Resend ─────────────────────────────────────────────────────── */
async function sendEmail({ resendKey, from, to, subject, html }: {
  resendKey: string | undefined;
  from: string; to: string; subject: string; html: string;
}): Promise<{ ok: boolean; body?: unknown }> {
  if (!resendKey) {
    console.warn("ticket-notify: RESEND_API_KEY not set — dry run");
    console.log("ticket-notify dry-run:", { from, to, subject });
    return { ok: false, body: { error: "RESEND_API_KEY not configured" } };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  });
  const body = await res.json().catch(() => ({}));
  // Log Resend errors server-side only — body may contain request metadata
  if (!res.ok) console.error("ticket-notify: Resend error", res.status, (body as Record<string,unknown>)?.message ?? res.statusText);
  return { ok: res.ok, body };
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
