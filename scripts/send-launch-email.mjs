#!/usr/bin/env node

/**
 * Hodos Launch & Outreach Dispatcher via Resend
 * Usage:
 *   RESEND_API_KEY=re_xxx node scripts/send-launch-email.mjs --to=user@example.com --template=launch
 *   RESEND_API_KEY=re_xxx node scripts/send-launch-email.mjs --to=partner@city.gov --template=fleet
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY || parseArg("--key");
const TO_ARG = parseArg("--to");
const TEMPLATE_ARG = parseArg("--template") || "launch";

function parseArg(flag) {
  const arg = process.argv.find((a) => a.startsWith(flag + "="));
  return arg ? arg.split("=")[1] : null;
}

if (!RESEND_API_KEY) {
  console.error("Error: RESEND_API_KEY is required.");
  console.error("Provide it via environment variable or --key=re_xxx");
  console.error("\nExample:");
  console.error("  RESEND_API_KEY=re_xxx node scripts/send-launch-email.mjs --to=test@example.com --template=launch");
  process.exit(1);
}

if (!TO_ARG) {
  console.error("Error: --to=email@domain.com (or comma-separated emails) is required.");
  process.exit(1);
}

const recipients = TO_ARG.split(",").map((e) => e.trim()).filter(Boolean);

const TEMPLATES = {
  launch: {
    subject: "Introducing Hodos: The Road Maps Itself (Open Pavement Intelligence)",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #111827; line-height: 1.6; padding: 24px;">
        <div style="border-bottom: 2px solid #257B65; padding-bottom: 16px; margin-bottom: 24px;">
          <h1 style="font-size: 22px; font-weight: 800; color: #111827; margin: 0;">hodos<span style="color:#257B65;">.</span></h1>
          <p style="font-size: 13px; color: #6B7280; margin: 4px 0 0;">Autonomous Road Condition & Hazard Mapping</p>
        </div>

        <p style="font-size: 15px;">Hello,</p>

        <p style="font-size: 15px;">
          We are excited to share <strong>Hodos</strong>—a passive, open-source road condition and defect mapping platform.
        </p>

        <p style="font-size: 15px;">
          Traditional road surface profiling is expensive and rare. Hodos turns everyday bus, car, and motorcycle rides into high-precision pavement maps—quietly in the background with zero phone interaction.
        </p>

        <div style="background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 12px; padding: 18px; margin: 24px 0;">
          <h3 style="margin-top: 0; font-size: 14px; font-weight: 700; color: #111827;">What Hodos Does:</h3>
          <ul style="margin: 0; padding-left: 20px; font-size: 14px; color: #374151;">
            <li style="margin-bottom: 6px;"><strong>100% Autonomous Sensing:</strong> Runs quietly in your pocket using adaptive noise-floor filtering that automatically tunes for diesel buses, cars, or scooters.</li>
            <li style="margin-bottom: 6px;"><strong>Zero Distraction:</strong> Completely silent with zero haptic buzzing or popup interruptions while driving.</li>
            <li style="margin-bottom: 6px;"><strong>Privacy by Design:</strong> Automatically trims 250 meters from departure and arrival points so private homes are never recorded.</li>
            <li style="margin-bottom: 6px;"><strong>Real Live Data:</strong> Over 430 verified potholes and rough road sections mapped and viewable right now.</li>
          </ul>
        </div>

        <div style="text-align: center; margin: 32px 0;">
          <a href="https://hodos.devilabs.dev/map" style="display: inline-block; background: #111827; color: #ffffff; padding: 13px 26px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 700;">Explore the Live Road Map &rarr;</a>
        </div>

        <p style="font-size: 14px; color: #4B5563;">
          • <strong>Live Web Map:</strong> <a href="https://hodos.devilabs.dev/map" style="color: #257B65;">https://hodos.devilabs.dev/map</a><br/>
          • <strong>Android Releases:</strong> <a href="https://github.com/DrSkyle/hodos/releases" style="color: #257B65;">Download Hodos APK</a><br/>
          • <strong>Source Code:</strong> <a href="https://github.com/DrSkyle/hodos" style="color: #257B65;">GitHub (MIT & CC BY-NC-SA 4.0)</a>
        </p>

        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 32px 0 20px;" />

        <p style="font-size: 12px; color: #9CA3AF; margin: 0;">
          Sent by Devilabs · Makers of Hodos<br/>
          hodos@devilabs.dev · Kathmandu, Nepal
        </p>
      </div>
    `
  },
  fleet: {
    subject: "Hodos Fleet & Municipal Pilot: Proactive Pothole Alerts & Pavement Analytics",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #111827; line-height: 1.6; padding: 24px;">
        <div style="border-bottom: 2px solid #257B65; padding-bottom: 16px; margin-bottom: 24px;">
          <h1 style="font-size: 22px; font-weight: 800; color: #111827; margin: 0;">hodos<span style="color:#257B65;">.</span></h1>
          <p style="font-size: 13px; color: #6B7280; margin: 4px 0 0;">Fleet Protection & Municipal Pavement Analytics</p>
        </div>

        <p style="font-size: 15px;">Hello,</p>

        <p style="font-size: 15px;">
          Vehicle suspension repairs, popped tires, and road maintenance delays cost transport fleets and municipal departments substantial budget every year.
        </p>

        <p style="font-size: 15px;">
          <strong>Hodos</strong> turns ordinary vehicles into autonomous road surface inspectors. We are launching pilot partnerships for commercial transport fleets (logistics, delivery, ride-hailing) and municipal road divisions.
        </p>

        <div style="background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 12px; padding: 18px; margin: 24px 0;">
          <h3 style="margin-top: 0; font-size: 14px; font-weight: 700; color: #111827;">Commercial Pilot Capabilities:</h3>
          <ul style="margin: 0; padding-left: 20px; font-size: 14px; color: #374151;">
            <li style="margin-bottom: 6px;"><strong>Real-time Hazard Heads-Up (SDK/API):</strong> Warn drivers 100 meters ahead of deep craters to slow down and avoid suspension damage.</li>
            <li style="margin-bottom: 6px;"><strong>Smooth-Ride Routing:</strong> Route cargo, passengers, and delivery vehicles along roads with lowest roughness (IRI).</li>
            <li style="margin-bottom: 6px;"><strong>Municipal Work Order Verification:</strong> Automatically audit whether contractor road resurfacing actually eliminated surface defects.</li>
          </ul>
        </div>

        <div style="text-align: center; margin: 32px 0;">
          <a href="https://hodos.devilabs.dev/map" style="display: inline-block; background: #257B65; color: #ffffff; padding: 13px 26px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 700;">View Verified Road Observations &rarr;</a>
        </div>

        <p style="font-size: 14px; color: #374151;">
          We would welcome a 15-minute conversation to demonstrate how our live hazard telemetry integrates with your dispatch or GIS systems. Reply directly to this email at <a href="mailto:hodos@devilabs.dev" style="color:#257B65; font-weight:600;">hodos@devilabs.dev</a> to arrange a pilot.
        </p>

        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 32px 0 20px;" />

        <p style="font-size: 12px; color: #9CA3AF; margin: 0;">
          Devilabs · Hodos Infrastructure & Mobility<br/>
          hodos@devilabs.dev · https://hodos.devilabs.dev
        </p>
      </div>
    `
  }
};

const template = TEMPLATES[TEMPLATE_ARG] || TEMPLATES.launch;

async function sendEmail(recipient) {
  const payload = {
    from: "Hodos <hodos@devilabs.dev>",
    to: recipient,
    subject: template.subject,
    html: template.html
  };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (res.ok) {
      console.log(`✓ Sent successfully to ${recipient} (ID: ${data.id})`);
      return true;
    } else {
      console.error(`✗ Failed to send to ${recipient}:`, data);
      return false;
    }
  } catch (err) {
    console.error(`✗ Network error sending to ${recipient}:`, err.message);
    return false;
  }
}

async function main() {
  console.log(`Dispatching ${TEMPLATE_ARG} email via Resend (from: hodos@devilabs.dev)...`);
  console.log(`Recipients (${recipients.length}):`, recipients.join(", "));

  for (const email of recipients) {
    await sendEmail(email);
  }
  console.log("Done!");
}

main();
