// Supabase Edge Function: google-oauth-callback
//
// Receives Google's OAuth redirect (?code=…). Exchanges the code for tokens,
// fetches the user's email + display name from Google's userinfo endpoint, and
// upserts the row into `email_senders` keyed by email address. Returns an HTML
// page that posts a message to the opener window and self-closes so the app
// can refresh its sender list.
//
// Deploy with `--no-verify-jwt` because Google calls this without our auth
// header. The function only reads from / writes to email_senders, no other
// privileged access.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const GOOGLE_CLIENT_ID     = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const OAUTH_REDIRECT_URI   = Deno.env.get("OAUTH_REDIRECT_URI")!;
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code  = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) return closeWithResult({ ok: false, error });
  if (!code) return closeWithResult({ ok: false, error: "missing_code" });

  try {
    // 1. Exchange auth code for access + refresh tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: OAUTH_REDIRECT_URI,
      }),
    });
    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      return closeWithResult({ ok: false, error: `token_exchange_failed: ${t}` });
    }
    const tokens = await tokenRes.json();

    if (!tokens.refresh_token) {
      return closeWithResult({
        ok: false,
        error: "No refresh token returned. The account may already be authorized. " +
               "Revoke at https://myaccount.google.com/permissions then try again.",
      });
    }

    // 2. Fetch user identity (email + name)
    const uiRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!uiRes.ok) {
      return closeWithResult({ ok: false, error: "userinfo_fetch_failed" });
    }
    const userInfo = await uiRes.json();
    if (!userInfo.email) {
      return closeWithResult({ ok: false, error: "no_email_in_userinfo" });
    }

    // 3. Upsert the sender row (keyed by email — reconnecting refreshes the token)
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { error: dbErr } = await supabase
      .from("email_senders")
      .upsert(
        {
          email_address: userInfo.email,
          display_name : userInfo.name || userInfo.email,
          refresh_token: tokens.refresh_token,
          status       : "connected",
          updated_at   : new Date().toISOString(),
        },
        { onConflict: "email_address" }
      );
    if (dbErr) return closeWithResult({ ok: false, error: `db: ${dbErr.message}` });

    return closeWithResult({ ok: true, email: userInfo.email });
  } catch (e) {
    return closeWithResult({ ok: false, error: e.message || String(e) });
  }
});

function closeWithResult(result: { ok: boolean; email?: string; error?: string }) {
  const msg = JSON.stringify(result);
  const headline = result.ok ? "Connected" : "Connection failed";
  const detail   = result.ok
    ? `Linked ${result.email || "Google account"}. You can close this window.`
    : result.error || "Unknown error.";
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${headline}</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#fafaf9;color:#1c1917}
.card{max-width:420px;padding:24px;text-align:center}
.ok{color:#15803d}.bad{color:#b91c1c}</style></head><body>
<div class="card">
  <h2 class="${result.ok ? "ok" : "bad"}">${headline}</h2>
  <p>${detail.replace(/[<>&"]/g, c => ({"<":"&lt;",">":"&gt;","&":"&amp;","\"":"&quot;"}[c] || c))}</p>
  <p style="color:#78716c;font-size:13px">This window will close automatically.</p>
</div>
<script>
  try { window.opener && window.opener.postMessage(${JSON.stringify(msg)}, "*"); } catch (e) {}
  setTimeout(() => window.close(), 1500);
</script></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}
