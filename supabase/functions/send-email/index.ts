// Supabase Edge Function: send-email
//
// Sends an email on behalf of a connected sender. Refreshes the access token,
// builds a MIME message (with optional PDF attachment), and POSTs to Gmail's
// users.messages.send. The message lands in the sender's Sent folder and
// threads correctly for replies — same behavior as if they'd sent from Gmail.
//
// Body (JSON):
//   {
//     senderId: uuid,
//     to:       string | string[],
//     cc?:      string | string[],
//     bcc?:     string | string[],
//     subject:  string,
//     body:     string,                            // plain text
//     attachments?: [{ filename, contentType, base64 }]
//   }
//
// Deploys WITH JWT verification (caller must include anon-or-service-role JWT
// in Authorization). Frontend already has the anon key.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const GOOGLE_CLIENT_ID     = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin"  : "*",
  "Access-Control-Allow-Methods" : "POST, OPTIONS",
  "Access-Control-Allow-Headers" : "Content-Type, Authorization, apikey, x-client-info",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST")   return json({ error: "method_not_allowed" }, 405);

  try {
    const payload = await req.json();
    const { senderId, to, cc, bcc, subject, body, attachments = [] } = payload;

    if (!senderId || !to || !subject) {
      return json({ error: "Missing required fields: senderId, to, subject" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 1. Fetch sender + refresh token
    const { data: sender, error: senderErr } = await supabase
      .from("email_senders")
      .select("id, email_address, display_name, refresh_token, status")
      .eq("id", senderId)
      .maybeSingle();
    if (senderErr) return json({ error: `db: ${senderErr.message}` }, 500);
    if (!sender)   return json({ error: "sender_not_found" }, 404);
    if (sender.status !== "connected" || !sender.refresh_token) {
      return json({ error: "sender_not_connected" }, 400);
    }

    // 2. Refresh access token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id    : GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: sender.refresh_token,
        grant_type   : "refresh_token",
      }),
    });
    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      // Token's no good anymore — flag for reconnect
      await supabase.from("email_senders").update({ status: "revoked" }).eq("id", senderId);
      return json({ error: `token_refresh_failed: ${t}` }, 401);
    }
    const { access_token } = await tokenRes.json();

    // 3. Build MIME message
    const fromHeader = sender.display_name
      ? `"${sender.display_name.replace(/"/g, "")}" <${sender.email_address}>`
      : sender.email_address;
    const mime = buildMime({ from: fromHeader, to, cc, bcc, subject, body: body || "", attachments });
    const raw  = base64UrlEncode(mime);

    // 4. Send via Gmail API
    const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method : "POST",
      headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
      body   : JSON.stringify({ raw }),
    });
    if (!sendRes.ok) {
      const t = await sendRes.text();
      return json({ error: `gmail_send_failed: ${t}` }, 502);
    }
    const result = await sendRes.json();

    // 5. Stamp last_used_at
    await supabase
      .from("email_senders")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", senderId);

    return json({ ok: true, messageId: result.id, threadId: result.threadId });
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function base64UrlEncode(s: string): string {
  // Use TextEncoder to handle UTF-8 properly, then standard base64, then URL-safe
  const bytes  = new TextEncoder().encode(s);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function headerEncode(v: string): string {
  // RFC 2047 encoded-word for non-ASCII text in headers (subjects, names, etc.)
  if (/^[\x20-\x7E]*$/.test(v)) return v;
  const bytes = new TextEncoder().encode(v);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

function arr(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function chunkBase64(b64: string): string {
  return (b64.match(/.{1,76}/g) || [b64]).join("\r\n");
}

interface MimeInput {
  from: string;
  to:  string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  body: string;
  attachments: { filename: string; contentType?: string; base64: string }[];
}

function buildMime({ from, to, cc, bcc, subject, body, attachments }: MimeInput): string {
  const lines: string[] = [];
  lines.push(`From: ${from}`);
  lines.push(`To: ${arr(to).join(", ")}`);
  if (arr(cc).length)  lines.push(`Cc: ${arr(cc).join(", ")}`);
  if (arr(bcc).length) lines.push(`Bcc: ${arr(bcc).join(", ")}`);
  lines.push(`Subject: ${headerEncode(subject)}`);
  lines.push(`MIME-Version: 1.0`);

  if (attachments.length === 0) {
    lines.push(`Content-Type: text/plain; charset=UTF-8`);
    lines.push(`Content-Transfer-Encoding: 7bit`);
    lines.push("");
    lines.push(body);
  } else {
    const boundary = `bnd_${crypto.randomUUID()}`;
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    lines.push("");

    // Plain-text body part
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: text/plain; charset=UTF-8`);
    lines.push(`Content-Transfer-Encoding: 7bit`);
    lines.push("");
    lines.push(body);

    // Attachments
    for (const a of attachments) {
      const safeName = a.filename.replace(/"/g, "");
      lines.push(`--${boundary}`);
      lines.push(`Content-Type: ${a.contentType || "application/octet-stream"}; name="${safeName}"`);
      lines.push(`Content-Disposition: attachment; filename="${safeName}"`);
      lines.push(`Content-Transfer-Encoding: base64`);
      lines.push("");
      lines.push(chunkBase64(a.base64));
    }
    lines.push(`--${boundary}--`);
  }

  return lines.join("\r\n");
}
