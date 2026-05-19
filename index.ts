// =============================================================
// DeskFlow — send-ticket-email Edge Function
// Triggered by a Supabase Database Webhook on INSERT to tickets
// Sends confirmation to the requester and helpdesk@el-martillo.com
//
// Setup:
//   1. Deploy: supabase functions deploy send-ticket-email
//   2. Set secrets:
//        supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxx
//        supabase secrets set SUPABASE_URL=https://gtcrmqbmlvtlyiwnshma.supabase.co
//        supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
//   3. Create webhook in Supabase Dashboard:
//        Database → Webhooks → Create webhook
//        Table: tickets  |  Events: INSERT
//        URL: https://gtcrmqbmlvtlyiwnshma.supabase.co/functions/v1/send-ticket-email
// =============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const HELPDESK_EMAIL = 'helpdesk@el-martillo.com'
const COMPANY_NAME   = 'El Martillo I.T.'
const RESEND_API     = 'https://api.resend.com/emails'

Deno.serve(async (req: Request) => {
  try {
    const payload = await req.json()
    const ticket  = payload.record   // the newly inserted ticket row

    if (!ticket) {
      return new Response('No record in payload', { status: 400 })
    }

    // ── Fetch requester profile to get their email ──────────
    const supabase = createClient(
      Deno.env.get('SB_URL')!,
	Deno.env.get('SB_SERVICE_ROLE_KEY')!
    )

    let requesterEmail: string | null = ticket.contact_email || null
    let requesterName  = 'Customer'

    if (ticket.requester_id) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, email')
        .eq('id', ticket.requester_id)
        .single()

      if (profile) {
        requesterName  = profile.full_name || requesterName
        requesterEmail = requesterEmail || profile.email
      }
    }

    const ticketUrl = `https://gtcrmqbmlvtlyiwnshma.supabase.co` // update with your domain

    // ── Email templates ──────────────────────────────────────
    const priorityColour: Record<string, string> = {
      critical: '#E24B4A',
      high:     '#EF9F27',
      medium:   '#378ADD',
      low:      '#9e9a94',
    }
    const pColour = priorityColour[ticket.priority] || '#378ADD'

    // Client confirmation email
    const clientHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:Inter,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:32px 16px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid rgba(0,0,0,0.08)">

        <!-- Header -->
        <tr><td style="background:#1A3A7A;padding:24px 32px;text-align:center">
          <p style="margin:0;color:#ffffff;font-size:18px;font-weight:600">${COMPANY_NAME}</p>
          <p style="margin:6px 0 0;color:rgba(255,255,255,0.7);font-size:13px">Support Ticket Confirmation</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:32px">
          <p style="margin:0 0 16px;font-size:14px;color:#1a1917">Hi <strong>${requesterName}</strong>,</p>
          <p style="margin:0 0 20px;font-size:14px;color:#6b6963;line-height:1.6">
            Thank you for contacting us. Your support ticket has been received and our team will get back to you as soon as possible.
          </p>

          <!-- Ticket card -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;border-radius:8px;border:1px solid rgba(0,0,0,0.08);margin-bottom:24px">
            <tr><td style="padding:16px 20px">
              <p style="margin:0 0 12px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#9e9a94">Ticket details</p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:4px 0;font-size:12px;color:#9e9a94;width:100px">Ticket #</td>
                  <td style="padding:4px 0;font-size:13px;font-weight:600;color:#1a1917;font-family:monospace">#${ticket.ticket_number}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0;font-size:12px;color:#9e9a94">Subject</td>
                  <td style="padding:4px 0;font-size:13px;font-weight:500;color:#1a1917">${ticket.subject}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0;font-size:12px;color:#9e9a94">Category</td>
                  <td style="padding:4px 0;font-size:13px;color:#1a1917">${ticket.category || 'General'}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0;font-size:12px;color:#9e9a94">Priority</td>
                  <td style="padding:4px 0">
                    <span style="display:inline-block;background:${pColour}22;color:${pColour};font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px">${ticket.priority}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:4px 0;font-size:12px;color:#9e9a94">Status</td>
                  <td style="padding:4px 0">
                    <span style="display:inline-block;background:#E6F1FB;color:#185FA5;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px">Open</span>
                  </td>
                </tr>
                ${ticket.description ? `
                <tr>
                  <td colspan="2" style="padding:12px 0 0">
                    <p style="margin:0 0 4px;font-size:12px;color:#9e9a94">Description</p>
                    <p style="margin:0;font-size:13px;color:#6b6963;line-height:1.6">${ticket.description}</p>
                  </td>
                </tr>` : ''}
              </table>
            </td></tr>
          </table>

          <p style="margin:0 0 8px;font-size:13px;color:#6b6963;line-height:1.6">
            We aim to respond within <strong>4 hours</strong> during business hours. You'll receive an email when we update your ticket.
          </p>
          <p style="margin:0;font-size:13px;color:#6b6963">
            If you have additional information to add, simply reply to this email.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f9f9f8;padding:20px 32px;border-top:1px solid rgba(0,0,0,0.08);text-align:center">
          <p style="margin:0;font-size:12px;color:#9e9a94">${COMPANY_NAME} · <a href="mailto:${HELPDESK_EMAIL}" style="color:#185FA5;text-decoration:none">${HELPDESK_EMAIL}</a></p>
          <p style="margin:6px 0 0;font-size:11px;color:#9e9a94">Tel: +350 200 50630</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

    // Internal helpdesk notification email
    const helpdeskHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:Inter,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:32px 16px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid rgba(0,0,0,0.08)">

        <tr><td style="background:#1A3A7A;padding:20px 32px">
          <p style="margin:0;color:#ffffff;font-size:16px;font-weight:600">🎫 New ticket received</p>
          <p style="margin:4px 0 0;color:rgba(255,255,255,0.7);font-size:12px">Ticket #${ticket.ticket_number} · ${ticket.priority?.toUpperCase()} priority</p>
        </td></tr>

        <tr><td style="padding:24px 32px">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;border-radius:8px;border:1px solid rgba(0,0,0,0.08);margin-bottom:20px">
            <tr><td style="padding:16px 20px">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:4px 0;font-size:12px;color:#9e9a94;width:120px">Ticket #</td>
                  <td style="padding:4px 0;font-size:13px;font-weight:600;font-family:monospace">#${ticket.ticket_number}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0;font-size:12px;color:#9e9a94">Subject</td>
                  <td style="padding:4px 0;font-size:13px;font-weight:500">${ticket.subject}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0;font-size:12px;color:#9e9a94">From</td>
                  <td style="padding:4px 0;font-size:13px">${requesterName}${requesterEmail ? ` &lt;${requesterEmail}&gt;` : ''}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0;font-size:12px;color:#9e9a94">Category</td>
                  <td style="padding:4px 0;font-size:13px">${ticket.category || 'General'}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0;font-size:12px;color:#9e9a94">Priority</td>
                  <td style="padding:4px 0">
                    <span style="display:inline-block;background:${pColour}22;color:${pColour};font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px">${ticket.priority?.toUpperCase()}</span>
                  </td>
                </tr>
                ${ticket.contact_email ? `<tr><td style="padding:4px 0;font-size:12px;color:#9e9a94">Email</td><td style="padding:4px 0;font-size:13px"><a href="mailto:${ticket.contact_email}" style="color:#185FA5">${ticket.contact_email}</a></td></tr>` : ''}
                ${ticket.contact_phone ? `<tr><td style="padding:4px 0;font-size:12px;color:#9e9a94">Phone</td><td style="padding:4px 0;font-size:13px">${ticket.contact_phone}</td></tr>` : ''}
                ${ticket.description ? `
                <tr><td colspan="2" style="padding:12px 0 0">
                  <p style="margin:0 0 4px;font-size:12px;color:#9e9a94">Description</p>
                  <p style="margin:0;font-size:13px;color:#6b6963;line-height:1.6">${ticket.description}</p>
                </td></tr>` : ''}
              </table>
            </td></tr>
          </table>
          <p style="margin:0;font-size:13px;color:#6b6963">Log in to the <a href="https://gtcrmqbmlvtlyiwnshma.supabase.co/admin.html" style="color:#185FA5">admin panel</a> to assign and respond to this ticket.</p>
        </td></tr>

        <tr><td style="background:#f9f9f8;padding:16px 32px;border-top:1px solid rgba(0,0,0,0.08);text-align:center">
          <p style="margin:0;font-size:11px;color:#9e9a94">${COMPANY_NAME} Internal Notification</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

    const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!
    const results: string[] = []

    // ── Send to requester ────────────────────────────────────
    if (requesterEmail) {
      const res = await fetch(RESEND_API, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from:    `${COMPANY_NAME} <${HELPDESK_EMAIL}>`,
          to:      [requesterEmail],
          subject: `[Ticket #${ticket.ticket_number}] ${ticket.subject}`,
          html:    clientHtml,
        }),
      })
      const data = await res.json()
      results.push(`client: ${res.ok ? 'sent' : JSON.stringify(data)}`)
    } else {
      results.push('client: no email address found')
    }

    // ── Send to helpdesk ─────────────────────────────────────
    const res2 = await fetch(RESEND_API, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from:    `${COMPANY_NAME} Tickets <${HELPDESK_EMAIL}>`,
        to:      [HELPDESK_EMAIL],
        subject: `[#${ticket.ticket_number}] New ${ticket.priority} ticket: ${ticket.subject}`,
        html:    helpdeskHtml,
      }),
    })
    const data2 = await res2.json()
    results.push(`helpdesk: ${res2.ok ? 'sent' : JSON.stringify(data2)}`)

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
