/**
 * lib/claude.js — Natural language event parser using Claude
 *
 * Takes a raw SMS message like "add dentist wednesday 3:30pm"
 * and returns a structured event object ready for Google Calendar.
 *
 * Also detects WHO the event is for (e.g. "Jake's dentist" → forPerson: "Jake")
 */

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Parse an SMS message into a structured calendar event.
 * @param {string} message - Raw SMS text
 * @param {string} timezone - IANA timezone (e.g. "America/Los_Angeles")
 * @param {Array<{name: string, phone: string}>} [members] - Known family members for person detection
 * @returns {Object} Parsed event or { isEvent: false, error: string }
 */
async function parseEventFromSMS(message, timezone = 'America/Los_Angeles', members = []) {
  const now = new Date();

  // Get today in the user's timezone for accurate relative date parsing
  const todayISO = now.toLocaleDateString('en-CA', { timeZone: timezone }); // "YYYY-MM-DD"
  const todayLong = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: timezone,
  });
  const dayOfWeek = now.toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: timezone,
  });

  // Build a list of known family member names for Claude to match against
  const memberNamesSection = members.length > 0
    ? `Known family members: ${members.map((m) => m.name).join(', ')}\n`
    : '';

  const prompt = `You are a calendar assistant. Parse the following SMS message into a calendar event.

Today is ${todayLong} (ISO: ${todayISO}), which is a ${dayOfWeek}.
User timezone: ${timezone}
${memberNamesSection}
SMS: "${message}"

Return ONLY a JSON object — no markdown, no code blocks, no explanation. Just raw JSON.

If this IS a calendar event:
{
  "isEvent": true,
  "title": "Clean event title (e.g. 'Dentist Appointment', 'Grammy Visit', 'Soccer Practice')",
  "date": "YYYY-MM-DD",
  "startTime": "HH:MM",
  "endTime": "HH:MM",
  "description": "any extra context from the message, or empty string",
  "confidence": "high | medium | low",
  "forPerson": "Name of the person this event is FOR, or null if not detected"
}

If this is NOT a calendar event (e.g. a question, a reminder to self, random text):
{
  "isEvent": false,
  "error": "Brief friendly explanation"
}

For "forPerson": detect whose event this is based on possessive names or "for X" patterns.
- "Jake's dentist wednesday 3pm" → forPerson: "Jake"
- "dentist for Jake wednesday 3pm" → forPerson: "Jake"
- "Emma's soccer practice thursday" → forPerson: "Emma"
- "add dentist wednesday 3pm" → forPerson: null (no person mentioned)
- "dentist appointment for me wednesday" → forPerson: null (self-reference, not a name)
If known family members are listed, try to match the detected name to the closest match (case-insensitive).
Return null if no specific person is mentioned.

Date parsing rules:
- "wednesday" or "this wednesday" → next upcoming Wednesday from today (if today IS Wednesday, use next week)
- "next wednesday" → the Wednesday after the next upcoming one
- "saturday" → next upcoming Saturday
- "tomorrow" → ${todayISO} + 1 day (calculate the actual date)
- "today" → ${todayISO}
- Specific dates like "March 20" or "3/20" → parse as given (use current year)

Time parsing rules:
- "3:30pm" → 15:30 → startTime: "15:30", endTime: "16:30"
- "3pm" → 15:00 → startTime: "15:00", endTime: "16:00"  
- "10am" → 10:00 → startTime: "10:00", endTime: "11:00"
- If NO time given → startTime: "09:00", endTime: "10:00"
- Duration: default 1 hour. If "2 hours" or "90 min" in message, adjust endTime

Title rules:
- Capitalize properly: "dentist" → "Dentist Appointment"
- "Grammy coming" → "Grammy Visit"
- "dinner with mom" → "Dinner with Mom"
- "soccer practice" → "Soccer Practice"
- Be natural and human-readable
- Do NOT include the person's name in the title (keep it clean; the event color shows who it's for)

Examples:
- "add dentist wednesday 3:30pm" → title: "Dentist Appointment", forPerson: null
- "Jake's dentist wednesday 3pm" → title: "Dentist Appointment", forPerson: "Jake"
- "dentist for Emma thursday 2pm" → title: "Dentist Appointment", forPerson: "Emma"
- "Grammy coming Saturday 10am" → title: "Grammy Visit", forPerson: null
- "soccer thursday 4pm 2 hours" → title: "Soccer Practice", 16:00-18:00, forPerson: null
- "dinner with mom friday 7pm" → title: "Dinner with Mom", 19:00-20:00, forPerson: null
- "what time is it" → isEvent: false`;

  try {
    const response = await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text.trim();

    // Strip markdown code blocks if they sneak in
    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    const parsed = JSON.parse(cleaned);

    // Validate required fields for events
    if (parsed.isEvent) {
      if (!parsed.date || !parsed.startTime || !parsed.endTime || !parsed.title) {
        throw new Error('Incomplete event data returned by parser');
      }
      // Normalize forPerson: ensure it's null or a string
      if (parsed.forPerson === undefined || parsed.forPerson === '') {
        parsed.forPerson = null;
      }
    }

    return parsed;
  } catch (error) {
    console.error('Claude parsing error:', error.message);

    if (error instanceof SyntaxError) {
      throw new Error(
        'Parser returned invalid data. Please try rephrasing: "dentist wednesday 3pm"'
      );
    }
    throw error;
  }
}

module.exports = { parseEventFromSMS };
