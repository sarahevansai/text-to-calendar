/**
 * routes/auth.js — Google OAuth flow
 *
 * GET  /auth/google           → Redirect to Google consent screen
 * GET  /auth/google/callback  → Handle OAuth callback, create/update family
 * GET  /auth/calendars        → List user's calendars (after OAuth)
 */

const express = require('express');
const router = express.Router();
const {
  getAuthUrl,
  exchangeCodeForTokens,
  getUserEmail,
  listCalendars,
} = require('../lib/calendar');
const { createFamily, getFamilyByEmail, updateFamily, getFamilyById } = require('../lib/db');

// Step 1: Kick off Google OAuth
// Query params:
//   ?familyId=xxx  → reconnecting an existing family (token refresh)
//   (none)         → new signup
router.get('/google', (req, res) => {
  const { familyId } = req.query;
  const state = familyId || 'new';
  const authUrl = getAuthUrl(state);
  res.redirect(authUrl);
});

// Step 2: Google redirects back here with ?code=...
router.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    console.error('[Auth] Google OAuth error:', error);
    return res.redirect(`/setup?error=${encodeURIComponent('Google sign-in was cancelled or failed.')}`);
  }

  if (!code) {
    return res.redirect('/setup?error=' + encodeURIComponent('No authorization code received.'));
  }

  try {
    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code);
    const email = await getUserEmail(tokens);

    let family;

    if (state && state !== 'new') {
      // Reconnecting an existing family
      family = getFamilyById(state);
      if (family) {
        family = updateFamily(family.id, { googleTokens: tokens, email });
        console.log(`[Auth] Reconnected Google Calendar for family ${family.id}`);
        return res.redirect(`/dashboard?familyId=${family.id}&reconnected=1`);
      }
    }

    // Check if this email already has a family
    family = getFamilyByEmail(email);
    if (family) {
      // Refresh their tokens
      family = updateFamily(family.id, { googleTokens: tokens });
      console.log(`[Auth] Updated tokens for returning family ${family.id}`);
      return res.redirect(`/dashboard?familyId=${family.id}`);
    }

    // New signup — create the family
    family = createFamily({ email, googleTokens: tokens });
    console.log(`[Auth] Created new family ${family.id} for ${email}`);

    // Send to setup step 2 (choose calendar)
    res.redirect(`/setup?step=calendar&familyId=${family.id}`);
  } catch (err) {
    console.error('[Auth] OAuth callback error:', err.message);
    res.redirect(`/setup?error=${encodeURIComponent('Setup failed: ' + err.message)}`);
  }
});

// GET /auth/calendars?familyId=xxx
// Returns the user's available Google Calendars so they can choose one
router.get('/calendars', async (req, res) => {
  const { familyId } = req.query;

  if (!familyId) {
    return res.status(400).json({ error: 'familyId is required' });
  }

  const family = getFamilyById(familyId);
  if (!family) {
    return res.status(404).json({ error: 'Family not found' });
  }

  if (!family.googleTokens) {
    return res.status(401).json({ error: 'Google Calendar not connected' });
  }

  try {
    const calendars = await listCalendars(family.googleTokens);
    res.json({ calendars });
  } catch (err) {
    console.error('[Auth] List calendars error:', err.message);
    if (err.code === 401 || err.message.includes('invalid_grant')) {
      res.status(401).json({ error: 'Google Calendar token expired. Please reconnect.' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

module.exports = router;
