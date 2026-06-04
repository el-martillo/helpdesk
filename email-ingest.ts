/**
 * El Martillo I.T. — Email Ingest Edge Function
 * ───────────────────────────────────────────────
 * Endpoint: POST /functions/v1/email-ingest
 *
 * Receives inbound email webhooks from Resend and creates support tickets.
 *
 * Flow:
 *   1. Parse sender, subject, body from Resend webhook payload
 *   2. Look up sender in profiles by email
 *   3. Unknown sender → reply with signup link, no ticket created
 *   4. Known sender   → create ticket, reply with confirmation
 *
 * Required secrets (Supabase Dashboard → Edge Functions → Manage secrets):
 *   RESEND_API_KEY        — your Resend API key
 *   RESEND_WEBHOOK_SECRET — from Resend inbound webhook settings (for request verification)
 *   HELPDESK_EMAIL        — e.g. helpdesk@el-martillo.com
 *   INBOUND_EMAIL         — e.g. tickets@el-martillo.com
 *   SITE_URL              — e.g. https://el-martillo.github.io/helpdesk
 *   SUPPORT_NAME          — e.g. El Martillo I.T.
 *
 * Resend setup:
 *   1. Resend Dashboard → Domains → el-martillo.com → Inbound
 *   2. Add inbound address: tickets@el-martillo.com
 *   3. Set webhook URL: https://gtcrmqbmlvtlyiwnshma.supabase.co/functions/v1/email-ingest
 *   4. Add MX record to DNS: 10 inbound.resend.com
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function escHtml(str: string): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Strip Re:, Fwd:, Fw: prefixes (case-insensitive, multiple levels) */
function cleanSubject(subject: string): string {
  return subject
    .replace(/^(re|fwd?)\s*:\s*/gi, "")
    .replace(/^(re|fwd?)\s*:\s*/gi, "") // second pass for "Re: Fwd: ..."
    .trim() || "No subject";
}

/** Extract plain text from email body — strip excessive whitespace and signatures */
function cleanBody(text: string | undefined, html: string | undefined): string {
  let body = text || "";

  // If no plain text, strip HTML tags
  if (!body && html) {
    body = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"');
  }

  // Strip common email signature delimiters and everything after
  body = body
    .replace(/\r\n/g, "\n")
    .replace(/-- ?\n[\s\S]*/m, "")           // -- signature delimiter
    .replace(/_{3,}[\s\S]*/m, "")            // ___ divider
    .replace(/^>.*$/gm, "")                  // quoted reply lines
    .replace(/On .+wrote:[\s\S]*/m, "")      // "On [date] X wrote:" quoted block
    .replace(/\n{3,}/g, "\n\n")              // collapse excess blank lines
    .trim();

  return body || "(No message body)";
}

/** Send an email via Resend */
async function sendEmail(resendKey: string, opts: {
  from: string; to: string; subject: string; html: string;
}): Promise<boolean> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) console.error("email-ingest: Resend error", res.status, (body as Record<string,unknown>)?.message ?? "");
  return res.ok;
}

