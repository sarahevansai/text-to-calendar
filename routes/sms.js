/**
 * routes/sms.js — Twilio SMS webhook handler
 *
 * Twilio calls POST /sms/webhook whenever someone texts your number.
 * We:
 *   1. Validate the request came from Twilio (signature check)
 *   2. Look up the sender's phone → find their family
 *   3. Parse the message with Claude
 *   4. Create the Google Calendar event
 *   5. Reply with a confirmation SMS
 */

const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const { parseEventFromSMS } = require('../lib/claude');
const { createEvent } = require('../lib/calendar');
const { getFamilyByPhone } = require('../lib/db');

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

function formatEventConfirmation(familyName, parsed) {
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
    return `✓ Added "${parsed.title}" to ${familyName}\n📅 ${dateStr} at ${timeStr}`;
  } catch {
    return `✓ Added "${parsed.title}" to ${familyName}`;
  }
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

  try {
    // 2. Parse the message with Claude
    const parsed = await parseEventFromSMS(messageBody, timezone);

    if (!parsed.isEvent) {
      return res.send(
        twimlMessage(
          `Hmm, I couldn't find an event in that message.\n\n` +
            `Try something like:\n` +
            `"dentist wednesday 3:30pm"\n` +
            `"Grammy coming Saturday 10am"\n` +
            `"soccer thursday 4pm"`
        )
      );
    }

    // 3. Create the Google Calendar event
    await createEvent(family.googleTokens, family.calendarId, {
      ...parsed,
      timezone,
    });

    // 4. Reply with confirmation
    const confirmation = formatEventConfirmation(family.name, parsed);
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
