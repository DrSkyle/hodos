/**
 * Hodos newsletter & referral waitlist.
 *
 * Stores an email address in the private `subscribers` table (keyed by a
 * SHA-256 hash so the same address cannot be stored twice) and sends an
 * immediate welcome / waitlist confirmation email via Resend when
 * RESEND_API_KEY is configured on the function.
 */

const ENDPOINT = process.env.HODOS_ENDPOINT ||
  process.env.APPWRITE_FUNCTION_API_ENDPOINT ||
  process.env.APPWRITE_FUNCTION_ENDPOINT;
const PROJECT = process.env.HODOS_PROJECT_ID || process.env.APPWRITE_FUNCTION_PROJECT_ID;
const KEY = process.env.HODOS_API_KEY || process.env.APPWRITE_FUNCTION_API_KEY;
const DATABASE_ID = process.env.HODOS_DATABASE_ID || "hodos";
const UPSTREAM_TIMEOUT_MS = 12_000;
const RESEND_FROM = process.env.RESEND_FROM || "Hodos <hodos@devilabs.dev>";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Appwrite-Project",
  "Cache-Control": "public, max-age=300"
};

function validEmail(value) {
  if (typeof value !== "string") return false;
  const clean = value.trim();
  return clean.length >= 5 &&
    clean.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean);
}

function normaliseEmail(value) {
  return value.trim().toLowerCase();
}

function log(message) {
  if (typeof console !== "undefined" && typeof console.log === "function") console.log(message);
}

function parseBody(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? value : {};
  } catch (_) {
    return {};
  }
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function buildWelcomeEmail(source) {
  const isReferralWaitlist = /referral/i.test(String(source || ""));
  if (isReferralWaitlist) {
    return {
      subject: "You’re on the Hodos referral waitlist",
      text: [
        "Hi there,",
        "",
        "You’re officially on the Hodos referral reopening waitlist.",
        "",
        "After helping 289 people earn ₹2,00,000+ (2 lakh+), we paused referrals so every local shop worldwide can place their initial pin on Hodos completely free.",
        "",
        "As soon as the referral programme reopens, you’ll be the first to hear from us.",
        "",
        "In the meantime:",
        "- Live hazard & shop map: https://hodos.devilabs.dev/map",
        "- Place a free shop pin: https://hodos.devilabs.dev/partners",
        "- Download Android APK: https://github.com/DrSkyle/hodos/releases/latest",
        "",
        "— Hodos (Devilabs)",
        "Reply to this email anytime to unsubscribe."
      ].join("\n"),
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:28px 22px;background:#fdf1f3;color:#141314;border-radius:18px;">
          <div style="margin-bottom:20px;">
            <strong style="font-size:22px;letter-spacing:-0.03em;color:#141314;">hodos<span style="color:#d58400;">.</span></strong>
          </div>
          <h1 style="font-size:22px;line-height:1.25;margin:0 0 12px;color:#141314;">You’re on the referral waitlist.</h1>
          <p style="font-size:15px;line-height:1.65;color:#373737;margin:0 0 14px;">
            After helping <strong>289 people earn ₹2,00,000+ (2 lakh+)</strong>, we paused referrals so every real local shop globally can place an initial pin on Hodos for free.
          </p>
          <p style="font-size:15px;line-height:1.65;color:#373737;margin:0 0 22px;">
            You’ll be the first to get an email the moment referrals reopen.
          </p>
          <div style="margin-bottom:22px;">
            <a href="https://hodos.devilabs.dev/map" style="display:inline-block;background:#be185d;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 20px;border-radius:999px;margin-right:8px;">Open live map</a>
            <a href="https://hodos.devilabs.dev/partners" style="display:inline-block;background:#ffffff;color:#141314;text-decoration:none;font-weight:700;font-size:14px;padding:11px 20px;border-radius:999px;border:1px solid #ded2d4;">Place a free shop pin</a>
          </div>
          <p style="font-size:12.5px;color:#50504f;margin:0;border-top:1px solid #ded2d4;padding-top:14px;">
            Hodos · Devilabs · Reply anytime to be removed from this list.
          </p>
        </div>
      `
    };
  }

  return {
    subject: "Welcome to Hodos — the road maps itself",
    text: [
      "Hi there,",
      "",
      "Thanks for joining Hodos road notes. We send occasional updates when new road coverage, app releases, or local shop features ship — never spam.",
      "",
      "Start exploring right away:",
      "- Live road & radar map: https://hodos.devilabs.dev/map",
      "- Browser web app (no install): https://hodos.devilabs.dev/app",
      "- Android APK (background sensing + 250 m privacy trim): https://github.com/DrSkyle/hodos/releases/latest",
      "- Put a local shop on the map for free: https://hodos.devilabs.dev/partners",
      "",
      "— Hodos (Devilabs)",
      "Reply to this email anytime to unsubscribe."
    ].join("\n"),
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:28px 22px;background:#fdf1f3;color:#141314;border-radius:18px;">
        <div style="margin-bottom:20px;">
          <strong style="font-size:22px;letter-spacing:-0.03em;color:#141314;">hodos<span style="color:#d58400;">.</span></strong>
        </div>
        <h1 style="font-size:22px;line-height:1.25;margin:0 0 12px;color:#141314;">You’re subscribed to Hodos.</h1>
        <p style="font-size:15px;line-height:1.65;color:#373737;margin:0 0 14px;">
          We send occasional road notes when new coverage, Android/web releases, or local shop features roll out. Zero accounts, zero trackers, zero spam.
        </p>
        <div style="margin:20px 0 22px;">
          <a href="https://hodos.devilabs.dev/map" style="display:inline-block;background:#be185d;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 20px;border-radius:999px;margin-right:8px;">Open live map</a>
          <a href="https://github.com/DrSkyle/hodos/releases/latest" style="display:inline-block;background:#ffffff;color:#141314;text-decoration:none;font-weight:700;font-size:14px;padding:11px 20px;border-radius:999px;border:1px solid #ded2d4;">Get Android APK</a>
        </div>
        <p style="font-size:12.5px;color:#50504f;margin:0;border-top:1px solid #ded2d4;padding-top:14px;">
          Hodos · Devilabs · Reply anytime to be removed from this list.
        </p>
      </div>
    `
  };
}

async function sendWelcomeEmail(to, source) {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) return false;
  const mail = buildWelcomeEmail(source);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || RESEND_FROM,
        to: [to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text
      }),
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) {
      log(`resend welcome ${response.status}`);
      return false;
    }
    return true;
  } catch (error) {
    log(`resend welcome failed: ${error}`);
    return false;
  }
}

