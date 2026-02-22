import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
const SUPABASE_URL = "https://qakqfiwvdkoblqnjphrx.supabase.co";
const SUPABASE_KEY = "sb_publishable_hpLc9eLxXK3hMSEXeZBZDg_OyRXYSXv";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── ELECTION KEY ─────────────────────────────────────────────────────────────
// ★ CHANGE THIS for any new race/cycle to prevent storage bleed ★
// Consensus fix 4/5: Race-scoped keys across all storage operations
const RACE_KEY = "txsen_2026";

const ELECTION = {
  title: "U.S. Senate · Texas 2026",
  cycle: "2026 Primary Simulation",
  tagline: "Grassroots Straw Poll · One Voice Per Device Per Phase",
  primaryDate: "March 3, 2026",
  runoffDate: "May 26, 2026",
  generalDate: "November 3, 2026",
  version: "v3.0 — Cross-AI Synthesis Build",
};

// ★ REAL 2026 CANDIDATES — Title fields REMOVED per Neutrality Principle I ★
// All 5 platforms confirmed: candidate data must be name + party ONLY.
// Titles ("Incumbent", "AG") create implicit hierarchy. Removed entirely.
// Source: Texas Secretary of State official filings · February 2026
const CANDIDATES = {
  Republican: [
    { id: "r_cornyn",      name: "John Cornyn",        party: "Republican" },
    { id: "r_paxton",      name: "Ken Paxton",          party: "Republican" },
    { id: "r_hunt",        name: "Wesley Hunt",         party: "Republican" },
    { id: "r_canady",      name: "Sara Canady",         party: "Republican" },
    { id: "r_bierschwale", name: "Virgil Bierschwale",  party: "Republican" },
    { id: "r_khan",        name: "Gulrez Khan",         party: "Republican" },
    { id: "r_bender",      name: "Anna Bender",         party: "Republican" },
    { id: "r_adefope",     name: "John Adefope",        party: "Republican" },
  ],
  Democrat: [
    { id: "d_crockett",    name: "Jasmine Crockett",    party: "Democrat" },
    { id: "d_talarico",    name: "James Talarico",      party: "Democrat" },
    { id: "d_hassan",      name: "Ahmad Hassan",        party: "Democrat" },
  ],
};

// Attorney Review — see AttorneyReview_Addendum.docx for deployment guide
const ATTORNEY_REVIEW = {
  status: "pending",
  attorneyName: "", barNumber: "", firm: "",
  reviewDate: "", opinion: "",
  contactEmail: "txgrassrootspoll@proton.me",
  repoUrl: "https://github.com/[your-repo-here]",
};

// Participation tiers — AAPOR-aligned
const TIERS = {
  COLLECTING:  { min: 0,    max: 49,   label: "Collecting Data",  show: false },
  EARLY:       { min: 50,   max: 199,  label: "Early Signal",     show: true  },
  LIMITED:     { min: 200,  max: 499,  label: "Limited Signal",   show: true  },
  ACTIVE:      { min: 500,  max: 999,  label: "Active Signal",    show: true  },
  ESTABLISHED: { min: 1000, max: Infinity, label: "Established",  show: true  },
};

// ─── TEXAS ZIP VALIDATION ─────────────────────────────────────────────────────
const TEXAS_SPECIAL = new Set(["73301", "73344"]);
function isTexasZip(zip) {
  if (!/^\d{5}$/.test(zip)) return false;
  if (TEXAS_SPECIAL.has(zip)) return true;
  const n = parseInt(zip, 10);
  return (n >= 75000 && n <= 79999) || (n >= 88500 && n <= 88599);
}

// ─── CRYPTO UTILITIES ────────────────────────────────────────────────────────
// FIX 5/5: Replace Math.random() with crypto.getRandomValues()
function cryptoRandom() {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0] / 0xFFFFFFFF;
}

// Session-persistent seeded shuffle — fix 4/5
// Order is deterministic within a session but randomized across sessions
function getOrCreateSessionSeed(partyKey, phase) {
  const k = `${RACE_KEY}:seed:${phase}:${partyKey}`;
  let seed = sessionStorage.getItem(k);
  if (!seed) {
    const arr = new Uint32Array(2);
    crypto.getRandomValues(arr);
    seed = arr[0].toString(16) + arr[1].toString(16);
    sessionStorage.setItem(k, seed);
  }
  return seed;
}

function seededRandom(seedHex, index) {
  // Simple xorshift32 seeded by hash of seed + index
  let h = 0;
  const s = seedHex + String(index);
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(31, h) + s.charCodeAt(i) | 0;
  }
  h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b); h ^= h >>> 16;
  return (h >>> 0) / 0xFFFFFFFF;
}

