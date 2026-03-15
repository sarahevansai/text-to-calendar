/**
 * lib/db.js — Simple JSON file database for MVP
 *
 * For production on Vercel (serverless), switch to Supabase:
 *   See README.md → "Upgrading to Supabase"
 *
 * Data structure:
 * {
 *   families: [{
 *     id, email, name, calendarId, googleTokens,
 *     twilioNumber, timezone, active, createdAt,
 *     members: [{ id, name, phone, addedAt }]
 *   }]
 * }
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/db.json');

function ensureDB() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    const initial = { families: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { families: [] };
  }
}

function saveDB(data) {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ---- Normalization ----

function normalizePhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
  return `+${digits}`;
}

// ---- Family CRUD ----

function createFamily({ email, name, calendarId, googleTokens, timezone }) {
  const db = ensureDB();
  const family = {
    id: uuidv4(),
    email,
    name: name || `${email.split('@')[0].replace(/[^a-zA-Z]/g, ' ').trim()}'s Family`,
    calendarId: calendarId || 'primary',
    googleTokens,
    twilioNumber: process.env.TWILIO_PHONE_NUMBER || '',
    timezone: timezone || 'America/Los_Angeles',
    active: true,
    members: [],
    createdAt: new Date().toISOString(),
  };
  db.families.push(family);
  saveDB(db);
  return family;
}

function getFamilyById(id) {
  const db = ensureDB();
  return db.families.find((f) => f.id === id) || null;
}

function getFamilyByEmail(email) {
  const db = ensureDB();
  return db.families.find((f) => f.email === email) || null;
}

/**
 * Look up family by a member's phone number.
 * This is how we route incoming SMS to the right calendar.
 */
function getFamilyByPhone(phone) {
  const db = ensureDB();
  const normalized = normalizePhone(phone);
  return (
    db.families.find((f) =>
      f.members.some((m) => normalizePhone(m.phone) === normalized)
    ) || null
  );
}

function updateFamily(id, updates) {
  const db = ensureDB();
  const idx = db.families.findIndex((f) => f.id === id);
  if (idx === -1) return null;
  // Never overwrite members array via this function
  const { members, ...safeUpdates } = updates;
  db.families[idx] = { ...db.families[idx], ...safeUpdates };
  saveDB(db);
  return db.families[idx];
}

// ---- Member CRUD ----

function addMember(familyId, { name, phone }) {
  const db = ensureDB();
  const idx = db.families.findIndex((f) => f.id === familyId);
  if (idx === -1) return null;

  const normalized = normalizePhone(phone);

  // Prevent duplicate phone numbers in the same family
  const exists = db.families[idx].members.some(
    (m) => normalizePhone(m.phone) === normalized
  );
  if (exists) {
    throw new Error('This phone number is already in your family.');
  }

  const member = {
    id: uuidv4(),
    name: name.trim(),
    phone: normalized,
    addedAt: new Date().toISOString(),
  };
  db.families[idx].members.push(member);
  saveDB(db);
  return member;
}

function removeMember(familyId, memberId) {
  const db = ensureDB();
  const idx = db.families.findIndex((f) => f.id === familyId);
  if (idx === -1) return false;
  const before = db.families[idx].members.length;
  db.families[idx].members = db.families[idx].members.filter(
    (m) => m.id !== memberId
  );
  saveDB(db);
  return db.families[idx].members.length < before;
}

module.exports = {
  createFamily,
  getFamilyById,
  getFamilyByEmail,
  getFamilyByPhone,
  updateFamily,
  addMember,
  removeMember,
  normalizePhone,
};
