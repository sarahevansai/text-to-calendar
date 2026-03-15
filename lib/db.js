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
 *     members: [{ id, name, phone, colorId, addedAt }]
 *   }]
 * }
 *
 * Google Calendar colorIds:
 *   1=tomato/red  2=flamingo/pink  3=tangerine/orange  4=banana/yellow
 *   5=sage/green  6=basil/dark-green  7=peacock/blue  8=blueberry/dark-blue
 *   9=lavender  10=grape/purple  11=graphite/gray
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/db.json');

// Default color cycle for auto-assigning to new members
const DEFAULT_COLOR_CYCLE = ['1', '7', '5', '4', '3', '9', '10', '2', '6', '8', '11'];

// Map colorId → friendly emoji for SMS confirmations
const COLOR_EMOJIS = {
  '1': '🔴',
  '2': '🌸',
  '3': '🟠',
  '4': '🟡',
  '5': '🟢',
  '6': '🌿',
  '7': '🔵',
  '8': '🫐',
  '9': '💜',
  '10': '🟣',
  '11': '⚫',
};

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

/**
 * Look up the specific member record for a given phone number within a family.
 */
function getMemberByPhone(family, phone) {
  const normalized = normalizePhone(phone);
  return family.members.find((m) => normalizePhone(m.phone) === normalized) || null;
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

/**
 * Add a family member.
 * @param {string} familyId
 * @param {Object} opts
 * @param {string} opts.name
 * @param {string} opts.phone
 * @param {string} [opts.colorId] - Google Calendar color ID (1-11). Auto-assigned if omitted.
 */
function addMember(familyId, { name, phone, colorId }) {
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

  // Auto-assign a color if none given — cycle through the default palette
  let assignedColor = colorId;
  if (!assignedColor) {
    const usedColors = db.families[idx].members.map((m) => m.colorId).filter(Boolean);
    assignedColor = DEFAULT_COLOR_CYCLE.find((c) => !usedColors.includes(c)) || DEFAULT_COLOR_CYCLE[0];
  }

  const member = {
    id: uuidv4(),
    name: name.trim(),
    phone: normalized,
    colorId: String(assignedColor),
    addedAt: new Date().toISOString(),
  };
  db.families[idx].members.push(member);
  saveDB(db);
  return member;
}

/**
 * Update a member's color (or other fields).
 */
function updateMember(familyId, memberId, updates) {
  const db = ensureDB();
  const fidx = db.families.findIndex((f) => f.id === familyId);
  if (fidx === -1) return null;

  const midx = db.families[fidx].members.findIndex((m) => m.id === memberId);
  if (midx === -1) return null;

  const allowed = {};
  if (updates.colorId) allowed.colorId = String(updates.colorId);
  if (updates.name) allowed.name = updates.name.trim();

  db.families[fidx].members[midx] = { ...db.families[fidx].members[midx], ...allowed };
  saveDB(db);
  return db.families[fidx].members[midx];
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
  getMemberByPhone,
  updateFamily,
  addMember,
  updateMember,
  removeMember,
  normalizePhone,
  COLOR_EMOJIS,
  DEFAULT_COLOR_CYCLE,
};
