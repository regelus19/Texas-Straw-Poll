# Texas Straw Poll — 2026 U.S. Senate

**Live App:** [texas-straw-poll.vercel.app](https://texas-straw-poll.vercel.app)

A non-partisan, open-source grassroots straw poll simulating the 2026 Texas U.S. Senate primary, runoff, and general election.

---

## What This Is

An unofficial, non-scientific opt-in straw poll open to Texas residents. It simulates all three phases of the 2026 Texas U.S. Senate race:

- **Primary** — March 3, 2026 (Democrat & Republican)
- **Runoff** — May 26, 2026 (if no candidate hits 50%+1)
- **General Election** — November 3, 2026

---

## Integrity Features

| Feature | Description |
|---|---|
| Email Verification | One-time code via Supabase Auth — one vote per verified email per phase |
| Cryptographic Shuffle | Candidate order randomized via `crypto.getRandomValues()` + Fisher-Yates |
| Proof-of-Work | Anti-bot challenge before vote submission |
| Device Fingerprint | Secondary duplicate prevention via browser fingerprinting |
| Results Threshold | Results suppressed until 50 minimum votes — prevents volatile low-sample conclusions |
| Self-Attestation | Voter confirms Texas residency, age 18+, and registered voter status |
| AAPOR Disclosure | Full methodological transparency on results screen |

---

## Neutrality Principles

1. No candidate or party receives preferential treatment in design, order, or emphasis
2. Candidate order randomized cryptographically each session
3. No fundraising, no advertising, no campaign affiliation
4. Results presented with full disclosure of limitations
5. Source code is fully open and publicly auditable (this repo)

---

## Candidates (as filed with Texas Secretary of State)

**Republican Primary:** Ted Cruz, Brandon Herrera, Tracy Andrus, Colin Allred (R-Crossover listed separately)

**Democrat Primary:** Jasmine Crockett, Ahmad Hassan, James Talarico

---

## Tech Stack

- React 18 + Vite
- Supabase (PostgreSQL database + Auth for email verification)
- Vercel (hosting + auto-deploy)
- No tracking, no analytics, no cookies beyond session state

---

## Cross-AI Validation

This app was reviewed by 5 AI platforms (Claude, ChatGPT, Grok, Perplexity, DeepSeek) as part of a cross-AI synthesis methodology. The Phase 2 synthesis report is available in the repo.

AI-assisted development: Claude (Anthropic)

---

## How to Run Locally

```bash
git clone https://github.com/regelus19/Texas-Straw-Poll
cd Texas-Straw-Poll
npm install
npm run dev
```

You'll need your own Supabase project with the `votes` and `verified_voters` tables (see SQL schema below).

---

## Database Schema

```sql
-- Votes table
create table votes (
  id uuid default gen_random_uuid() primary key,
  race_key text not null,
  phase text not null,
  candidate_id text not null,
  count integer default 0,
  updated_at timestamp default now(),
  unique(race_key, phase, candidate_id)
);

-- Verified voters table (stores hashed emails only)
create table verified_voters (
  id uuid default gen_random_uuid() primary key,
  email_hash text not null,
  phase text not null,
  race_key text not null,
  verified_at timestamp default now(),
  unique(email_hash, phase, race_key)
);
```

---

## Contributing

Pull requests welcome. Please read the Neutrality Principles before submitting changes that affect candidate presentation or results display.

---

## Disclaimer

Unofficial, non-scientific opt-in straw poll. Not affiliated with any party, campaign, PAC, or government agency. Results are unweighted and do not represent all Texas voters. Does not predict election outcomes.

**Not legal advice. Not polling data. Not affiliated with the Texas Secretary of State.**

---

*Lone Star Civic Technology Project · Open Source · MIT License*
