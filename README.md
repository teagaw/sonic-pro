# SonicPro v7

Production-grade music mix analyzer. EBU R128 LUFS metering, 7-band spectral analysis, AI Mix Coach, Reference Track Comparison, Vibe Timeline. SaaS — $9/mo Pro tier via Stripe.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript + Vite 6 |
| Styling | Tailwind CSS v4 + shadcn/ui |
| DSP | Custom Web Worker — 674 lines, zero deps |
| Backend | Supabase (Auth + Postgres + Edge Functions) |
| AI | Gemini 2.0 Flash (server-side proxy) |
| Payments | Stripe Checkout + Webhooks |
| PWA | Service Worker + Web App Manifest |

## Tier Limits

| Feature | Free | Pro ($9/mo) |
|---|---|---|
| Audio analysis | Unlimited | Unlimited |
| Track duration | 20 min | Unlimited |
| AI Mix Coach audits | 2 / week | Unlimited |
| Report / JSON exports | 3 / week | Unlimited |
| Library saves | 5 total | Unlimited |

## Quick Start

```bash
# 1. Install
npm install

# 2. Configure environment
cp .env.example .env
# Fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

# 3. Run database migrations (in Supabase SQL Editor)
# → supabase-migration.sql    (v2 — analyses table)
# → supabase-migration-v3.sql (v3 — subscriptions, user_usage, RPC)

# 4. Deploy Edge Functions
supabase functions deploy ai-advice
supabase functions deploy create-checkout
supabase functions deploy stripe-webhook --no-verify-jwt

# 5. Set server-side secrets
supabase secrets set GEMINI_API_KEY=your_gemini_key
supabase secrets set STRIPE_SECRET_KEY=sk_live_...
supabase secrets set STRIPE_PRICE_ID=price_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...

# 6. Configure Stripe webhook
# Dashboard → Webhooks → Add endpoint:
# URL: https://<project-ref>.supabase.co/functions/v1/stripe-webhook
# Events: customer.subscription.created/updated/deleted

# 7. Run
npm run dev
```

## Project Structure

```
src/
├── main.tsx                    # Entry point
├── App.tsx                     # Theme + SW + AudioWorkerProvider
├── index.css                   # Tailwind v4 + CSS variables
├── vite-env.d.ts               # import.meta.env types
├── lib/
│   ├── types.ts                # Shared TypeScript interfaces
│   ├── supabase.ts             # Supabase client
│   ├── targets.ts              # 10 genre profiles
│   ├── gemini.ts               # AI advice client
│   ├── stripe.ts               # Checkout helper
│   └── utils.ts                # cn() helper
├── context/
│   └── AudioWorkerContext.tsx  # Singleton DSP worker
├── hooks/
│   ├── useAudioAnalyzer.ts     # Audio decode + worker bridge
│   ├── useAuth.ts              # Supabase auth
│   ├── useLibrary.ts           # Cloud library (tier-aware)
│   └── useSubscription.ts      # Tier + weekly usage flags
├── workers/
│   └── audioWorker.ts          # 674-line DSP engine
└── components/
    ├── MixDashboard.tsx        # Main layout (622 lines)
    ├── SidePanel.tsx           # AI + export (tier-gated)
    ├── PrintPreview.tsx        # A4 PDF report
    ├── LibraryPanel.tsx        # Saved analyses
    ├── AuthModal.tsx           # Login / signup
    ├── AudioVisualizer.tsx     # Waveform canvas
    ├── LufsMeter.tsx           # LUFS meter
    ├── PhaseMeter.tsx          # Stereo correlation
    ├── VibeTimeline.tsx        # Energy chart
    └── ui/                     # shadcn primitives

supabase/functions/
├── ai-advice/                  # Gemini proxy (auth + usage gated)
├── create-checkout/            # Stripe session creator
└── stripe-webhook/             # Subscription sync

supabase-migration.sql          # DB v2
supabase-migration-v3.sql       # DB v3 (subscriptions + usage)
```

## DSP Engine

Implemented to spec — no approximations:

- **ITU-R BS.1770-4** K-weighting + integrated LUFS
- **EBU R128** absolute + relative gating
- **Cooley-Tukey** radix-2 DIT FFT (8192pt, Hann window)
- **Audio EQ Cookbook** biquad filter design
- **Zero-phase IIR** (filtfilt — forward + reverse pass)
- 7-band spectral RMS, centroid, rolloff, flatness
- Mid/Side encoding + windowed stereo correlation
- Vibe Timeline (short-time energy + spectral flux)
- Delta Engine with genre profile mode (no reference track needed)

## Scripts

```bash
npm run dev     # Dev server (port 3000)
npm run build   # Production bundle
npm run lint    # TypeScript check (tsc --noEmit)
```
