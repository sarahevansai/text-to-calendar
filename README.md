# 🗓️ Text-to-Calendar

**Your family calendar, one text away.**

Text a phone number to add events to a shared Google Calendar. No app. No login. Just text.

```
You text:   "dentist wednesday 3:30pm"
You get:    "✓ Added 'Dentist Appointment' to Evans Family
            📅 Wednesday, March 19 at 3:30 PM"
```

Built with Node.js + Express + Twilio + Claude (Anthropic) + Google Calendar.

---

## Features

- 📱 **Text naturally** — "Grammy coming Saturday 10am" just works
- 🧠 **AI-powered parsing** — Claude understands dates, times, and context
- 📅 **Google Calendar sync** — Events appear instantly
- 👨‍👩‍👧 **Whole family** — Add multiple phone numbers, anyone can text in events
- ✅ **Confirmation reply** — Get a text back with exactly what was added
- 🔒 **Secure** — Twilio signature verification, Google OAuth
- 🌐 **Open source** — MIT license, fork and self-host

---

## Quick Start

### Prerequisites

- Node.js 18+
- A [Twilio account](https://twilio.com) (free trial works)
- A [Google Cloud Console](https://console.cloud.google.com) project
- An [Anthropic API key](https://console.anthropic.com)

### 1. Clone and install

```bash
git clone https://github.com/sarahevansai/text-to-calendar.git
cd text-to-calendar
npm install
```

### 2. Set up environment variables

```bash
cp .env.example .env
```

Fill in your `.env` file (see setup guides below).

### 3. Start the server

```bash
npm run dev   # Development (with auto-reload)
npm start     # Production
```

Visit `http://localhost:3000` → click **Get Started** → follow the 4-step setup.

---

## Setup Guides

### 🔑 Anthropic API Key (2 min)

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Sign up or log in
3. Go to **API Keys** → click **Create Key**
4. Copy the key → paste into `.env` as `ANTHROPIC_API_KEY`

Cost: Claude Haiku is ~$0.001 per SMS. Very cheap.

---

### 📱 Twilio Setup (5 min)

1. **Sign up** at [twilio.com](https://twilio.com) — free trial gives you $15 credit
2. **Get a phone number:**
   - Dashboard → **Phone Numbers** → **Manage** → **Buy a Number**
   - Choose a US number (free on trial)
   - Click **Buy**
3. **Set up the webhook:**
   - Click your phone number
   - Under **Messaging**, find **"A Message Comes In"**
   - Set it to: `https://your-app-url.vercel.app/sms/webhook`
   - Method: **HTTP POST**
   - Save
4. **Get your credentials:**
   - Dashboard → top of page → **Account SID** and **Auth Token**
   - Copy both into `.env`

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+15551234567
```

**Note:** During local development, set `SKIP_TWILIO_VALIDATION=true` so webhook signature checks are skipped. Remove this in production.

**Testing locally with Twilio:**
Use [ngrok](https://ngrok.com) to expose your local server:
```bash
ngrok http 3000
# Set Twilio webhook to: https://abc123.ngrok.io/sms/webhook
```

---

### 📅 Google Calendar OAuth Setup (5 min)

1. **Create a Google Cloud project:**
   - Go to [console.cloud.google.com](https://console.cloud.google.com)
   - Click **Select a project** → **New Project** → name it "Text-to-Calendar"

2. **Enable the Calendar API:**
   - Left menu → **APIs & Services** → **Enable APIs and Services**
   - Search "Google Calendar API" → Enable

3. **Create OAuth 2.0 credentials:**
   - Left menu → **APIs & Services** → **Credentials**
   - Click **+ Create Credentials** → **OAuth 2.0 Client IDs**
   - Application type: **Web application**
   - Name: "Text-to-Calendar"
   - Under **Authorized redirect URIs**, add:
     - `http://localhost:3000/auth/google/callback` (local dev)
     - `https://your-app.vercel.app/auth/google/callback` (production)
   - Click **Create**
   - Copy Client ID and Client Secret

4. **Configure consent screen** (if prompted):
   - User Type: **External**
   - App name: "Text-to-Calendar"
   - Add scopes: `calendar.events` and `userinfo.email`
   - Add your email as a test user

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
```

---

### 🚀 Deploy to Vercel (2 min)

#### Option A: One-click (after forking)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/sarahevansai/text-to-calendar)

After deploying, add all environment variables in Vercel's dashboard.

#### Option B: Manual CLI

```bash
npm install -g vercel
vercel login
vercel --prod
```

**Important Vercel notes:**

1. Set all environment variables in Vercel dashboard under **Settings → Environment Variables**
2. Update `GOOGLE_REDIRECT_URI` to your Vercel URL
3. Update Twilio webhook URL to your Vercel URL + `/sms/webhook`
4. Update `BASE_URL` to your Vercel URL

**⚠️ Database on Vercel:** Vercel's serverless functions don't have persistent file storage. For production, upgrade to Supabase (see below).

---

### 🗃️ Upgrading to Supabase (production database)

The default JSON file storage works great locally but not on Vercel. Here's how to add Supabase:

1. Create a free account at [supabase.com](https://supabase.com)
2. Create a new project
3. Run this SQL in the Supabase SQL editor:

```sql
create table families (
  id uuid default gen_random_uuid() primary key,
  email text unique not null,
  name text,
  calendar_id text default 'primary',
  google_tokens jsonb,
  twilio_number text,
  timezone text default 'America/Los_Angeles',
  active boolean default true,
  created_at timestamptz default now()
);

create table family_members (
  id uuid default gen_random_uuid() primary key,
  family_id uuid references families(id) on delete cascade,
  name text not null,
  phone text not null,
  added_at timestamptz default now(),
  unique(family_id, phone)
);
```

4. Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` to your `.env`
5. Swap `lib/db.js` with `lib/db-supabase.js` (see the file — already written)

---

## How It Works

```
SMS arrives at Twilio phone number
        ↓
Twilio POSTs to /sms/webhook
        ↓
We validate the Twilio signature
        ↓
Look up sender's phone → find their family
        ↓
Send message to Claude for parsing
"dentist wednesday 3:30pm"
        → { title: "Dentist Appointment", date: "2025-03-19", startTime: "15:30", endTime: "16:30" }
        ↓
Create event via Google Calendar API
        ↓
Reply via Twilio SMS:
"✓ Added 'Dentist Appointment' to Evans Family
📅 Wednesday, March 19 at 3:30 PM"
```

---

## Project Structure

```
text-to-calendar/
├── server.js              # Main Express server
├── routes/
│   ├── sms.js             # Twilio webhook (/sms/webhook)
│   ├── auth.js            # Google OAuth flow (/auth/google)
│   └── api.js             # REST API for dashboard
├── lib/
│   ├── claude.js          # Claude NLP event parser
│   ├── calendar.js        # Google Calendar API
│   └── db.js              # JSON file database
├── public/
│   ├── index.html         # Landing page
│   ├── setup.html         # 4-step setup wizard
│   ├── dashboard.html     # Family dashboard
│   ├── settings.html      # Settings page
│   └── css/style.css      # Styles
├── data/
│   └── db.json            # Created automatically (gitignored)
├── .env.example           # Config template
├── vercel.json            # Vercel deployment config
└── README.md
```

---

## API Reference

### SMS Webhook
`POST /sms/webhook` — Twilio calls this when SMS is received

### Auth
- `GET /auth/google` — Start Google OAuth
- `GET /auth/google/callback` — OAuth callback
- `GET /auth/calendars?familyId=xxx` — List user's calendars

### Family API
- `GET /api/family/:id` — Get family info
- `PUT /api/family/:id` — Update name/timezone/active
- `POST /api/family/:id/members` — Add member `{ name, phone }`
- `DELETE /api/family/:id/members/:memberId` — Remove member
- `POST /api/family/:id/calendar` — Change calendar `{ calendarId }`
- `POST /api/family/:id/test-sms` — Test parse + create event `{ message }`
- `POST /api/parse` — Just parse a message (no event created) `{ message }`

---

## What to Text

| You text | What gets added |
|----------|-----------------|
| `dentist wednesday 3:30pm` | Dentist Appointment · Wed 3:30 PM |
| `Grammy coming Saturday 10am` | Grammy Visit · Sat 10:00 AM |
| `soccer thursday 4pm 2 hours` | Soccer Practice · Thu 4:00–6:00 PM |
| `dinner with mom friday 7pm` | Dinner with Mom · Fri 7:00 PM |
| `doctor tomorrow 9am` | Doctor Appointment · Tomorrow 9:00 AM |
| `meeting march 20 2pm` | Meeting · Mar 20 2:00 PM |

---

## Testing Sarah's Setup Checklist

Before texting for the first time, verify:

- [ ] Server running (`npm run dev`)
- [ ] `.env` filled in with Anthropic + Twilio + Google credentials
- [ ] Google OAuth completed (went through `/setup`, connected Google Calendar)
- [ ] Your phone number added as a family member in the dashboard
- [ ] Twilio webhook pointing to your ngrok URL (local) or Vercel URL (production)
- [ ] Test with the dashboard "Test It Out" button first (no Twilio needed)
- [ ] Then text the Twilio number from your phone

---

## Troubleshooting

**"You're not registered" reply**
→ Your phone number isn't in the family members list. Add it in the dashboard.

**"Calendar connection issue" reply**
→ Google OAuth token expired. Go to Settings → Reconnect Google.

**No reply at all**
→ Check Twilio webhook URL is correct and server is running. Check server logs.

**Events not showing in Google Calendar**
→ Check you selected the right calendar in setup. Check Google Calendar is enabled in Google Cloud Console.

**"Couldn't understand that event"**
→ Try a clearer format: "dentist wednesday 3pm" works reliably.

**Vercel deployment issues**
→ Make sure all env vars are set in Vercel dashboard. Check function logs in Vercel dashboard.

---

## Contributing

PRs welcome! This is open source.

Ideas for Phase 2:
- [ ] Supabase adapter (persistent DB for Vercel)
- [ ] Recurring events ("every tuesday soccer 4pm")
- [ ] Multi-calendar support per family
- [ ] Stripe billing ($5/month per family)
- [ ] Event deletion ("cancel dentist wednesday")
- [ ] Event listing ("what's on my calendar this week")

---

## License

MIT — fork it, use it, build on it.

---

Built with ❤️ by [Sarah Evans](https://github.com/sarahevansai)
