/**
 * lib/calendar.js — Google Calendar API integration
 *
 * Handles OAuth flow and event creation.
 * Scopes requested: calendar.events (write events) + userinfo.email (get user's email)
 */

const { google } = require('googleapis');

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

/**
 * Generate the Google OAuth authorization URL.
 * @param {string} state - Passed through OAuth flow (we use it to carry familyId)
 */
function getAuthUrl(state = 'new') {
  const oauth2Client = getOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    prompt: 'consent', // Force consent screen so we always get refresh_token
    state: String(state),
  });
}

/**
 * Exchange an authorization code for access + refresh tokens.
 */
async function exchangeCodeForTokens(code) {
  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

/**
 * Get the authenticated user's email address.
 */
async function getUserEmail(tokens) {
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const { data } = await oauth2.userinfo.get();
  return data.email;
}

/**
 * List all calendars for a user (so they can pick which one to use).
 */
async function listCalendars(tokens) {
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials(tokens);
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  const response = await calendar.calendarList.list();
  return response.data.items
    .filter((cal) => cal.accessRole === 'owner' || cal.accessRole === 'writer')
    .map((cal) => ({
      id: cal.id,
      name: cal.summary,
      primary: cal.primary || false,
      color: cal.backgroundColor || '#4285F4',
    }));
}

/**
 * Create a calendar event.
 *
 * @param {Object} tokens - Google OAuth tokens (access_token, refresh_token, expiry_date)
 * @param {string} calendarId - Calendar ID (use 'primary' for default)
 * @param {Object} event - Event data from Claude parser
 * @param {string} event.title
 * @param {string} event.date - "YYYY-MM-DD"
 * @param {string} event.startTime - "HH:MM"
 * @param {string} event.endTime - "HH:MM"
 * @param {string} event.description
 * @param {string} event.timezone
 * @param {string} [event.colorId] - Google Calendar color ID (1–11). Represents WHO the event is for.
 *   1=tomato/red  2=flamingo/pink  3=tangerine/orange  4=banana/yellow
 *   5=sage/green  6=basil/dark-green  7=peacock/blue  8=blueberry/dark-blue
 *   9=lavender  10=grape/purple  11=graphite/gray
 * @returns {Object} Created Google Calendar event
 */
async function createEvent(tokens, calendarId, event) {
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials(tokens);

  // Handle token refresh automatically
  oauth2Client.on('tokens', (newTokens) => {
    // Token was refreshed — caller should persist updated tokens
    // For MVP we update in-memory; for production persist to DB
    if (newTokens.access_token) {
      tokens.access_token = newTokens.access_token;
    }
    if (newTokens.expiry_date) {
      tokens.expiry_date = newTokens.expiry_date;
    }
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  const tz = event.timezone || 'America/Los_Angeles';

  const resource = {
    summary: event.title,
    start: {
      dateTime: `${event.date}T${event.startTime}:00`,
      timeZone: tz,
    },
    end: {
      dateTime: `${event.date}T${event.endTime}:00`,
      timeZone: tz,
    },
    source: {
      title: 'Text-to-Calendar',
      url: process.env.BASE_URL || 'https://text-to-calendar.vercel.app',
    },
  };

  if (event.location) {
    resource.location = event.location;
  }

  if (event.description) {
    resource.description = event.description;
  }

  // Apply person color if provided (colorId must be a string "1"–"11")
  if (event.colorId) {
    resource.colorId = String(event.colorId);
  }

  const response = await calendar.events.insert({
    calendarId: calendarId || 'primary',
    resource,
  });

  return response.data;
}

module.exports = {
  getAuthUrl,
  exchangeCodeForTokens,
  getUserEmail,
  listCalendars,
  createEvent,
};
