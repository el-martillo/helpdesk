import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// HTML-encode all user-supplied values before inserting into email bodies
const h = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\//g, '&#x2F;')

// ── Environment variables ────────────────────────────────────────────────
// Set these in Supabase Dashboard → Edge Functions → Manage secrets:
//   RESEND_API_KEY      — your Resend API key
//   SITE_URL            — e.g. https://yourdomain.com
//   SUPPORT_EMAIL       — e.g. helpdesk@el-martillo.com
//   SUPPORT_PHONE       — e.g. +350 200 50630
//   SUPPORT_NAME        — e.g. El Martillo I.T.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Read config from environment
  const SITE_URL      = Deno.env.get('SITE_URL')      ?? 'https://yourdomain.com'
  const SUPPORT_EMAIL = Deno.env.get('SUPPORT_EMAIL') ?? 'helpdesk@el-martillo.com'
  const SUPPORT_PHONE = Deno.env.get('SUPPORT_PHONE') ?? '+350 200 50630'
  const SUPPORT_NAME  = Deno.env.get('SUPPORT_NAME')  ?? 'El Martillo I.T.'

  try {
    const { ticket_id, new_status, changed_by } = await req.json()

    // Only send emails for resolved status
    if (new_status !== 'resolved') {
      return new Response(JSON.stringify({ skipped: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Use service role key to read ticket + profile data
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Fetch ticket with requester profile
    const { data: ticket, error: ticketError } = await supabase
      .from('tickets')
      .select('*, requester:profiles!requester_id(id, full_name, email)')
      .eq('id', ticket_id)
      .single()

    if (ticketError || !ticket) {
      console.error('Ticket fetch error:', ticketError)
      return new Response(JSON.stringify({ error: 'Ticket not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const clientEmail = ticket.requester?.email
    const clientName  = ticket.requester?.full_name || 'Client'

    if (!clientEmail) {
      return new Response(JSON.stringify({ skipped: 'no email on profile' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ── Rate limit: block if a resolution email was sent for this ticket in the last 5 minutes ──
    const COOLDOWN_MS = 5 * 60 * 1000
    const cooldownSince = new Date(Date.now() - COOLDOWN_MS).toISOString()
    const { count: recentCount } = await supabase
      .from('system_log')
      .select('*', { count: 'exact', head: true })
      .eq('action', 'email_sent')
      .ilike('details', `%ticket #${ticket.ticket_number}%`)
      .gte('created_at', cooldownSince)
    if ((recentCount ?? 0) > 0) {
      console.warn(`ticket-notify: cooldown active for ticket #${ticket.ticket_number}`)
      return new Response(
        JSON.stringify({ skipped: 'cooldown', reason: 'Email already sent within the last 5 minutes' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Send email via Resend
    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) throw new Error('RESEND_API_KEY not set')

    const emailHtml = `
      <div style="font-family:Inter,system-ui,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#fff">
        <div style="margin-bottom:24px">
          <img src="${SITE_URL}/logo.png" alt="${h(SUPPORT_NAME)}" style="height:36px"/>
        </div>
        <h2 style="font-size:20px;font-weight:600;color:#1a1917;margin:0 0 8px">
          Your ticket has been resolved
        </h2>
        <p style="color:#6b6963;font-size:14px;margin:0 0 24px">
          Hi ${h(clientName)}, your support request has been marked as resolved.
        </p>
        <div style="background:#f5f5f4;border-radius:8px;padding:16px;margin-bottom:24px">
          <div style="font-size:12px;color:#9e9a94;margin-bottom:4px">Ticket #${h(ticket.ticket_number)}</div>
          <div style="font-size:15px;font-weight:500;color:#1a1917;margin-bottom:8px">${h(ticket.subject)}</div>
          <div style="font-size:12px;color:#6b6963">
            Category: ${h(ticket.category || 'General')} &nbsp;·&nbsp;
            Priority: ${h(ticket.priority)} &nbsp;·&nbsp;
            Resolved by: ${h(changed_by || 'Support team')}
          </div>
        </div>
        <p style="color:#6b6963;font-size:14px;margin:0 0 24px">
          If you're still experiencing issues or have further questions, you can reopen your ticket 
          by logging into the client portal.
        </p>
        <a href="${SITE_URL}/index.html"
           style="display:inline-block;background:#185FA5;color:#fff;text-decoration:none;
                  padding:10px 20px;border-radius:6px;font-size:14px;font-weight:500">
          View ticket in portal →
        </a>
        <hr style="border:none;border-top:1px solid #e8e6e1;margin:32px 0"/>
        <p style="color:#9e9a94;font-size:12px;margin:0">
          ${h(SUPPORT_NAME)} · Gibraltar ·
          <a href="mailto:${h(SUPPORT_EMAIL)}" style="color:#185FA5">${h(SUPPORT_EMAIL)}</a> ·
          ${h(SUPPORT_PHONE)}
        </p>
      </div>
    `

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: `${SUPPORT_NAME} <${SUPPORT_EMAIL}>`,
        to: clientEmail,
        subject: `Ticket resolved: #${h(ticket.ticket_number)} – ${h(ticket.subject)} [Ticket #${h(ticket.ticket_number)}]`,
        html: emailHtml
      })
    })

    const emailResult = await emailRes.json()

    if (!emailRes.ok) {
      // Log full Resend response server-side only — never embed in thrown message
      // as it may contain request metadata including auth headers
      console.error('Resend error:', emailResult)
      throw new Error('Email send failed')
    }

    // Log to system_log
    await supabase.from('system_log').insert({
      actor_name: changed_by || 'System',
      actor_role: 'admin',
      action: 'email_sent',
      details: `Resolution email sent to ${clientEmail} for ticket #${h(ticket.ticket_number)}`
    })

    return new Response(
      JSON.stringify({ success: true, email_id: emailResult.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    // Log full error server-side only — never echo err.message to caller,
    // as Resend/Supabase exceptions can include auth headers or env var values
    console.error('ticket-notify error:', err)
    return new Response(
      JSON.stringify({ error: 'Notification failed. Check Edge Function logs.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