/* ── Handler ─────────────────────────────────────────────────────────────── */
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // ── Read env ──
  const supabaseUrl     = Deno.env.get("SUPABASE_URL")!;
  const serviceKey      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendKey       = Deno.env.get("RESEND_API_KEY") ?? "";
  const helpdeskEmail   = Deno.env.get("HELPDESK_EMAIL")  ?? "helpdesk@el-martillo.com";
  const inboundEmail    = Deno.env.get("INBOUND_EMAIL")   ?? "tickets@el-martillo.com";
  const siteUrl         = Deno.env.get("SITE_URL")        ?? "https://el-martillo.github.io/helpdesk";
  const supportName     = Deno.env.get("SUPPORT_NAME")    ?? "El Martillo I.T.";

  // ── Parse Resend inbound webhook payload ──
  let payload: Record<string, unknown>;
  try { payload = await req.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }

  // Resend inbound webhook schema:
  // { from, to, subject, text, html, headers, attachments, ... }
  const fromRaw  = (payload.from  as string) ?? "";
  const subject  = (payload.subject as string) ?? "";
  const textBody = (payload.text  as string) ?? "";
  const htmlBody = (payload.html  as string) ?? "";

  // Extract email address from "Name <email>" format
  const fromEmailMatch = fromRaw.match(/<([^>]+)>/) ?? fromRaw.match(/([^\s]+@[^\s]+)/);
  const fromEmail = (fromEmailMatch?.[1] ?? fromRaw).toLowerCase().trim();
  const fromName  = fromRaw.replace(/<[^>]+>/, "").trim() || fromEmail;

  if (!fromEmail || !fromEmail.includes("@")) {
    console.warn("email-ingest: could not parse sender address from:", fromRaw);
    return json({ skipped: true, reason: "Could not parse sender address" });
  }

  // ── Ignore emails sent from the helpdesk itself (prevent loops) ──
  if (fromEmail === helpdeskEmail || fromEmail === inboundEmail) {
    console.log("email-ingest: ignoring email from own address");
    return json({ skipped: true, reason: "Sender is helpdesk address" });
  }

  console.log(`email-ingest: received from ${fromEmail}, subject: "${subject}"`);

  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // ── Look up sender in profiles ──
  const { data: profile } = await sb
    .from("profiles")
    .select("id, full_name, email, role")
    .ilike("email", fromEmail)
    .maybeSingle();

  // ── Unknown sender: reply with signup link ──
  if (!profile) {
    console.log(`email-ingest: unknown sender ${fromEmail} — sending signup reply`);

    if (resendKey) {
      await sendEmail(resendKey, {
        from: `${supportName} <${inboundEmail}>`,
        to: fromEmail,
        subject: `Re: ${subject || "Your support request"}`,
        html: `
          <div style="font-family:Inter,system-ui,sans-serif;max-width:560px;margin:0 auto;color:#1a1917">
            <div style="background:#185FA5;padding:20px 28px;border-radius:10px 10px 0 0">
              <h2 style="color:#fff;margin:0;font-size:18px">Account Required</h2>
            </div>
            <div style="background:#ffffff;padding:28px;border:1px solid #e5e5e3;border-top:none;border-radius:0 0 10px 10px">
              <p style="margin:0 0 16px;font-size:15px">
                Hi ${escHtml(fromName)},
              </p>
              <p style="margin:0 0 16px;font-size:14px;color:#6b6963;line-height:1.6">
                Thank you for getting in touch. To submit a support ticket, you'll need a client account with ${escHtml(supportName)}.
              </p>
              <p style="margin:0 0 24px;font-size:14px;color:#6b6963;line-height:1.6">
                Please register via our client portal and then resubmit your request:
              </p>
              <a href="${siteUrl}/index.html"
                 style="display:inline-block;background:#185FA5;color:#fff;text-decoration:none;
                        padding:12px 24px;border-radius:6px;font-size:14px;font-weight:500">
                Register on the client portal →
              </a>
              <p style="margin:24px 0 0;font-size:13px;color:#9e9a94;line-height:1.6">
                If you believe you already have an account, please ensure you are using the same email address you registered with, or contact us at
                <a href="mailto:${helpdeskEmail}" style="color:#185FA5">${helpdeskEmail}</a>.
              </p>
              <hr style="border:none;border-top:1px solid #e8e6e1;margin:24px 0"/>
              <p style="color:#9e9a94;font-size:12px;margin:0">
                ${escHtml(supportName)} · <a href="mailto:${helpdeskEmail}" style="color:#185FA5">${helpdeskEmail}</a>
              </p>
            </div>
          </div>`,
      });
    }

    return json({ skipped: true, reason: "Unknown sender — signup email sent" });
  }

  // ── Known sender: create ticket ──
  const ticketSubject = cleanSubject(subject);
  const ticketBody    = cleanBody(textBody, htmlBody);

  const { data: ticket, error: ticketErr } = await sb
    .from("tickets")
    .insert({
      subject:       ticketSubject,
      description:   ticketBody,
      status:        "open",
      priority:      "medium",
      category:      "General",
      contact_email: fromEmail,
      requester_id:  profile.id,
      source:        "email",          // optional: add a 'source' column to track origin
    })
    .select("ticket_number, id")
    .single();

  if (ticketErr || !ticket) {
    console.error("email-ingest: failed to create ticket", ticketErr);
    return json({ error: "Failed to create ticket" }, 500);
  }

  console.log(`email-ingest: created ticket #${ticket.ticket_number} for ${fromEmail}`);

  // ── Log to system_log ──
  await sb.from("system_log").insert({
    actor_name: profile.full_name || fromEmail,
    actor_role: profile.role || "client",
    action:     "ticket_created_via_email",
    details:    `Ticket #${ticket.ticket_number} created via inbound email from ${fromEmail}: "${ticketSubject}"`,
  }).catch(() => {});

  // ── Send confirmation email to client ──
  if (resendKey) {
    await sendEmail(resendKey, {
      from: `${supportName} <${inboundEmail}>`,
      to: fromEmail,
      subject: `✅ Ticket #${ticket.ticket_number} received — ${ticketSubject}`,
      html: `
        <div style="font-family:Inter,system-ui,sans-serif;max-width:560px;margin:0 auto;color:#1a1917">
          <div style="background:#3B6D11;padding:20px 28px;border-radius:10px 10px 0 0">
            <h2 style="color:#fff;margin:0;font-size:18px">Ticket Received</h2>
          </div>
          <div style="background:#ffffff;padding:28px;border:1px solid #e5e5e3;border-top:none;border-radius:0 0 10px 10px">
            <p style="margin:0 0 16px;font-size:15px">
              Hi ${escHtml(profile.full_name || fromName)},
            </p>
            <p style="margin:0 0 20px;font-size:14px;color:#6b6963;line-height:1.6">
              We've received your support request and created a ticket. Our team will be in touch shortly.
            </p>
            <div style="background:#f5f5f4;border-radius:8px;padding:16px;margin-bottom:24px">
              <div style="font-size:12px;color:#9e9a94;margin-bottom:4px">Ticket #${ticket.ticket_number}</div>
              <div style="font-size:15px;font-weight:500;color:#1a1917">${escHtml(ticketSubject)}</div>
              <div style="font-size:12px;color:#6b6963;margin-top:6px">Status: Open &nbsp;·&nbsp; Priority: Medium &nbsp;·&nbsp; Category: General</div>
            </div>
            <a href="${siteUrl}/index.html"
               style="display:inline-block;background:#185FA5;color:#fff;text-decoration:none;
                      padding:10px 20px;border-radius:6px;font-size:14px;font-weight:500">
              View ticket in portal →
            </a>
            <hr style="border:none;border-top:1px solid #e8e6e1;margin:28px 0"/>
            <p style="color:#9e9a94;font-size:12px;margin:0">
              ${escHtml(supportName)} · <a href="mailto:${helpdeskEmail}" style="color:#185FA5">${helpdeskEmail}</a>
            </p>
          </div>
        </div>`,
    });
  }

  // ── Notify helpdesk of new inbound ticket ──
  if (resendKey) {
    await sendEmail(resendKey, {
      from: `${supportName} <${inboundEmail}>`,
      to: helpdeskEmail,
      subject: `📧 New ticket #${ticket.ticket_number} via email — ${ticketSubject}`,
      html: `
        <div style="font-family:Inter,system-ui,sans-serif;max-width:560px;margin:0 auto;color:#1a1917">
          <div style="background:#185FA5;padding:20px 28px;border-radius:10px 10px 0 0">
            <h2 style="color:#fff;margin:0;font-size:18px">New Ticket via Email</h2>
          </div>
          <div style="background:#ffffff;padding:28px;border:1px solid #e5e5e3;border-top:none;border-radius:0 0 10px 10px">
            <p style="margin:0 0 20px;font-size:14px;color:#6b6963">
              A new support ticket has been created from an inbound email.
            </p>
            <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px">
              <tr style="background:#f5f5f4">
                <td style="padding:10px 14px;font-weight:600;width:120px;border:1px solid #e5e5e3">Ticket</td>
                <td style="padding:10px 14px;border:1px solid #e5e5e3">#${ticket.ticket_number} — ${escHtml(ticketSubject)}</td>
              </tr>
              <tr>
                <td style="padding:10px 14px;font-weight:600;border:1px solid #e5e5e3">From</td>
                <td style="padding:10px 14px;border:1px solid #e5e5e3">${escHtml(profile.full_name || fromName)} &lt;${escHtml(fromEmail)}&gt;</td>
              </tr>
              <tr style="background:#f5f5f4">
                <td style="padding:10px 14px;font-weight:600;border:1px solid #e5e5e3">Message</td>
                <td style="padding:10px 14px;border:1px solid #e5e5e3;white-space:pre-wrap;font-size:12px;color:#6b6963">${escHtml(ticketBody.slice(0, 500))}${ticketBody.length > 500 ? "…" : ""}</td>
              </tr>
            </table>
            <div style="margin-top:24px;padding-top:20px;border-top:1px solid #e5e5e3;font-size:12px;color:#9e9a94">
              ${escHtml(supportName)} Helpdesk · This is an automated notification
            </div>
          </div>
        </div>`,
    });
  }

  return json({ success: true, ticket_number: ticket.ticket_number });
});