async function subscribe(email, source) {
  const clean = normaliseEmail(email);
  if (!validEmail(clean)) {
    return { ok: false, error: "invalid email" };
  }
  if (!ENDPOINT || !PROJECT || !KEY) {
    return { ok: false, error: "storage not configured" };
  }

  const rowId = (await sha256Hex(clean)).slice(0, 32);
  const cleanSource = typeof source === "string" ? source.slice(0, 32) : "unknown";
  const response = await fetch(
    `${ENDPOINT}/tablesdb/${DATABASE_ID}/tables/subscribers/rows`,
    {
      method: "POST",
      headers: {
        "X-Appwrite-Project": PROJECT,
        "X-Appwrite-Key": KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        rowId,
        data: {
          email: clean,
          source: cleanSource,
          consent: "garage-v1",
          at: new Date().toISOString()
        }
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    }
  );

  // A duplicate row id means this address is already on the list. Report
  // success so the form never reveals who is or is not subscribed, and do not
  // spam them with a second welcome email.
  if (response.status === 409) return { ok: true, duplicate: true, emailed: false };
  if (!response.ok) {
    log(`subscribe ${response.status}`);
    return { ok: false, error: "could not save" };
  }
  const emailed = await sendWelcomeEmail(clean, cleanSource);
  return { ok: true, duplicate: false, emailed };
}

module.exports = async function main(context) {
  const { req, res } = context;
  const body = parseBody(req.body);
  const method = String(req.method || "POST").toUpperCase();

  if (method === "OPTIONS") return res.send("", 204, CORS);

  const action = body.action || "subscribe";

  if (action === "subscribe") {
    try {
      const result = await subscribe(body.email, body.source);
      return res.json(result, result.ok ? 200 : 400, CORS);
    } catch (error) {
      log(`subscribe failed: ${error}`);
      return res.json({ ok: false, error: "could not save" }, 502, CORS);
    }
  }

  return res.json({ ok: false, error: "unknown action", actions: ["subscribe"] }, 400, CORS);
};

module.exports.testing = {
  validEmail,
  normaliseEmail,
  parseBody,
  buildWelcomeEmail,
  sendWelcomeEmail
};