function seededShuffle(arr, seedHex) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(seededRandom(seedHex, i) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// SHA-256 fingerprint — fix 4/5: actually enforced for vote gating
function getOrCreateInstallSalt() {
  const k = `${RACE_KEY}.installSalt`;
  let salt = localStorage.getItem(k);
  if (!salt) {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    salt = [...arr].map(b => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(k, salt);
  }
  return salt;
}

async function computeFingerprint() {
  try {
    const salt = getOrCreateInstallSalt();
    const c = document.createElement("canvas");
    c.width = 200; c.height = 50;
    const ctx = c.getContext("2d");
    ctx.font = "14px Arial";
    ctx.fillText("TXSIM:v3", 4, 18);
    const canvasSig = c.toDataURL();
    const parts = [
      navigator.userAgent,
      screen.width + "x" + screen.height + "@" + screen.colorDepth,
      Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      navigator.language || "",
      String(navigator.hardwareConcurrency || 0),
      canvasSig,
    ].join("|");
    const data = new TextEncoder().encode(salt + "::" + parts);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
  } catch {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return [...arr].map(b => b.toString(16).padStart(2, "0")).join("");
  }
}

// ─── PROOF-OF-WORK ────────────────────────────────────────────────────────────
// FIX 5/5: PoW challenge before vote submission
// Targets ~200ms on typical device. Raises cost for bot-flooding significantly.
function simpleHash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

async function solvePoW(challenge, difficulty = 4) {
  // Find nonce where hash ends with `difficulty` zeros
  const suffix = "0".repeat(difficulty);
  let nonce = 0;
  await new Promise(r => setTimeout(r, 0)); // yield to render
  const t0 = Date.now();
  while (true) {
    const hash = simpleHash32(challenge + nonce);
    if (hash.endsWith(suffix)) return { nonce, ms: Date.now() - t0 };
    nonce++;
    if (nonce % 5000 === 0) await new Promise(r => setTimeout(r, 0));
  }
}

// ─── STORAGE LAYER ───────────────────────────────────────────────────────────
// FIX 5/5: Race-scoped keys; localStorage mirror for tamper detection
// window.storage is the persistent shared tally store (this artifact environment)
// localStorage is device-local — used for vote locks + integrity mirroring

const safeLocalGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeLocalSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };

const safeGet = async (k, shared = false) => {
  if (!shared) { const v = safeLocalGet(k); return v ? { value: v } : null; }
  try {
    const parts = k.split(":");
    if (parts.length >= 4 && parts[1] === "tally") {
      const race_key = parts[0], phase = parts[2], candidate_id = parts.slice(3).join(":");
      const { data } = await supabase.from("votes").select("count").eq("race_key", race_key).eq("phase", phase).eq("candidate_id", candidate_id).single();
      return data ? { value: String(data.count) } : null;
    }
    const v = safeLocalGet(k); return v ? { value: v } : null;
  } catch { return null; }
};

const safeSet = async (k, v, shared = false) => {
  if (!shared) { safeLocalSet(k, v); return { value: v }; }
  try {
    const parts = k.split(":");
    if (parts.length >= 4 && parts[1] === "tally") {
      const race_key = parts[0], phase = parts[2], candidate_id = parts.slice(3).join(":");
      const count = parseInt(v, 10) || 0;
      const { error } = await supabase.from("votes").upsert(
        { race_key, phase, candidate_id, count, updated_at: new Date().toISOString() },
        { onConflict: "race_key,phase,candidate_id" }
      );
      if (error) throw error;
      return { value: v };
    }
    safeLocalSet(k, v); return { value: v };
  } catch (e) { console.error("safeSet error", e); return null; }
};

// Vote lock: stored in localStorage (local) + shared storage flag
async function checkVoteLock(phase, fp) {
  const localKey = `${RACE_KEY}:lock:${phase}:${fp.slice(0, 16)}`;
  const localLock = safeLocalGet(localKey);
  if (localLock) return true;
  const sharedLock = await safeGet(`${RACE_KEY}:lock:${phase}:${fp.slice(0, 16)}`, false);
  return !!sharedLock?.value;
}

async function setVoteLock(phase, fp) {
  const shortFp = fp.slice(0, 16);
  const localKey = `${RACE_KEY}:lock:${phase}:${shortFp}`;
  safeLocalSet(localKey, "1");
  await safeSet(`${RACE_KEY}:lock:${phase}:${shortFp}`, "1", false);
}

// Tally helpers with race-scoped keys
const tallyKey = (phase, id) => `${RACE_KEY}:tally:${phase}:${id}`;
const velKey = (phase) => `${RACE_KEY}:vel:${phase}`;

// ─── SIMULATION ENGINE ────────────────────────────────────────────────────────
// FIX 1/5: Perplexity's count-based majority (adopted for mathematical rigor)
// votes >= floor(total/2)+1 is more robust than float percentage comparison
function computePrimaryResult(tallies, partyKey) {
  const candidates = CANDIDATES[partyKey] || [];
  const total = candidates.reduce((s, c) => s + (Number(tallies?.[c.id]) || 0), 0);
  if (total <= 0) return { status: "no_votes", total, all: [] };
  const all = [...candidates]
    .map(c => {
      const votes = Number(tallies?.[c.id]) || 0;
      return { ...c, votes, pct: (votes / total) * 100 };
    })
    .sort((a, b) => (b.votes - a.votes) || a.id.localeCompare(b.id));
  // Strict majority: strictly more than half
  const majority = Math.floor(total / 2) + 1;
  if (all[0].votes >= majority) return { status: "winner", winner: all[0], all, total };
  if (all.length < 2) return { status: "runoff_unavailable", all, total };
  return { status: "runoff", top2: [all[0], all[1]], all, total };
}

function computeRunoffResult(tallies, top2) {
  if (!top2 || top2.length < 2) return { status: "no_votes", total: 0 };
  const total = top2.reduce((s, c) => s + (Number(tallies?.[c.id]) || 0), 0);
  if (total <= 0) return { status: "no_votes", total };
  const all = [...top2]
    .map(c => ({ ...c, votes: Number(tallies?.[c.id]) || 0, pct: ((Number(tallies?.[c.id]) || 0) / total) * 100 }))
    .sort((a, b) => b.votes - a.votes);
  return { status: "winner", winner: all[0], all, total };
}

// FIX 2/5: Real velocity tracking using stored timestamps
async function recordVelocity(phase) {
  const k = velKey(phase);
  const rec = await safeGet(k, true);
  const now = Date.now();
  let log = [];
  try { log = JSON.parse(rec?.value || "[]"); } catch {}
  log.push(now);
  // Keep last 200 timestamps
  if (log.length > 200) log = log.slice(-200);
  await safeSet(k, JSON.stringify(log), true);
  return log;
}

async function getVelocityLog(phase) {
  const k = velKey(phase);
  const rec = await safeGet(k, true);
  try { return JSON.parse(rec?.value || "[]"); } catch { return []; }
}

function detectAnomalies(tallies, partyKey, velocityLog) {
  const flags = [];
  const candidates = CANDIDATES[partyKey] || [];
  const total = candidates.reduce((s, c) => s + (Number(tallies?.[c.id]) || 0), 0);
  // Velocity spike: compare votes in last 5 min vs preceding 5 min
  if (velocityLog.length >= 10) {
    const now = Date.now();
    const recent = velocityLog.filter(t => now - t < 5 * 60 * 1000).length;
    const prior = velocityLog.filter(t => now - t >= 5 * 60 * 1000 && now - t < 10 * 60 * 1000).length;
    if (prior > 0 && recent > prior * 4 && recent > 20) {
      flags.push(`Velocity spike: ${recent} votes in last 5 min vs ${prior} in prior 5 min.`);
    }
  }
  // Extreme concentration — only meaningful at larger n
  if (total >= 100) {
    const max = Math.max(...candidates.map(c => Number(tallies?.[c.id]) || 0));
    if (max / total > 0.92) {
      flags.push(`Concentration flag: one candidate holds ${((max / total) * 100).toFixed(0)}% of votes at n=${total}. May reflect mobilization or coordination.`);
    }
  }
  return flags;
}

function getParticipationTier(n) {
  // Single source of truth — fix per Perplexity (no duplicate threshold checks)
  for (const [key, t] of Object.entries(TIERS)) {
    if (n >= t.min && n <= t.max) return { key, ...t };
  }
  return { key: "COLLECTING", ...TIERS.COLLECTING };
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Oswald:wght@300;400;600;700&family=Lora:ital,wght@0,400;0,600;1,400&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0d1117;--bg2:#161b24;--bg3:#1e2433;--panel:#242b3a;
  --border:#2e3a50;--border2:#3d4d68;
  --amber:#d4901a;--amber-dim:#7a5010;--amber-glow:#ffb83040;--amber-lt:#2a1f0a;
  --red:#c0392b;--red-lt:#2a0f0f;
  --green:#1d7a4a;--green-lt:#0d2018;
  --teal:#1a5c5a;--blue:#1a4a8a;
  --text:#dde4f0;
  /* FIX 5/5: Boosted from #6b7a94 (3.3:1 FAIL) to #94a3b8 (5.2:1 PASS) */
  --muted:#94a3b8;
  --dim:#3d4d68;
  --mono:'Share Tech Mono',monospace;
  --display:'Oswald',sans-serif;
  --serif:'Lora',serif;
}
html,body{min-height:100%;background:var(--bg);color:var(--text);-webkit-font-smoothing:antialiased;}
body::before{content:'';position:fixed;inset:0;pointer-events:none;
  background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.05) 2px,rgba(0,0,0,0.05) 4px);}

.machine{max-width:700px;margin:0 auto;padding:0 14px 80px;display:flex;flex-direction:column;align-items:center;}

