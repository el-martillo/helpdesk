import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// HTML-encode all user-supplied values before inserting into email bodies
const h = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

type Attachment = { name: string; url: string };

function wrapBroadcastHtml(subject: string, bodyHtml: string): string {
  // Wraps the admin-authored HTML in the same branded header/footer used
  // across the other outbound emails, so broadcasts look consistent.
  return [
    '<!DOCTYPE html>',
    '<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>',
    '<title>' + h(subject) + '</title></head>',
    '<body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;">',
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:40px 16px;"><tr><td align="center">',
    '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">',
    '<tr><td style="background:#185FA5;border-radius:10px 10px 0 0;padding:24px 32px;">',
    '<span style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">El Martillo I.T.</span><br/>',
    '<span style="font-size:12px;color:rgba(255,255,255,0.75);margin-top:2px;display:block;">Support Portal</span>',
    '</td></tr>',
    '<tr><td style="background:#ffffff;padding:28px 32px;border-left:1px solid #e5e5e3;border-right:1px solid #e5e5e3;">',
    '<div style="font-size:14px;color:#1a1917;line-height:1.7;">' + bodyHtml + '</div>',
    '</td></tr>',
    '<tr><td style="background:#f9f9f8;border:1px solid #e5e5e3;border-top:none;border-radius:0 0 10px 10px;padding:18px 32px;">',
    '<div style="font-size:11px;color:#9e9a94;line-height:1.6;">',
    '<strong style="color:#6b6963;">El Martillo I.T.</strong><br/>',
    'Tel: <a href="tel:+35020050630" style="color:#185FA5;text-decoration:none;">+350 200 50630</a> &nbsp;&middot;&nbsp;',
    '<a href="mailto:helpdesk@el-martillo.com" style="color:#185FA5;text-decoration:none;">helpdesk@el-martillo.com</a>',
    '</div></td></tr>',
    '</table></td></tr></table>',
    '</body></html>',
  ].join('\n');
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunkSize = 0x8000; // avoid call-stack limits on String.fromCharCode for large files
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function fetchAttachmentsAsResendFormat(attachments: Attachment[]) {
  const out: { filename: string; content: string }[] = [];
  for (const a of attachments) {
    if (!a?.url || !a?.name) continue;
    const res = await fetch(a.url);
    if (!res.ok) throw new Error(`Failed to fetch attachment "${a.name}"`);
    const buf = await res.arrayBuffer();
    out.push({ filename: a.name, content: arrayBufferToBase64(buf) });
  }
  return out;
}

// Send with limited concurrency so we don't hammer Resend's rate limit on
// large recipient lists.
async function sendInBatches<T>(items: T[], concurrency: number, fn: (item: T) => Promise<boolean>) {
  let success = 0, failed = 0;
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const results = await Promise.allSettled(chunk.map(fn));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) success++; else failed++;
    }
  }
  return { success, failed };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') as string;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string;
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY') as string;
    const resendKey   = Deno.env.get('RESEND_API_KEY') as string;
    const fromEmail   = Deno.env.get('FROM_EMAIL') ?? 'helpdesk@el-martillo.com';
    const fromName    = Deno.env.get('SUPPORT_NAME') ?? 'El Martillo I.T.';

    // Verify caller session
    const callerToken = authHeader.replace('Bearer ', '');
    const anonClient  = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: 'Bearer ' + callerToken } },
    });
    const { data: { user: callerUser }, error: sessionError } = await anonClient.auth.getUser();
    if (sessionError || !callerUser) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify caller role — admins and super_admins only
    const { data: callerProfile } = await anonClient
      .from('profiles').select('role, full_name').eq('id', callerUser.id).single();
    if (!callerProfile || !['admin', 'super_admin'].includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { subject, html, recipient_type, attachments } = await req.json();
    if (!subject || !html) {
      return new Response(JSON.stringify({ error: 'subject and html are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const recipientType: 'all' | 'admins' = recipient_type === 'admins' ? 'admins' : 'all';
    const attachmentList: Attachment[] = Array.isArray(attachments) ? attachments : [];

    const adminClient = createClient(supabaseUrl, serviceKey);

    // ── Pull recipient emails from the users list ─────────────────────
    let query = adminClient.from('profiles').select('email, full_name, role').not('email', 'is', null);
    if (recipientType === 'admins') query = query.in('role', ['admin', 'super_admin']);
    const { data: recipients, error: recErr } = await query;
    if (recErr) {
      return new Response(JSON.stringify({ error: recErr.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // De-dupe by lowercased email
    const seen = new Set<string>();
    const toSend = (recipients || []).filter(r => {
      const e = String(r.email || '').toLowerCase().trim();
      if (!e || !e.includes('@') || seen.has(e)) return false;
      seen.add(e);
      return true;
    });

    if (!toSend.length) {
      return new Response(JSON.stringify({ error: 'No recipients matched this selection' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!resendKey) {
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY not set' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch attachment bytes once, reused across every recipient send
    let resendAttachments: { filename: string; content: string }[] = [];
    if (attachmentList.length) {
      try {
        resendAttachments = await fetchAttachmentsAsResendFormat(attachmentList);
      } catch (e) {
        return new Response(JSON.stringify({ error: (e as Error).message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const emailHtml = wrapBroadcastHtml(subject, html);

    const { success, failed } = await sendInBatches(toSend, 8, async (r) => {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${fromName} <${fromEmail}>`,
          to: [r.email],
          subject,
          html: emailHtml,
          ...(resendAttachments.length ? { attachments: resendAttachments } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('broadcast-email: Resend error for', r.email, res.status, (err as Record<string, unknown>)?.message ?? '');
      }
      return res.ok;
    });

    // ── Log the broadcast ──────────────────────────────────────────────
    const { error: logErr } = await adminClient.from('broadcasts').insert({
      subject,
      body_html: html,
      recipient_type: recipientType,
      recipient_count: success,
      attachments: attachmentList,
      sent_by_id: callerUser.id,
      sent_by_name: callerProfile.full_name || callerUser.email || 'Admin',
    });
    if (logErr) console.error('broadcast-email: failed to log broadcast', logErr);

    return new Response(JSON.stringify({ success: true, recipient_count: success, failed_count: failed }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    const err = e as Error;
    console.error('broadcast-email error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
