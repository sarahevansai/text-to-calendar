/**
 * routes/sms.js — Twilio SMS webhook handler
 *
 * Twilio calls POST /sms/webhook whenever someone texts your number.
 * We:
 *   1. Validate the request came from Twilio (signature check)
 *   2. Look up the sender's phone → find their family
 *   3. Parse the message with Claude (also detects WHO the event is for)
 *   4. Resolve color: use the person-for's colorId, fall back to sender's colorId
 *   5. Create the Google Calendar event (with colorId)
 *   6. Reply with a confirmation SMS (includes warning if person not recognized)
 */

const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const { parseEventFromSMS } = require('../lib/claude');
const { createEvent } = require('../lib/calendar');
const { getFamilyByPhone, getMemberByPhone, COLOR_EMOJIS } = require('../lib/db');

// ---- Twilio Signature Validation ----

function validateTwilioRequest(req, res, next) {
  // Skip validation in local development
  if (
    process.env.NODE_ENV === 'development' ||
    process.env.SKIP_TWILIO_VALIDATION === 'true'
  ) {
    return next();
  }

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.headers['x-twilio-signature'];
  const url = `${process.env.BASE_URL}/sms/webhook`;

  const valid = twilio.validateRequest(authToken, signature, url, req.body);
  if (!valid) {
    console.warn('Invalid Twilio signature from', req.ip);
    return res.status(403).send('Forbidden');
  }
  next();
}

// ---- TwiML Helper ----

function twimlMessage(text) {
  // Escape XML special characters
  const safe = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
}

// ---- Format a Date/Time for SMS confirmation ----

function formatEventConfirmation(familyName, parsed, forMember, unknownPersonName) {
  try {
    const dt = new Date(`${parsed.date}T${parsed.startTime}:00`);
    const dateStr = dt.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    const timeStr = dt.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    // Build confirmation line with color emoji if available
    let colorTag = '';
    if (forMember && forMember.colorId && COLOR_EMOJIS[forMember.colorId]) {
      colorTag = `${COLOR_EMOJIS[forMember.colorId]} `;
    }

    const forLine = forMember
      ? ` (for ${forMember.name})`
      : '';

    let msg = `✓ Added "${parsed.title}"${forLine} to ${familyName}\n${colorTag}📅 ${dateStr} at ${timeStr}`;

    if (parsed.location) {
      msg += `\n📍 ${parsed.location}`;
    }

    if (parsed.description) {
      msg += `\n📝 ${parsed.description}`;
    }

    // Warn if a person was detected in the SMS but isn't in the family
    if (unknownPersonName) {
      msg += `\n\n⚠️ Didn't recognize "${unknownPersonName}" — is he/she in your family? You can add them at your dashboard.`;
    }

    return msg;
  } catch {
    return `✓ Added "${parsed.title}" to ${familyName}`;
  }
}

/**
 * Find a family member by name (case-insensitive, partial match).
 * Returns the best match or null.
 */
function findMemberByName(members, name) {
  if (!name || !members || members.length === 0) return null;
  const lower = name.toLowerCase().trim();

  // Exact match first
  const exact = members.find((m) => m.name.toLowerCase() === lower);
  if (exact) return exact;

  // Starts-with match
  const starts = members.find((m) => m.name.toLowerCase().startsWith(lower));
  if (starts) return starts;

  // Contains match
  const contains = members.find((m) => m.name.toLowerCase().includes(lower));
  if (contains) return contains;

  return null;
}

// ---- Main Webhook ----

router.post('/webhook', validateTwilioRequest, async (req, res) => {
  res.set('Content-Type', 'text/xml');

  const senderPhone = req.body.From || '';
  const messageBody = (req.body.Body || '').trim();

  console.log(`[SMS] ${senderPhone}: ${messageBody}`);

  if (!senderPhone || !messageBody) {
    return res.send(twimlMessage('Empty message received.'));
  }

  // 1. Find the family this phone number belongs to
  const family = getFamilyByPhone(senderPhone);

  if (!family) {
    return res.send(
      twimlMessage(
        `Hi! Your number isn't registered with Text-to-Calendar yet.\n` +
          `Ask your family admin to add you at:\n${process.env.BASE_URL}/dashboard`
      )
    );
  }

  if (!family.active) {
    return res.send(
      twimlMessage(
        `Your family calendar is paused. Visit ${process.env.BASE_URL}/settings to re-enable it.`
      )
    );
  }

  const timezone = family.timezone || 'America/Los_Angeles';

  // Identify the sender's member record (for fallback color)
  const senderMember = getMemberByPhone(family, senderPhone);

  try {
    // 2. Parse the message with Claude (pass member names for person detection)
    const parsed = await parseEventFromSMS(messageBody, timezone, family.members || []);

    if (!parsed.isEvent) {
      return res.send(
        twimlMessage(
          `Hmm, I couldn't find an event in that message.\n\n` +
            `Try something like:\n` +
            `"dentist wednesday 3:30pm"\n` +
            `"Jake's dentist wednesday 3pm"\n` +
            `"soccer thursday 4pm"`
        )
      );
    }

    // 3. Resolve WHO the event is for → pick their colorId
    let forMember = null;
    let unknownPersonName = null;

    if (parsed.forPerson) {
      // Claude detected a person name — find them in the family
      forMember = findMemberByName(family.members, parsed.forPerson);

      if (!forMember) {
        // Person mentioned but not recognized — note it for the reply, fall back to sender
        unknownPersonName = parsed.forPerson;
        forMember = senderMember; // use sender's color as fallback
      }
    } else {
      // No person detected → default to the sender
      forMember = senderMember;
    }

    const colorId = forMember?.colorId || null;

    console.log(
      `[SMS] Event "${parsed.title}" for ${forMember?.name || 'unknown'} colorId=${colorId}`
    );

    // 4. Create the Google Calendar event (with colorId)
    await createEvent(family.googleTokens, family.calendarId, {
      ...parsed,
      timezone,
      colorId,
    });

    // 5. Reply with confirmation
    const confirmation = formatEventConfirmation(
      family.name,
      parsed,
      unknownPersonName ? null : forMember, // don't show "for sender" — only show if explicit
      unknownPersonName
    );
    return res.send(twimlMessage(confirmation));
  } catch (error) {
    console.error('[SMS] Error processing message:', error.message);

    let userMessage = `Sorry, something went wrong. Please try again.`;

    if (error.message && error.message.toLowerCase().includes('parse')) {
      userMessage =
        `Couldn't understand that. Try:\n"dentist wednesday 3pm"\n"dinner with mom friday 7pm"`;
    } else if (
      error.code === 401 ||
      (error.message && error.message.toLowerCase().includes('auth'))
    ) {
      userMessage = `Calendar connection issue. Ask your family admin to reconnect at ${process.env.BASE_URL}/settings`;
    } else if (error.code === 403) {
      userMessage = `Permission denied for calendar. Ask your family admin to check settings.`;
    }

    return res.send(twimlMessage(userMessage));
  }
});

module.exports = router;