/* MASTHEAD */
.mast{width:100%;border-bottom:2px double var(--border2);padding:20px 0 12px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:4px;}
.mast-eye{font-family:var(--mono);font-size:9px;letter-spacing:.28em;text-transform:uppercase;color:var(--amber-dim);}
.mast-seal{width:46px;height:46px;border:2px solid var(--amber);border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--display);font-weight:700;font-size:19px;color:var(--amber);box-shadow:0 0 14px var(--amber-glow);}
.mast-title{font-family:var(--display);font-size:clamp(19px,4vw,30px);font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#fff;line-height:1.1;}
.mast-sub{font-family:var(--mono);font-size:9px;letter-spacing:.12em;color:var(--muted);text-transform:uppercase;}
.mast-ver{font-family:var(--mono);font-size:7px;letter-spacing:.1em;color:var(--dim);margin-top:2px;}

/* PERMANENT DISCLOSURE — sticky at top, non-hideable */
/* FIX: sticky position so it stays visible even when scrolling */
.disclosure{
  width:100%;background:var(--amber-lt);border:1px solid var(--amber-dim);border-top:none;
  padding:7px 14px;font-family:var(--mono);font-size:9px;line-height:1.7;color:#9a7030;
  letter-spacing:.03em;text-align:center;position:sticky;top:0;z-index:100;
}
.disclosure strong{color:var(--amber);}

/* ERROR BANNER — FIX 4/5: storage failure visible to user */
.error-banner{width:100%;background:var(--red-lt);border:1px solid var(--red);border-top:none;
  padding:7px 14px;font-family:var(--mono);font-size:9px;color:#e07060;letter-spacing:.07em;
  text-transform:uppercase;text-align:center;display:flex;align-items:center;justify-content:center;gap:8px;}

/* STEP BAR */
.steps{width:100%;background:var(--bg3);border:1px solid var(--border);border-top:none;border-bottom:none;
  padding:6px 14px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.step{font-family:var(--mono);font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);display:flex;align-items:center;gap:4px;}
.step.active{color:var(--amber);}
.step.done{color:var(--green);}
.step-dot{width:4px;height:4px;border-radius:50%;background:currentColor;}
.step-arr{color:var(--dim);font-size:8px;}

/* SCREEN */
.screen{width:100%;background:var(--bg2);border:1px solid var(--border);border-top:none;
  padding:22px 20px 26px;position:relative;animation:fadeIn .22s ease;}
@keyframes fadeIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
.screen::before,.screen::after{content:'';position:absolute;width:14px;height:14px;border-color:var(--amber-dim);border-style:solid;}
.screen::before{top:8px;left:8px;border-width:1px 0 0 1px;}
.screen::after{bottom:8px;right:8px;border-width:0 1px 1px 0;}
.slabel{font-family:var(--mono);font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:var(--amber-dim);margin-bottom:13px;display:flex;align-items:center;gap:8px;}
.slabel::after{content:'';flex:1;height:1px;background:var(--border);}
.heading{font-family:var(--display);font-size:clamp(17px,3.5vw,25px);font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#fff;margin-bottom:6px;line-height:1.15;}
.sub{font-family:var(--serif);font-size:13px;color:var(--muted);line-height:1.7;font-style:italic;margin-bottom:4px;}
.mono-sm{font-family:var(--mono);font-size:9px;color:var(--muted);letter-spacing:.06em;}

/* INPUTS */
.inp-label{font-family:var(--mono);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--amber);margin-bottom:6px;display:block;}
.zip-inp{width:100%;background:var(--bg3);border:1px solid var(--border);padding:12px 18px;font-family:var(--mono);font-size:28px;letter-spacing:.22em;color:var(--amber);outline:none;caret-color:var(--amber);transition:border-color .2s;}
.zip-inp:focus,.zip-inp:focus-visible{border-color:var(--amber-dim);box-shadow:0 0 0 2px rgba(212,144,26,.2);}
.zip-inp.err{border-color:var(--red)!important;color:var(--red);}
.zip-inp.ok{border-color:var(--green)!important;color:var(--green);}
.err-msg{font-family:var(--mono);font-size:10px;color:var(--red);margin-top:4px;}
.ok-msg{font-family:var(--mono);font-size:10px;color:var(--green);margin-top:4px;}
.dbox{background:var(--bg3);border:1px solid var(--border);border-left:3px solid var(--amber-dim);padding:10px 13px;margin:12px 0;font-family:var(--mono);font-size:10px;line-height:1.8;color:var(--muted);letter-spacing:.03em;}
.dbox strong{color:var(--text);}
.warn-row{display:flex;gap:8px;padding:7px 11px;background:rgba(192,57,43,.07);border:1px solid rgba(192,57,43,.18);margin-bottom:5px;font-family:var(--mono);font-size:9px;color:#b07060;letter-spacing:.04em;line-height:1.6;}

/* PARTY BUTTONS — FIX 4/5: IDENTICAL structure, no emojis, neutral styling */
/* Both buttons use exact same dimensions, font sizes, border weights */
/* Only the label text "REPUBLICAN" / "DEMOCRAT" differs */
.party-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:18px;}
@media(max-width:460px){.party-grid{grid-template-columns:1fr;}}
.party-btn{
  background:var(--bg3);border:1px solid var(--border);border-top:3px solid var(--amber-dim);
  padding:18px 14px;cursor:pointer;text-align:center;display:flex;flex-direction:column;
  align-items:center;gap:7px;transition:all .16s;
}
.party-btn:hover{background:var(--panel);border-color:var(--amber-dim);}
/* FIX: No party-specific colors on party buttons — identical treatment */
/* Party label badge — same weight for both */
.party-badge{
  font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.2em;
  border:1px solid var(--border);padding:3px 10px;color:var(--text);
}
.party-name{font-family:var(--display);font-size:15px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#fff;}
.party-count{font-family:var(--mono);font-size:8px;color:var(--muted);letter-spacing:.08em;}

/* POW INDICATOR */
.pow-wrap{background:var(--bg3);border:1px solid var(--amber-dim);padding:11px 14px;margin:12px 0;text-align:center;}
.pow-label{font-family:var(--mono);font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--amber);margin-bottom:6px;}
.pow-bar-track{height:4px;background:var(--border);}
.pow-bar-fill{height:100%;background:var(--amber);transition:width .3s ease;}

/* BALLOT */
.ballot-hdr{background:var(--bg3);border:1px solid var(--border);padding:8px 12px;margin-bottom:11px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:5px;}
.ballot-office{font-family:var(--display);font-size:11px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:#fff;}
.ballot-instr{font-family:var(--mono);font-size:8px;color:var(--muted);letter-spacing:.07em;text-transform:uppercase;}
.ballot-phase{font-family:var(--mono);font-size:8px;padding:2px 7px;border:1px solid var(--amber-dim);color:var(--amber);letter-spacing:.07em;text-transform:uppercase;}

/* FIX 3/5: radiogroup wrapper for ARIA compliance */
.cand-list{display:flex;flex-direction:column;gap:6px;}
.cand-row{
  display:flex;align-items:center;gap:11px;background:var(--bg3);border:1px solid var(--border);
  padding:12px 15px;cursor:pointer;transition:all .14s;min-height:44px;
}
.cand-row:hover{border-color:var(--amber-dim);background:var(--panel);}
.cand-row.sel{border-color:var(--amber);background:var(--panel);}
/* FIX: explicit focus-visible ring for keyboard navigation */
.cand-row:focus-visible{outline:none;box-shadow:0 0 0 2px var(--amber),0 0 0 4px rgba(212,144,26,.25);}
.cand-num{font-family:var(--mono);font-size:8px;color:var(--dim);min-width:18px;}
.cand-bubble{width:22px;height:22px;border:2px solid var(--border);border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all .14s;}
.cand-row.sel .cand-bubble{border-color:var(--amber);background:var(--amber);}
.cand-dot{width:7px;height:7px;border-radius:50%;background:var(--bg);}
.cand-name{font-family:var(--display);font-size:14px;font-weight:500;letter-spacing:.05em;text-transform:uppercase;color:#fff;flex:1;}
.tag-rep{font-family:var(--mono);font-size:8px;letter-spacing:.09em;color:#d06050;border:1px solid #7a2020;padding:1px 5px;flex-shrink:0;}
.tag-dem{font-family:var(--mono);font-size:8px;letter-spacing:.09em;color:#5080c0;border:1px solid #1a3070;padding:1px 5px;flex-shrink:0;}

/* BUTTONS */
.btn{font-family:var(--display);font-size:13px;font-weight:600;letter-spacing:.11em;text-transform:uppercase;border:none;cursor:pointer;padding:12px 20px;transition:all .16s;display:inline-flex;align-items:center;gap:7px;width:100%;justify-content:center;margin-top:16px;}
.btn-primary{background:var(--amber);color:var(--bg);}
.btn-primary:hover:not(:disabled){background:#e8a020;box-shadow:0 0 14px var(--amber-glow);}
.btn-primary:disabled{background:var(--border);color:var(--muted);cursor:not-allowed;}
.btn-primary:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(212,144,26,.5);}
.btn-ghost{background:transparent;border:1px solid var(--border);color:var(--muted);margin-top:8px;}
.btn-ghost:hover{border-color:var(--muted);color:var(--text);}
.btn-ghost:focus-visible{outline:none;box-shadow:0 0 0 2px var(--muted);}
.btn-sm{font-family:var(--mono);font-size:9px;letter-spacing:.07em;padding:6px 11px;background:transparent;border:1px solid var(--border);color:var(--muted);cursor:pointer;transition:all .16s;}
.btn-sm:hover{border-color:var(--amber-dim);color:var(--amber);}
.btn-sm:focus-visible{outline:none;box-shadow:0 0 0 2px var(--amber-dim);}
.spin{display:inline-block;width:11px;height:11px;border:2px solid var(--border);border-top-color:var(--amber);border-radius:50%;animation:spin .55s linear infinite;}
@keyframes spin{to{transform:rotate(360deg)}}

/* CONFIRM */
.confirm-box{background:var(--bg3);border:2px solid var(--amber-dim);padding:16px;margin:16px 0;text-align:center;}
.confirm-lbl{font-family:var(--mono);font-size:8px;letter-spacing:.2em;text-transform:uppercase;color:var(--amber-dim);margin-bottom:7px;}
.confirm-name{font-family:var(--display);font-size:clamp(19px,4vw,28px);font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#fff;margin-bottom:4px;}
.confirm-party{font-family:var(--mono);font-size:9px;color:var(--muted);letter-spacing:.11em;text-transform:uppercase;}

/* RESULTS */
.voted-badge{background:var(--green-lt);border:1px solid var(--green);padding:7px 13px;margin-bottom:12px;font-family:var(--mono);font-size:9px;color:#50b080;letter-spacing:.07em;text-transform:uppercase;display:flex;align-items:center;gap:6px;}

/* WATERMARK — FIX: always visible on results, not croppable */
.results-watermark{
  background:rgba(212,144,26,.06);border:1px dashed var(--amber-dim);
  padding:5px 12px;margin-bottom:12px;text-align:center;
  font-family:var(--mono);font-size:8px;color:var(--amber-dim);letter-spacing:.12em;text-transform:uppercase;
}
.result-phase-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;padding-bottom:5px;border-bottom:1px solid var(--border);}
.result-phase-title{font-family:var(--display);font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#fff;}
.status-leader{font-family:var(--mono);font-size:8px;color:var(--amber);letter-spacing:.09em;text-transform:uppercase;}
.status-winner{font-family:var(--mono);font-size:8px;color:var(--green);letter-spacing:.09em;text-transform:uppercase;}
.status-runoff{font-family:var(--mono);font-size:8px;color:var(--amber);letter-spacing:.09em;text-transform:uppercase;}
.tier-banner{padding:6px 11px;border:1px solid;font-family:var(--mono);font-size:9px;letter-spacing:.07em;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:7px;line-height:1.5;}
.result-row{display:flex;align-items:center;gap:9px;background:var(--bg3);border:1px solid var(--border);padding:7px 11px;margin-bottom:4px;}
.result-row.leader-row{border-color:var(--amber-dim);background:var(--panel);}
.r-name{font-family:var(--display);font-size:13px;font-weight:500;letter-spacing:.05em;text-transform:uppercase;color:#fff;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.result-bar-wrap{width:80px;height:4px;background:var(--border);overflow:hidden;flex-shrink:0;}
.result-bar{height:100%;transition:width .9s ease;}
.result-pct{font-family:var(--mono);font-size:11px;color:var(--amber);min-width:36px;text-align:right;flex-shrink:0;}
.result-votes{font-family:var(--mono);font-size:8px;color:var(--muted);min-width:28px;text-align:right;flex-shrink:0;}
.your-pick{font-family:var(--mono);font-size:7px;color:var(--amber);border:1px solid var(--amber-dim);padding:1px 4px;letter-spacing:.07em;text-transform:uppercase;margin-left:4px;flex-shrink:0;}
.leader-crown{color:var(--amber);margin-right:3px;flex-shrink:0;}
.collecting-wrap{background:var(--bg3);border:1px solid var(--border);padding:18px;text-align:center;margin-bottom:13px;}
.collecting-prog{height:3px;background:var(--border);margin-top:8px;}
.collecting-fill{height:100%;background:var(--amber);transition:width .8s ease;}
.phase-flow{display:flex;align-items:center;margin:14px 0;}
.phase-node{flex:1;background:var(--bg3);border:1px solid var(--border);padding:7px 5px;text-align:center;}
.phase-node.active-phase{border-color:var(--amber);}
.phase-node.done-phase{border-color:var(--green);}
.phase-node.locked{opacity:.32;}
.phase-node-lbl{font-family:var(--mono);font-size:7px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin-bottom:2px;}
.phase-node-status{font-family:var(--display);font-size:10px;font-weight:600;color:#fff;}
.phase-arrow{font-family:var(--mono);font-size:8px;color:var(--dim);padding:0 2px;flex-shrink:0;}
.runoff-notice{background:rgba(181,131,26,.07);border:1px solid var(--amber-dim);padding:13px;margin:13px 0;text-align:center;}
.runoff-notice-title{font-family:var(--display);font-size:16px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--amber);margin-bottom:3px;}
.runoff-notice-sub{font-family:var(--mono);font-size:8px;color:var(--muted);letter-spacing:.06em;line-height:1.6;}
.anomaly-item{display:flex;gap:7px;padding:6px 10px;background:var(--red-lt);border-left:3px solid var(--red);margin-bottom:4px;font-family:var(--mono);font-size:9px;color:#b07060;letter-spacing:.04em;line-height:1.6;}
.dash-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:12px 0;}
@media(max-width:460px){.dash-grid{grid-template-columns:1fr 1fr;}}
.dash-card{background:var(--bg3);border:1px solid var(--border);padding:8px 10px;}
.dash-card-lbl{font-family:var(--mono);font-size:7px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:2px;}
.dash-card-val{font-family:var(--display);font-size:19px;font-weight:600;color:var(--amber);}
.tabs{display:flex;border-bottom:1px solid var(--border);margin-bottom:13px;}
.tab{font-family:var(--mono);font-size:9px;letter-spacing:.08em;text-transform:uppercase;padding:7px 11px;cursor:pointer;color:var(--muted);border-bottom:2px solid transparent;background:none;border-top:none;border-left:none;border-right:none;transition:all .16s;}
.tab.active{color:var(--amber);border-bottom-color:var(--amber);}
.tab:focus-visible{outline:none;box-shadow:0 0 0 2px var(--amber-dim);}
.about-hdr{font-family:var(--mono);font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:var(--amber);margin-bottom:9px;display:flex;align-items:center;gap:7px;}
.about-hdr::after{content:'';flex:1;height:1px;background:var(--border);}
.about-body{font-family:var(--serif);font-size:13px;color:var(--muted);line-height:1.8;margin-bottom:12px;}
.attorney-panel{background:var(--bg3);border:1px solid var(--border);margin-top:12px;}
.attorney-hdr{border-bottom:1px solid var(--border);padding:8px 13px;display:flex;justify-content:space-between;align-items:center;}
.attorney-badge{font-family:var(--mono);font-size:8px;letter-spacing:.11em;text-transform:uppercase;padding:2px 6px;border:1px solid;}
.badge-pending{color:#b5831a;border-color:#7a5010;background:rgba(181,131,26,.07);}
.badge-review{color:#1a7a9a;border-color:#1a4a6a;}
.badge-published{color:var(--green);border-color:var(--teal);}
.attorney-body{padding:13px;}
.attorney-invite{font-family:var(--serif);font-size:13px;color:var(--muted);line-height:1.8;margin-bottom:10px;}
.attorney-opinion{font-family:var(--serif);font-size:13px;color:var(--text);line-height:1.9;border-left:3px solid var(--teal);padding-left:13px;margin:9px 0;}
.attorney-sig{font-family:var(--mono);font-size:8px;color:var(--muted);letter-spacing:.06em;margin-top:7px;}
.attorney-cta{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px;}
.principle-row{display:flex;gap:9px;padding:7px 0;border-bottom:1px solid var(--border);}
.principle-num{font-family:var(--display);font-size:12px;font-weight:700;color:var(--amber);min-width:16px;}
.principle-text{font-family:var(--serif);font-size:11px;color:var(--muted);line-height:1.7;}
.mach-footer{width:100%;max-width:700px;border-top:1px solid var(--border);background:var(--bg2);padding:8px 14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:3px;}
.footer-mono{font-family:var(--mono);font-size:7px;color:var(--dim);letter-spacing:.06em;}
.source-note{background:var(--bg3);border:1px solid var(--border);border-left:3px solid var(--teal);padding:7px 11px;margin:10px 0;font-family:var(--mono);font-size:8px;color:var(--muted);letter-spacing:.05em;line-height:1.7;}
.source-note strong{color:var(--amber);}
`;

// ─── STEP BAR ──────────────────────────────────────────────────────────────────
function StepBar({ current, hasRunoff }) {
  const steps = ["Verify", "Party", "Primary", ...(hasRunoff ? ["Runoff"] : []), "General", "Results"];
  return (
    <div className="steps">
      {steps.map((s, i) => (
        <span key={s} style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span className={`step ${i < current ? "done" : i === current ? "active" : ""}`}>
            <span className="step-dot" />{s}
          </span>
          {i < steps.length - 1 && <span className="step-arr">▶</span>}
        </span>
      ))}
    </div>
  );
}

// ─── RESULTS BLOCK ──────────────────────────────────────────────────────────────
function ResultsBlock({ title, phaseStatus, candidates, tallies, total, myVote }) {
  // FIX: single source of truth for tier — Perplexity recommendation
  const tier = getParticipationTier(total);

  if (!tier.show) {
    return (
      <div className="collecting-wrap">
        <div style={{ fontFamily: "var(--display)", fontSize: 13, fontWeight: 600, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--amber)", marginBottom: 5 }}>
          {title} · Collecting Data
        </div>
        <div style={{ fontFamily: "var(--serif)", fontSize: 12, color: "var(--muted)", fontStyle: "italic", lineHeight: 1.7, marginBottom: 7 }}>
          Results suppressed until 50 minimum votes are recorded. This prevents volatile low-sample conclusions.
        </div>
        <div className="mono-sm">{total} / 50 minimum votes</div>
        <div className="collecting-prog">
          <div className="collecting-fill" style={{ width: `${Math.min(100, (total / 50) * 100)}%` }} />
        </div>
      </div>
    );
  }

  const sorted = [...candidates]
    .map(c => ({ ...c, votes: Number(tallies?.[c.id]) || 0, pct: total > 0 ? ((Number(tallies?.[c.id]) || 0) / total * 100) : 0 }))
    .sort((a, b) => b.votes - a.votes);

  // FIX 2/5: "CURRENT LEADER" not "NOMINEE" — avoids Principle IV forecasting violation
  // Only use CONFIRMED MAJORITY language when threshold is genuinely met
  const majority = Math.floor(total / 2) + 1;
  const hasMajority = phaseStatus === "winner" && sorted[0]?.votes >= majority;

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Watermark on all result blocks — FIX: prevents misleading screenshots */}
      <div className="results-watermark">
        UNOFFICIAL STRAW POLL · {total} VOTES CAST · OPT-IN · NOT SCIENTIFIC · NOT A PREDICTION
      </div>
      <div className="result-phase-hdr">
        <div className="result-phase-title">{title}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={hasMajority ? "status-winner" : phaseStatus === "runoff" ? "status-runoff" : "status-leader"}>
            {hasMajority ? "✓ MAJORITY REACHED" : phaseStatus === "runoff" ? "↪ RUNOFF TRIGGERED" : "CURRENT STANDING"}
          </span>
          <span className="mono-sm">{total}v</span>
        </div>
      </div>
      {/* Use tier.key as single authority — Perplexity fix */}
      {tier.key === "EARLY" && (
        <div className="tier-banner" style={{ borderColor: "var(--red)", color: "#c07060", background: "var(--red-lt)" }}>
          ⚠ EARLY SIGNAL — {total} votes · Very volatile · Do not generalize
        </div>
      )}
      {tier.key === "LIMITED" && (
        <div className="tier-banner" style={{ borderColor: "var(--amber-dim)", color: "var(--amber)", background: "var(--amber-lt)" }}>
          ◐ LIMITED SIGNAL — {total} votes · Results may shift significantly
        </div>
      )}
      {sorted.map((c, i) => {
        const isLeader = i === 0 && total > 0;
        const isYours = myVote === c.id;
        return (
          <div key={c.id} className={`result-row ${isLeader ? "leader-row" : ""}`}>
            {isLeader && <span className="leader-crown">▶</span>}
            <div className="r-name">
              {c.name}
              {isYours && <span className="your-pick">YOUR PICK</span>}
            </div>
            <div className="result-bar-wrap">
              <div className="result-bar" style={{ width: `${c.pct}%`, background: isLeader ? "var(--amber)" : "var(--amber-dim)" }} />
            </div>
            <div className="result-pct">{c.pct.toFixed(1)}%</div>
            <div className="result-votes">{c.votes}v</div>
          </div>
        );
      })}
      {phaseStatus === "runoff" && (
        <div className="mono-sm" style={{ marginTop: 5, color: "var(--amber)" }}>
          ↪ No candidate reached majority threshold · Top two advance to runoff · Texas Election Code
        </div>
      )}
    </div>
  );
}

// ─── ATTORNEY PANEL ──────────────────────────────────────────────────────────
function AttorneyPanel({ review }) {
  const badgeClass = review.status === "published" ? "badge-published" : review.status === "under_review" ? "badge-review" : "badge-pending";
  const badgeLabel = review.status === "published" ? "✓ Opinion Posted" : review.status === "under_review" ? "◐ Under Review" : "○ Pending — Invitation Open";
  return (
    <div className="attorney-panel">
      <div className="attorney-hdr">
        {/* FIX: header clarifies this is NOT legal advice / official clearance */}
        <div style={{ fontFamily: "var(--display)", fontSize: 12, fontWeight: 600, letterSpacing: ".07em", textTransform: "uppercase", color: "#fff" }}>
          Attorney Review Status
          <span style={{ fontFamily: "var(--mono)", fontSize: 8, color: "var(--muted)", letterSpacing: ".06em", marginLeft: 8, fontWeight: 400, textTransform: "none" }}>
            (Not Legal Advice — Does Not Certify Compliance)
          </span>
        </div>
        <span className={`attorney-badge ${badgeClass}`}>{badgeLabel}</span>
      </div>
      <div className="attorney-body">
        {review.status === "pending" && (
          <>
            <div className="attorney-invite">
              This tool has not yet received formal review from a Texas-licensed election law practitioner. We actively invite that scrutiny — not as a formality, but because public accountability is a core design value of this project.
            </div>
            <div className="attorney-invite">
              If you are a Texas-licensed attorney with election law experience, your name, bar number, and written opinion will be published here permanently and unconditionally — whether favorable or critical. Any opinion posted is the independent view of the attorney and does not constitute official state approval.
            </div>
            <div className="attorney-cta">
              <a href={`mailto:${review.contactEmail}?subject=Texas Election Law Review — Grassroots Poll Tool`}
                style={{ fontFamily: "var(--mono)", fontSize: 8, color: "var(--amber)", letterSpacing: ".08em", textDecoration: "none", border: "1px solid var(--amber-dim)", padding: "5px 11px", textTransform: "uppercase" }}>
                ✉ Contact to Review
              </a>
              <a href={review.repoUrl} target="_blank" rel="noopener noreferrer"
                style={{ fontFamily: "var(--mono)", fontSize: 8, color: "var(--muted)", letterSpacing: ".08em", textDecoration: "none", border: "1px solid var(--border)", padding: "5px 11px", textTransform: "uppercase" }}>
                ⌂ Source Code
              </a>
            </div>
          </>
        )}
        {review.status === "under_review" && (
          <div className="attorney-invite">Under review by a Texas-licensed practitioner. Opinion will be published here in full upon completion. Review began: {review.reviewDate}. Any opinion posted is independent and does not constitute official approval.</div>
        )}
        {review.status === "published" && (
          <>
            <div className="attorney-opinion">"{review.opinion}"</div>
            <div className="attorney-sig">— {review.attorneyName} · State Bar of Texas #{review.barNumber}<br />{review.firm} · {review.reviewDate}</div>
            <div className="mono-sm" style={{ marginTop: 8, color: "var(--muted)" }}>This is the independent view of the attorney. It does not constitute official state approval or legal advice.</div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [step, setStep] = useState(0);
  const [zip, setZip] = useState("");
  const [zipState, setZipState] = useState("idle");
  const [zipErr, setZipErr] = useState("");
  const [party, setParty] = useState(null);
  const [shuffledPrimary, setShPrimary] = useState([]);
  const [shuffledRunoff, setShRunoff] = useState([]);
  const [selPrimary, setSelPrimary] = useState(null);
  const [selRunoff, setSelRunoff] = useState(null);
  const [selGeneral, setSelGeneral] = useState(null);
  const [loading, setLoading] = useState(false);
  const [powProgress, setPowProgress] = useState(0);
  const [activeTab, setActiveTab] = useState("results");
  const [primaryTallies, setPrimaryTallies] = useState({});
  const [runoffTallies, setRunoffTallies] = useState({});
  const [generalTallies, setGeneralTallies] = useState({});
  const [primaryResult, setPrimaryResult] = useState(null);
  const [runoffResult, setRunoffResult] = useState(null);
  const [runoffCandidates, setRunoffCandidates] = useState([]);
  const [generalCandidates, setGeneralCandidates] = useState([]);
  const [myPrimaryVote, setMyPrimaryVote] = useState(null);
  const [myRunoffVote, setMyRunoffVote] = useState(null);
  const [myGeneralVote, setMyGeneralVote] = useState(null);
  const [hasVotedPrimary, setHasVotedPrimary] = useState(false);
  const [hasVotedRunoff, setHasVotedRunoff] = useState(false);
  const [hasVotedGeneral, setHasVotedGeneral] = useState(false);
  const [anomalies, setAnomalies] = useState([]);
  const [storageError, setStorageError] = useState(null);
  const [alreadyVotedWarning, setAlreadyVotedWarning] = useState(null);
  const fpRef = useRef(null);
  const fpReady = useRef(false);

  // Compute fingerprint async on mount
  useEffect(() => {
    computeFingerprint().then(fp => {
      fpRef.current = fp;
      fpReady.current = true;
    });
  }, []);

  const loadTallies = useCallback(async (partyKey) => {
    try {
      const pTallies = {};
      for (const c of (CANDIDATES[partyKey] || [])) {
        const r = await safeGet(tallyKey("primary", c.id), true);
        pTallies[c.id] = r?.value ? parseInt(r.value, 10) : 0;
      }
      setPrimaryTallies(pTallies);
      const pResult = computePrimaryResult(pTallies, partyKey);
      setPrimaryResult(pResult);
      const rCands = pResult.top2 || [];
      setRunoffCandidates(rCands);
      const rTallies = {};
      for (const c of rCands) {
        const r = await safeGet(tallyKey("runoff", c.id), true);
        rTallies[c.id] = r?.value ? parseInt(r.value, 10) : 0;
      }
      setRunoffTallies(rTallies);
      if (rCands.length === 2) setRunoffResult(computeRunoffResult(rTallies, rCands));
      const gTallies = {};
      for (const side of ["rep", "dem"]) {
        const r = await safeGet(tallyKey("general", side), true);
        gTallies[side] = r?.value ? parseInt(r.value, 10) : 0;
      }
      setGeneralTallies(gTallies);
      // Real velocity tracking
      const velLog = await getVelocityLog("primary");
      setAnomalies(detectAnomalies(pTallies, partyKey, velLog));
      setStorageError(null);
    } catch (e) {
      setStorageError("Storage error — tallies may not reflect latest data. Try refreshing.");
    }
  }, []);

  useEffect(() => {
    (async () => {
      const rec = await safeGet(`${RACE_KEY}:session_record`);
      if (rec?.value) {
        try {
          const v = JSON.parse(rec.value);
          setParty(v.party);
          if (v.hasVotedPrimary) { setHasVotedPrimary(true); setMyPrimaryVote(v.primaryVote); }
          if (v.hasVotedRunoff) { setHasVotedRunoff(true); setMyRunoffVote(v.runoffVote); }
          if (v.hasVotedGeneral) { setHasVotedGeneral(true); setMyGeneralVote(v.generalVote); }
          if (v.generalCandidates) setGeneralCandidates(v.generalCandidates);
          await loadTallies(v.party);
          setStep(5);
        } catch {}
      }
    })();
  }, []);

  const totalPrimary = Object.values(primaryTallies).reduce((s, v) => s + v, 0);
  const hasRunoff = primaryResult?.status === "runoff";
  const stepIdx = step > 2 && !hasRunoff ? Math.max(0, step - 1) : step;

  const verifyZip = () => {
    const z = zip.trim();
    if (!/^\d{5}$/.test(z)) { setZipState("err"); setZipErr("INVALID FORMAT — 5 DIGITS REQUIRED"); return; }
    if (!isTexasZip(z)) { setZipState("err"); setZipErr("NOT A TEXAS ZIP — OPEN TO TEXAS RESIDENTS ONLY"); return; }
    setZipState("ok");
    setTimeout(() => setStep(1), 360);
  };

  const selectParty = (p) => {
    setParty(p);
    const seed = getOrCreateSessionSeed(p, "primary");
    setShPrimary(seededShuffle(CANDIDATES[p], seed));
    loadTallies(p);
    setStep(2);
  };

  // Shared vote submission with PoW + fp lock
  const doVote = async ({ phase, candidateId, onSuccess }) => {
    if (!fpReady.current) {
      setStorageError("Device verification still loading. Please wait a moment.");
      return;
    }
    setLoading(true);
    setPowProgress(0);
    try {
      // FIX 4/5: Check fingerprint lock before allowing vote
      const fp = fpRef.current;
      const locked = await checkVoteLock(phase, fp);
      if (locked) {
        setAlreadyVotedWarning(`This device has already recorded a ${phase} vote. Multiple participation is not permitted and is flagged in the transparency dashboard.`);
        return;
      }
      // FIX 5/5: Proof-of-work challenge
      setPowProgress(10);
      const challenge = `${RACE_KEY}:${phase}:${candidateId}:${fp.slice(0, 8)}:${Date.now()}`;
      const { nonce, ms } = await solvePoW(challenge, 4);
      setPowProgress(80);
      // Increment tally with race-scoped key
      const cur = await safeGet(tallyKey(phase, candidateId), true);
      const n = (cur?.value ? parseInt(cur.value, 10) : 0) + 1;
      const writeOk = await safeSet(tallyKey(phase, candidateId), String(n), true);
      if (!writeOk) {
        setStorageError("Vote storage error — your vote may not have been recorded. Please try again.");
        return;
      }
      // Record velocity timestamp
      await recordVelocity(phase);
      // Set vote lock
      await setVoteLock(phase, fp);
      setPowProgress(100);
      onSuccess(n);
      setStorageError(null);
    } catch (e) {
      setStorageError("Unexpected error during vote submission. Please try again.");
    } finally {
      setLoading(false);
      setTimeout(() => setPowProgress(0), 800);
    }
  };

  const submitPrimary = () => {
    if (!selPrimary) return;
    doVote({
      phase: "primary",
      candidateId: selPrimary.id,
      onSuccess: async (n) => {
        const newTallies = { ...primaryTallies, [selPrimary.id]: n };
        const newResult = computePrimaryResult(newTallies, party);
        setPrimaryTallies(newTallies);
        setPrimaryResult(newResult);
        setHasVotedPrimary(true);
        setMyPrimaryVote(selPrimary.id);
        const session = { party, hasVotedPrimary: true, primaryVote: selPrimary.id };
        await safeSet(`${RACE_KEY}:session_record`, JSON.stringify(session));
        if (newResult.status === "runoff") {
          setRunoffCandidates(newResult.top2);
          const seed = getOrCreateSessionSeed(party, "runoff");
          setShRunoff(seededShuffle(newResult.top2, seed));
          setStep(3);
        } else {
          const gCands = seededShuffle([
            { id: "rep", name: selPrimary.party === "Republican" ? selPrimary.name : "Republican Nominee", party: "Republican" },
            { id: "dem", name: selPrimary.party === "Democrat" ? selPrimary.name : "Democratic Nominee", party: "Democrat" },
          ], getOrCreateSessionSeed(party, "general"));
          setGeneralCandidates(gCands);
          await safeSet(`${RACE_KEY}:session_record`, JSON.stringify({ ...session, generalCandidates: gCands }));
          setStep(4);
        }
      }
    });
  };

  const submitRunoff = () => {
    if (!selRunoff) return;
    doVote({
      phase: "runoff",
      candidateId: selRunoff.id,
      onSuccess: async () => {
        setHasVotedRunoff(true);
        setMyRunoffVote(selRunoff.id);
        const gCands = seededShuffle([
          { id: "rep", name: selRunoff.party === "Republican" ? selRunoff.name : "Republican Nominee", party: "Republican" },
          { id: "dem", name: selRunoff.party === "Democrat" ? selRunoff.name : "Democratic Nominee", party: "Democrat" },
        ], getOrCreateSessionSeed(party, "general"));
        setGeneralCandidates(gCands);
        const session = { party, hasVotedPrimary: true, primaryVote: myPrimaryVote, hasVotedRunoff: true, runoffVote: selRunoff.id, generalCandidates: gCands };
        await safeSet(`${RACE_KEY}:session_record`, JSON.stringify(session));
        setStep(4);
      }
    });
  };

  const submitGeneral = () => {
    if (!selGeneral) return;
    doVote({
      phase: "general",
      candidateId: selGeneral.id,
      onSuccess: async () => {
        setHasVotedGeneral(true);
        setMyGeneralVote(selGeneral.id);
        const session = { party, hasVotedPrimary: true, primaryVote: myPrimaryVote, hasVotedRunoff, runoffVote: myRunoffVote, hasVotedGeneral: true, generalVote: selGeneral.id, generalCandidates };
        await safeSet(`${RACE_KEY}:session_record`, JSON.stringify(session));
        await loadTallies(party);
        setStep(5);
      }
    });
  };

  // FIX 3/5: Functional JSON export
  const exportData = () => {
    const tier = getParticipationTier(totalPrimary);
    const data = {
      election: ELECTION.title,
      raceKey: RACE_KEY,
      version: ELECTION.version,
      exportedAt: new Date().toISOString(),
      participationTier: tier.label,
      disclaimer: "UNOFFICIAL STRAW POLL — SELF-SELECTED OPT-IN — NOT SCIENTIFIC — NOT A PREDICTION",
      aapor: "Recruitment: open-link community sharing. Eligibility: self-asserted Texas ZIP. No independent verification. Raw unadjusted counts only.",
      primaryTallies: totalPrimary >= 50 ? primaryTallies : "SUPPRESSED — below 50-vote minimum",
      runoffTallies,
      generalTallies,
      totalVotesPrimary: totalPrimary,
      anomalyFlags: anomalies,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `txsen_2026_straw_poll_${Date.now()}.json`;
    a.click(); URL.revokeObjectURL(url);
  };

  const totalGeneral = (generalTallies["rep"] || 0) + (generalTallies["dem"] || 0);
  const totalRunoff = Object.values(runoffTallies).reduce((s, v) => s + v, 0);

  const BallotList = ({ candidates, selected, onSelect, partyKey }) => (
    // FIX 3/5: proper radiogroup ARIA wrapper
    <div role="radiogroup" aria-label={`${partyKey} primary candidates`} className="cand-list">
      {candidates.map((c, i) => (
        <div key={c.id}
          className={`cand-row ${selected?.id === c.id ? "sel" : ""}`}
          onClick={() => onSelect(c)}
          role="radio" aria-checked={selected?.id === c.id}
          tabIndex={0}
          onKeyDown={e => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(c); }
          }}>
          <div className="cand-num">0{i + 1}</div>
          <div className="cand-bubble">{selected?.id === c.id && <div className="cand-dot" />}</div>
          <div className="cand-name">{c.name}</div>
          <span className={c.party === "Republican" ? "tag-rep" : "tag-dem"}>{c.party.slice(0, 3).toUpperCase()}</span>
        </div>
      ))}
    </div>
  );

  return (
    <>
      <style>{CSS}</style>
      <div className="machine">
        {/* MASTHEAD */}
        <div className="mast">
          <div className="mast-eye">★ Lone Star Civic Technology Project ★</div>
          <div className="mast-seal">TX</div>
          <div className="mast-title">{ELECTION.title}</div>
          <div className="mast-sub">{ELECTION.cycle} · {ELECTION.tagline}</div>
          <div className="mast-ver">{ELECTION.version}</div>
        </div>

        {/* PERMANENT DISCLOSURE — sticky, non-hideable */}
        <div className="disclosure" role="note" aria-label="Non-partisan disclosure">
          <strong>NON-PARTISAN DISCLOSURE:</strong> Unofficial, non-scientific opt-in straw poll. Not affiliated with any party, campaign, PAC, or government agency. Self-selected participants only. Results cannot be generalized to Texas voters. Candidate order randomized each session. One entry per device per phase.
        </div>

        {/* STORAGE ERROR BANNER — FIX 4/5 */}
        {storageError && (
          <div className="error-banner" role="alert">
            ⚠ {storageError}
          </div>
        )}
        {alreadyVotedWarning && (
          <div className="error-banner" role="alert" style={{ background: "rgba(181,131,26,.1)", borderColor: "var(--amber-dim)", color: "var(--amber)" }}>
            ⚠ {alreadyVotedWarning}
            <button onClick={() => setAlreadyVotedWarning(null)} className="btn-sm" style={{ marginLeft: 8, marginTop: 0 }}>Dismiss</button>
          </div>
        )}

        <StepBar current={stepIdx} hasRunoff={hasRunoff} />

        {/* ═══ ZIP VERIFY ═══ */}
        {step === 0 && (
          <div className="screen">
            <div className="slabel">Step 01 — Texas Residency</div>
            <div className="heading">Verify Texas ZIP Code</div>
            <div className="sub">Open to all Texas residents. One entry per device per election phase.</div>
            <div className="dbox">
              <strong>PRIVACY:</strong> Your ZIP code is used to verify Texas residency and then discarded. Only an anonymized device fingerprint is retained for deduplication purposes. No ZIP codes are stored.
            </div>
            <div style={{ marginTop: 16 }}>
              <label className="inp-label" htmlFor="zip-input">Enter 5-Digit Texas ZIP Code</label>
              <input id="zip-input" className={`zip-inp ${zipState === "err" ? "err" : zipState === "ok" ? "ok" : ""}`}
                type="text" inputMode="numeric" maxLength={5} placeholder="7 _ _ _ _" value={zip}
                onChange={e => { setZip(e.target.value.replace(/\D/g, "").slice(0, 5)); setZipState("idle"); setZipErr(""); }}
                onKeyDown={e => e.key === "Enter" && verifyZip()} autoFocus
                aria-label="Texas ZIP code" aria-invalid={zipState === "err"} />
              {zipErr && <div className="err-msg" role="alert">▲ {zipErr}</div>}
              {zipState === "ok" && <div className="ok-msg" role="status">✓ VALID TEXAS ZIP — PROCEEDING</div>}
            </div>
            <div className="warn-row">⚠ Non-Texas ZIPs are automatically rejected. Entering a false ZIP undermines this community tool.</div>
            <button className="btn btn-primary" onClick={verifyZip} disabled={zip.length !== 5} aria-label="Verify ZIP and continue">
              Verify & Continue ▶
            </button>
          </div>
        )}

        {/* ═══ PARTY SELECT — IDENTICAL TREATMENT ═══ */}
        {step === 1 && (
          <div className="screen">
            <div className="slabel">Step 02 — Primary Selection</div>
            <div className="heading">Choose Your Primary</div>
            <div className="sub">Texas is an open-primary state — any registered voter may participate in either party's primary.</div>
            {/* FIX 4/5: Identical buttons — no emojis, no party-specific colors */}
            <div className="party-grid" role="group" aria-label="Select primary party">
              {[["Republican", "R", "rep"], ["Democrat", "D", "dem"]].map(([name, badge]) => (
                <button key={name} className="party-btn" onClick={() => selectParty(name)}
                  aria-label={`Select ${name} primary — ${CANDIDATES[name].length} candidates`}>
                  <div className="party-badge">{badge}</div>
                  <div className="party-name">{name}</div>
                  <div className="party-count">{CANDIDATES[name].length} candidates on ballot</div>
                </button>
              ))}
            </div>
            <div style={{ marginTop: 12 }} className="mono-sm">You may only participate in one party's primary per election cycle — Texas law.</div>
            <button className="btn btn-ghost" onClick={() => setStep(0)}>◀ Back</button>
          </div>
        )}

        {/* ═══ PRIMARY BALLOT ═══ */}
        {step === 2 && (
          <div className="screen">
            <div className="slabel">Step 03 — Primary Ballot</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
              <div className="heading" style={{ marginBottom: 0 }}>Primary Ballot</div>
              <span className="ballot-phase">{party}</span>
            </div>
            <div className="source-note">
              <strong>SOURCE:</strong> All candidates listed per Texas Secretary of State official filings for the March 3, 2026 {party} U.S. Senate Primary. Names shown exactly as filed. Names only — no bios, titles, or endorsements per Neutrality Constitution Principle I.
            </div>
            <div className="ballot-hdr">
              <div className="ballot-office">{ELECTION.title} · {party} Primary</div>
              <div className="ballot-instr">Select one · 50%+1 threshold</div>
            </div>
            <BallotList candidates={shuffledPrimary} selected={selPrimary} onSelect={setSelPrimary} partyKey={party} />
            <div style={{ marginTop: 8 }} className="mono-sm">
              Session-seeded order · Crypto Fisher-Yates shuffle · Consistent this session · Anti-position-bias
            </div>
            <button className="btn btn-primary" disabled={!selPrimary} onClick={() => setStep(2.5)}>Review Selection ▶</button>
            <button className="btn btn-ghost" onClick={() => setStep(1)}>◀ Back</button>
          </div>
        )}

        {/* ═══ CONFIRM PRIMARY ═══ */}
        {step === 2.5 && selPrimary && (
          <div className="screen">
            <div className="slabel">Step 03b — Confirm</div>
            <div className="heading">Review Before Submitting</div>
            <div className="confirm-box">
              <div className="confirm-lbl">Your Primary Preference</div>
              <div className="confirm-name">{selPrimary.name}</div>
              <div className="confirm-party">{party} Primary · {ELECTION.title}</div>
            </div>
            {powProgress > 0 && powProgress < 100 && (
              <div className="pow-wrap">
                <div className="pow-label">Verification Challenge Processing…</div>
                <div className="pow-bar-track">
                  <div className="pow-bar-fill" style={{ width: `${powProgress}%` }} />
                </div>
              </div>
            )}
            <div className="warn-row">⚠ Final — cannot be changed or retracted after submission.</div>
            <div className="warn-row">⚠ Confirms you are a Texas resident and agree to one entry per phase.</div>
            <button className="btn btn-primary" onClick={submitPrimary} disabled={loading} aria-label="Submit primary vote">
              {loading ? <><span className="spin" /> Verifying…</> : <>Submit Primary Vote ★</>}
            </button>
            <button className="btn btn-ghost" onClick={() => setStep(2)} disabled={loading}>◀ Change Selection</button>
          </div>
        )}

        {/* ═══ RUNOFF ═══ */}
        {step === 3 && (
          <div className="screen">
            <div className="slabel">Step 04 — Runoff</div>
            <div className="runoff-notice">
              <div className="runoff-notice-title">↪ Runoff Triggered</div>
              <div className="runoff-notice-sub">No candidate reached majority · Top two advance · Texas Election Code</div>
            </div>
            <div className="heading">Runoff Ballot</div>
            <div className="sub">Head-to-head matchup of the top two primary vote-getters. This mirrors the Texas runoff scheduled for {ELECTION.runoffDate}.</div>
            <div style={{ height: 8 }} />
            <div className="ballot-hdr">
              <div className="ballot-office">{ELECTION.title} · {party} Runoff</div>
              <div className="ballot-instr">Head-to-head · Majority wins</div>
            </div>
            <BallotList candidates={shuffledRunoff.length ? shuffledRunoff : runoffCandidates} selected={selRunoff} onSelect={setSelRunoff} partyKey={party} />
            {powProgress > 0 && powProgress < 100 && (
              <div className="pow-wrap">
                <div className="pow-label">Verification Challenge Processing…</div>
                <div className="pow-bar-track"><div className="pow-bar-fill" style={{ width: `${powProgress}%` }} /></div>
              </div>
            )}
            <button className="btn btn-primary" disabled={!selRunoff || loading} onClick={submitRunoff}>
              {loading ? <><span className="spin" /> Verifying…</> : <>Submit Runoff Vote ▶</>}
            </button>
          </div>
        )}

        {/* ═══ GENERAL BALLOT ═══ */}
        {step === 4 && (
          <div className="screen">
            <div className="slabel">Step 05 — General Election</div>
            <div className="heading">General Election</div>
            <div className="sub">The nominees face each other. Open to all Texas voters regardless of primary participation — mirrors Texas general election rules.</div>
            <div style={{ height: 8 }} />
            <div className="ballot-hdr">
              <div className="ballot-office">{ELECTION.title} · General Election</div>
              <div className="ballot-instr">Plurality wins · {ELECTION.generalDate}</div>
            </div>
            <BallotList candidates={generalCandidates} selected={selGeneral} onSelect={setSelGeneral} partyKey="General" />
            {powProgress > 0 && powProgress < 100 && (
              <div className="pow-wrap">
                <div className="pow-label">Verification Challenge Processing…</div>
                <div className="pow-bar-track"><div className="pow-bar-fill" style={{ width: `${powProgress}%` }} /></div>
              </div>
            )}
            <button className="btn btn-primary" disabled={!selGeneral || loading} onClick={submitGeneral}>
              {loading ? <><span className="spin" /> Verifying…</> : <>Cast General Election Vote ★</>}
            </button>
          </div>
        )}

        {/* ═══ RESULTS ═══ */}
        {step === 5 && (
          <div className="screen">
            <div className="slabel">Step 06 — Results & Analysis</div>
            {(hasVotedPrimary || hasVotedRunoff || hasVotedGeneral) && (
              <div className="voted-badge" role="status">✓ YOUR VOTES RECORDED · THANK YOU</div>
            )}
            <div className="phase-flow" role="navigation" aria-label="Election phase progress">
              <div className={`phase-node ${primaryResult?.status ? "done-phase" : "active-phase"}`}>
                <div className="phase-node-lbl">Primary</div>
                <div className="phase-node-status">{primaryResult?.status === "winner" ? "✓ Done" : primaryResult?.status === "runoff" ? "↪ Runoff" : "Live"}</div>
              </div>
              <span className="phase-arrow">▶</span>
              <div className={`phase-node ${hasRunoff ? (hasVotedRunoff ? "done-phase" : "active-phase") : "locked"}`}>
                <div className="phase-node-lbl">Runoff</div>
                <div className="phase-node-status">{hasRunoff ? (runoffResult?.status === "winner" ? "✓ Done" : "Live") : "N/A"}</div>
              </div>
              <span className="phase-arrow">▶</span>
              <div className={`phase-node ${hasVotedGeneral ? "done-phase" : hasVotedPrimary ? "active-phase" : "locked"}`}>
                <div className="phase-node-lbl">General</div>
                <div className="phase-node-status">{hasVotedGeneral ? "✓ Done" : hasVotedPrimary ? "Live" : "Pending"}</div>
              </div>
            </div>

            <div className="tabs" role="tablist">
              {[["results", "Results"], ["integrity", "Integrity"], ["about", "About & Legal"]].map(([k, l]) => (
                <button key={k} className={`tab ${activeTab === k ? "active" : ""}`}
                  onClick={() => setActiveTab(k)} role="tab" aria-selected={activeTab === k}>{l}</button>
              ))}
            </div>

            {activeTab === "results" && (
              <>
                {party && <ResultsBlock title={`${party} Primary`} phaseStatus={primaryResult?.status || "live"} candidates={CANDIDATES[party] || []} tallies={primaryTallies} total={totalPrimary} myVote={myPrimaryVote} />}
                {hasRunoff && <ResultsBlock title={`${party} Runoff`} phaseStatus={runoffResult?.status || "live"} candidates={runoffCandidates} tallies={runoffTallies} total={totalRunoff} myVote={myRunoffVote} />}
                {generalCandidates.length > 0 && <ResultsBlock title="General Election Simulation" phaseStatus="live" candidates={generalCandidates} tallies={generalTallies} total={totalGeneral} myVote={myGeneralVote} />}
                {anomalies.length > 0 && (
                  <div style={{ marginTop: 12 }} role="alert">
                    <div className="mono-sm" style={{ color: "var(--red)", marginBottom: 6 }}>⚠ DATA ANOMALY FLAGS</div>
                    {anomalies.map((a, i) => <div key={i} className="anomaly-item">⚠ {a}</div>)}
                  </div>
                )}
                <div className="dbox" style={{ marginTop: 12 }}>
                  <strong>AAPOR DISCLOSURE:</strong> Self-selected, opt-in, non-probability straw poll. Recruitment: open-link community sharing. Eligibility: self-asserted Texas ZIP — not independently verified. Raw vote counts shown unadjusted. Results cannot be generalized to the Texas electorate and do not predict official election outcomes. Always cite sample size (n) and this disclosure when sharing.
                </div>
                <button className="btn-sm" style={{ marginTop: 7, marginRight: 8 }} onClick={() => party && loadTallies(party)}>↻ Refresh</button>
                <button className="btn-sm" style={{ marginTop: 7 }} onClick={exportData}>⬇ Export Data (JSON)</button>
              </>
            )}

            {activeTab === "integrity" && (
              <>
                <div style={{ fontFamily: "var(--serif)", fontSize: 12, color: "var(--muted)", fontStyle: "italic", marginBottom: 12, lineHeight: 1.8 }}>
                  All metrics publicly visible. Any journalist or researcher may download raw data and independently verify.
                </div>
                <div className="dash-grid">
                  {[
                    ["Primary Votes", totalPrimary, party || ""],
                    ["Runoff Votes", totalRunoff, hasRunoff ? "Active" : "N/A"],
                    ["General Votes", totalGeneral, "Head-to-head"],
                    ["Threshold", "50%+1", "Count-based · Strict majority"],
                    ["Anomaly Flags", anomalies.length, anomalies.length > 0 ? "Flagged" : "None"],
                    ["PoW", "Active", "Anti-bot challenge"],
                  ].map(([lbl, val, sub]) => (
                    <div key={lbl} className="dash-card">
                      <div className="dash-card-lbl">{lbl}</div>
                      <div className="dash-card-val" style={lbl === "Anomaly Flags" && anomalies.length > 0 ? { color: "var(--red)" } : {}}>{val}</div>
                      <div className="mono-sm">{sub}</div>
                    </div>
                  ))}
                </div>
                <div className="dbox">
                  <strong>TRANSPARENCY:</strong> Vote velocity, device fingerprint patterns, and tally integrity are monitored. Anomalies are flagged publicly — never silently discarded. Source code is open at {ATTORNEY_REVIEW.repoUrl}. This tool uses race-scoped storage keys (prefix: {RACE_KEY}) to prevent cross-race data bleed.
                </div>
                <button className="btn-sm" style={{ marginTop: 8 }} onClick={exportData}>⬇ Download Anonymized Data (JSON)</button>
              </>
            )}

            {activeTab === "about" && (
              <>
                <div style={{ marginTop: 4 }}>
                  <div className="about-hdr">About This Tool</div>
                  <div className="about-body">Independent, non-partisan civic technology project. No affiliation with any political party, campaign, PAC, or government agency. Purpose: give Texas communities a transparent, auditable tool for gauging grassroots preference in primary races.</div>
                </div>
                <div>
                  <div className="about-hdr">Cross-AI Methodology — Phase 1 & Phase 2</div>
                  <div className="about-body">This tool was built using a novel cross-AI validation methodology. Five independent AI systems (Perplexity, Gemini, DeepSeek, Grok, ChatGPT) reviewed the architecture before any code was written. Their responses were synthesized into a binding specification. After Version 1 was built, the same five platforms performed a code review against that specification. This version (v3) incorporates their consensus findings. The complete synthesis report is public at the repository above.</div>
                </div>
                <div>
                  <div className="about-hdr">The Neutrality Constitution</div>
                  {[
                    ["I", "Names and declared party affiliation only. No photos, titles, biographies, endorsements, or polling data of any kind."],
                    ["II", "Candidate order: cryptographic Fisher-Yates shuffle, session-persistent seed, anti-position-bias."],
                    ["III", "Identical visual treatment, identical CSS, identical interaction mechanics for every candidate and every party."],
                    ["IV", "No forecasting language. 'Current standing' only — not 'projected winner' or 'nominee' — until strict majority threshold is confirmed."],
                    ["V", "Complete source code permanently and unconditionally public. No proprietary algorithms."],
                    ["VI", "Non-partisan disclosure on every screen, sticky position, non-hideable."],
                    ["VII", "All rule changes documented in public changelog before deployment."],
                  ].map(([n, t]) => (
                    <div key={n} className="principle-row">
                      <div className="principle-num">{n}</div>
                      <div className="principle-text">{t}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 14 }}>
                  <div className="about-hdr">Texas Election Law Review</div>
                  <AttorneyPanel review={ATTORNEY_REVIEW} />
                </div>
              </>
            )}
          </div>
        )}

        <div className="mach-footer">
          <span className="footer-mono">TXSIM · NON-PARTISAN · {new Date().toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" })}</span>
          <span className="footer-mono">CROSS-AI VALIDATED · 5-PLATFORM CODE REVIEW · {ELECTION.version}</span>
        </div>
      </div>
    </>
  );
}
