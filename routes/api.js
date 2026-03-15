/**
 * routes/api.js — REST API for the frontend dashboard
 *
 * GET    /api/family/:id             → Get family info
 * PUT    /api/family/:id             → Update family name/timezone/calendar/active
 * POST   /api/family/:id/members     → Add a family member
 * DELETE /api/family/:id/members/:memberId → Remove a member
 * POST   /api/family/:id/calendar    → Update which calendar to use
 * POST   /api/family/:id/test-sms    → Test: parse + add real event
 * POST   /api/parse                  → Just parse a message (no event created)
 */

const express = require('express');
const router = express.Router();
const {
  getFamilyById,
  updateFamily,
  addMember,
  updateMember,
  removeMember,
} = require('../lib/db');

// ---- Middleware: Validate familyId param ----

function requireFamily(req, res, next) {
  const family = getFamilyById(req.params.id);
  if (!family) {
    return res.status(404).json({ error: 'Family not found' });
  }
  req.family = family;
  next();
}

// ---- Endpoints ----

// Get family info (never expose googleTokens to frontend)
router.get('/family/:id', requireFamily, (req, res) => {
  const { googleTokens, ...safeFamily } = req.family;
  res.json({
    ...safeFamily,
    calendarConnected: !!googleTokens,
  });
});

// Update family settings
router.put('/family/:id', requireFamily, (req, res) => {
  const { name, calendarId, timezone, active } = req.body;
  const updates = {};

  if (name && typeof name === 'string') updates.name = name.trim();
  if (calendarId && typeof calendarId === 'string') updates.calendarId = calendarId;
  if (timezone && typeof timezone === 'string') updates.timezone = timezone;
  if (typeof active === 'boolean') updates.active = active;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const family = updateFamily(req.params.id, updates);
  const { googleTokens, ...safeFamily } = family;
  res.json({ ...safeFamily, calendarConnected: !!googleTokens });
});

// Add a family member
router.post('/family/:id/members', requireFamily, (req, res) => {
  const { name, phone, colorId } = req.body;

  if (!name || !phone) {
    return res.status(400).json({ error: 'name and phone are required' });
  }

  // Basic phone validation
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 10) {
    return res.status(400).json({ error: 'Invalid phone number (need at least 10 digits)' });
  }

  try {
    const member = addMember(req.params.id, { name, phone, colorId: colorId || null });
    res.status(201).json(member);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update a family member (e.g. reassign color)
router.patch('/family/:id/members/:memberId', requireFamily, (req, res) => {
  const { colorId, name } = req.body;

  if (!colorId && !name) {
    return res.status(400).json({ error: 'colorId or name required' });
  }

  const member = updateMember(req.params.id, req.params.memberId, { colorId, name });
  if (!member) {
    return res.status(404).json({ error: 'Member not found' });
  }
  res.json(member);
});

// Remove a family member
router.delete('/family/:id/members/:memberId', requireFamily, (req, res) => {
  const success = removeMember(req.params.id, req.params.memberId);
  if (!success) {
    return res.status(404).json({ error: 'Member not found' });
  }
  res.json({ success: true });
});

// Update which calendar to use
router.post('/family/:id/calendar', requireFamily, (req, res) => {
  const { calendarId } = req.body;
  if (!calendarId) {
    return res.status(400).json({ error: 'calendarId is required' });
  }
  const family = updateFamily(req.params.id, { calendarId });
  res.json({ success: true, calendarId: family.calendarId });
});

// Just parse a message (preview, no event created)
router.post('/parse', async (req, res) => {
  const { message, familyId } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  const family = familyId ? getFamilyById(familyId) : null;
  const timezone = family?.timezone || 'America/Los_Angeles';

  try {
    const { parseEventFromSMS } = require('../lib/claude');
    const parsed = await parseEventFromSMS(message, timezone);
    res.json({ success: true, parsed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test: parse AND create a real calendar event (used in dashboard "Test SMS")
router.post('/family/:id/test-sms', requireFamily, async (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  const family = req.family;
  if (!family.googleTokens) {
    return res.status(401).json({ error: 'Google Calendar not connected. Please reconnect.' });
  }

  const timezone = family.timezone || 'America/Los_Angeles';

  try {
    const { parseEventFromSMS } = require('../lib/claude');
    const { createEvent } = require('../lib/calendar');

    // Step 1: Parse (pass members so forPerson detection works)
    const parsed = await parseEventFromSMS(message, timezone, family.members || []);
    if (!parsed.isEvent) {
      return res.json({
        success: false,
        message: parsed.error || "Couldn't find an event in that message",
        parsed,
      });
    }

    // Resolve color: find the member the event is for
    let colorId = null;
    if (parsed.forPerson) {
      const lower = parsed.forPerson.toLowerCase();
      const match = (family.members || []).find(
        (m) =>
          m.name.toLowerCase() === lower ||
          m.name.toLowerCase().startsWith(lower) ||
          m.name.toLowerCase().includes(lower)
      );
      if (match) colorId = match.colorId;
    }

    // Step 2: Create the calendar event (with color)
    const event = await createEvent(family.googleTokens, family.calendarId, {
      ...parsed,
      timezone,
      colorId,
    });

    // Step 3: Build confirmation
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

    res.json({
      success: true,
      message: `✓ Added "${parsed.title}" — ${dateStr} at ${timeStr}`,
      eventLink: event.htmlLink,
      parsed,
    });
  } catch (err) {
    console.error('[API] test-sms error:', err.message);
    if (err.code === 401 || err.message.includes('invalid_grant')) {
      return res.status(401).json({
        error: 'Google Calendar token expired. Please reconnect your calendar in Settings.',
      });
    }
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
