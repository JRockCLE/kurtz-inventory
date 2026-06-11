// Email helpers for the Scan Hub.
//
// On the client we only need the Google Client ID (which is not a secret — it's
// fine to bundle). The Client Secret + refresh tokens live exclusively in the
// Supabase Edge Functions.

import { SB_URL, SB_KEY } from "./supabase";

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
export const OAUTH_REDIRECT_URI = `${SB_URL}/functions/v1/google-oauth-callback`;
export const SEND_EMAIL_URL    = `${SB_URL}/functions/v1/send-email`;

const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.send",
].join(" ");

/**
 * Open a popup to Google's OAuth consent screen. Returns a promise that
 * resolves with `{ ok, email }` on success or `{ ok: false, error }` on failure.
 *
 * The Edge Function callback posts a message back to the opener window which
 * we listen for here.
 */
export function connectGoogleAccount() {
  return new Promise((resolve, reject) => {
    if (!GOOGLE_CLIENT_ID) {
      reject(new Error("VITE_GOOGLE_CLIENT_ID not set — see src/lib/email.js"));
      return;
    }

    const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
      client_id    : GOOGLE_CLIENT_ID,
      redirect_uri : OAUTH_REDIRECT_URI,
      response_type: "code",
      scope        : SCOPES,
      access_type  : "offline",
      prompt       : "consent",   // ensures we get a refresh token even on re-auth
      include_granted_scopes: "true",
    });

    const popup = window.open(authUrl, "google-oauth", "width=520,height=640,menubar=no,toolbar=no");
    if (!popup) {
      reject(new Error("Popup blocked. Allow popups for this site and try again."));
      return;
    }

    // Listen for the success/failure message from the Edge Function callback
    const onMessage = (event) => {
      if (typeof event.data !== "string") return;
      let result;
      try { result = JSON.parse(event.data); } catch { return; }
      if (typeof result.ok !== "boolean") return;
      window.removeEventListener("message", onMessage);
      clearInterval(closedPoll);
      resolve(result);
    };
    window.addEventListener("message", onMessage);

    // Fallback: detect if the user closed the popup before completing
    const closedPoll = setInterval(() => {
      if (popup.closed) {
        clearInterval(closedPoll);
        window.removeEventListener("message", onMessage);
        // small grace period in case message is still in flight
        setTimeout(() => resolve({ ok: false, error: "Popup closed before completing." }), 200);
      }
    }, 500);
  });
}

/**
 * Send an email via the Supabase Edge Function.
 *
 * @param {object} params
 * @param {string} params.senderId    UUID from email_senders
 * @param {string|string[]} params.to
 * @param {string|string[]} [params.cc]
 * @param {string|string[]} [params.bcc]
 * @param {string} params.subject
 * @param {string} [params.body]
 * @param {Array<{filename:string, contentType?:string, base64:string}>} [params.attachments]
 */
export async function sendEmail(params) {
  const res = await fetch(SEND_EMAIL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SB_KEY}`,
      "apikey": SB_KEY,
    },
    body: JSON.stringify(params),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return body;
}

/** Convert a Blob → base64 string (no data URL prefix). */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => {
      const result = reader.result || "";
      const comma  = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}
