# cauce-webpage-main — Cauce marketing landing

> Single-page marketing site for **Cauce** (PrestoBots Salud). Every conversion goes to a WhatsApp
> sales bot. Small codebase: about 2,850 lines across 20 source files.

## 1. At a glance

| Item | Value |
| --- | --- |
| Purpose | Lead generation for clinics (B2B, "high ticket"). Positioning: *"infraestructura de rentabilidad"*, not "a booking bot". |
| Production URL | `https://caucebot.com` (hard-coded as `SITE_URL` in `layout.tsx`, `robots.ts`, `sitemap.ts`) |
| Framework | **Next.js 16.2.9** (App Router) + **React 19.2.4** + **TypeScript 5** |
| Styling | **Tailwind CSS v4** (tokens in `src/app/globals.css` via `@theme`, no `tailwind.config.js`) |
| Fonts | `next/font/google`: **Instrument Sans** (display), **IBM Plex Sans** (body), **JetBrains Mono** (mono) |
| Hosting | **Cloudflare Workers** through **OpenNext** (`@opennextjs/cloudflare`) + `wrangler` |
| Analytics | Google Tag Manager `GTM-P4RDF3J4` (in `layout.tsx`), custom `whatsapp_click` dataLayer events |
| Package manager | npm (`package-lock.json`) |
| Tests | **None** (no test runner configured) |
| Language of UI | Spanish (es-AR) |

## 2. Commands

```bash
npm install
npm run dev          # next dev → http://localhost:3000 (LAN origins allowed, see next.config.ts)
npm run build        # next build
npm run start        # next start (Node server, not the Worker)
npm run lint         # eslint (next core-web-vitals + typescript)
npm run preview      # opennextjs-cloudflare build && preview → local Worker (wrangler)
npm run deploy       # opennextjs-cloudflare build && deploy → Cloudflare
npm run cf-typegen   # wrangler types → cloudflare-env.d.ts (gitignored)
```

Cloudflare dashboard build settings, per `CLAUDE.md`: build `npm run build`, deploy `npm run deploy`,
non-prod branches `npm run preview`. **Don't** use bare `npx wrangler deploy`. It fails with
`Could not find compiled Open Next config`.

## 3. File map

```
src/
├── app/
│   ├── layout.tsx            # <html lang="es-AR">, fonts, SEO metadata, JSON-LD, GTM, <WhatsAppFab/>
│   ├── page.tsx              # Composes the sections (order below)
│   ├── globals.css           # Tailwind v4 @theme tokens (Cauce palette) + utilities (marquee, dot grid…)
│   ├── opengraph-image.tsx   # 1200×630 OG image generated with next/og ImageResponse
│   ├── cauce-logo-base64.ts  # Logo as data URL for the OG image
│   ├── robots.ts             # allow all, sitemap URL
│   └── sitemap.ts            # only "/" (single page)
├── components/
│   ├── NavBar.tsx            # "use client" — sticky header, anchors, WhatsApp CTA (location="navbar")
│   ├── Hero.tsx              # Animated SVG "flow", CTA (location="hero"), links #pilares / #form
│   ├── Pillars.tsx           # id="pilares" — 5 value pillars
│   ├── LogoTicker.tsx        # Infinite marquee of client logos (/public/logos/*)
│   ├── Testimonials.tsx      # "use client" — id="testimonios", YouTube Shorts modal (Esc closes)
│   ├── Problem.tsx           # Pain points + SVG charts
│   ├── Product.tsx           # id="producto" — how it works + CTA (location="product")
│   ├── Differentiator.tsx    # vs competitors + CTA (location="differentiator")
│   ├── FormSection.tsx       # id="form" — NOT a form anymore: WhatsApp CTA (location="form_section")
│   ├── Footer.tsx            # "use client" — anchors, privacy/terms links to prestobots.com
│   ├── WhatsAppLink.tsx      # "use client" — the single <a> used by every CTA
│   └── WhatsAppFab.tsx       # "use client" — floating WhatsApp button (location="fab")
└── lib/links.ts              # WhatsApp number/message, gclid capture, dataLayer tracking
public/  favicons, site.webmanifest, /icons/*, /illustrations/*, /logos/* (clients + Cauce)
```

**Render order** (`page.tsx`): NavBar → Hero → Pillars → LogoTicker → Testimonials → Problem →
Product → Differentiator → FormSection → Footer, plus the FAB from the layout.

**Anchors:** `#top`, `#pilares`, `#testimonios`, `#producto`, `#form`.

## 4. Core behavior: WhatsApp conversion + Ads attribution (`src/lib/links.ts`)

This is the only real business logic, and the main thing to test.

- `WHATSAPP_NUMBER = "5492617450587"` with the preset message
  `"Hola! Me interesa conocer Cauce y agendar una demo para mi clínica."`
- `WHATSAPP_URL` is the static `https://wa.me/<n>?text=<encoded msg>` used for SSR and middle-click.
- `getAdsClickId()` reads `gclid`, `wbraid` or `gbraid` from the query string and persists it in
  `sessionStorage["cauce_ads_click_id"]`. If none is in the URL, it returns the stored one, so the
  ID survives in-page navigation.
- `buildWhatsAppUrl()` appends `\n\nRef: <clickId>` to the message when a click ID exists. This lets
  sales later upload **offline conversions** to Google Ads.
- On click, `WhatsAppLink` and `WhatsAppFab` **rewrite their own `href`** before the browser follows
  it. They do this instead of `window.open` to avoid popup blockers. They then call
  `trackWhatsAppClick(location)`, which pushes `{ event: "whatsapp_click", cta_location }` to
  `window.dataLayer`. GTM has a trigger on that event.
- CTA `location` values: `navbar`, `hero`, `product`, `differentiator`, `form_section`, `fab`.

## 5. Content and brand rules (from `CLAUDE.md`, still valid)

- **Never invent copy or numbers.** The only approved metrics are +1M appointments managed,
  +3M chats/month (updated Jun-2026), 80% self-service, 6 years, +40 active clinics. **+200** is
  the Macena *addressable* base and must not be presented as clients.
- 5 pillars: Trazabilidad 360º, Scoring de Pacientes, Dato Estratégico, Rentabilidad Operativa,
  Integración Nativa.
- Buyer persona "Ricardo" (medical director or operations manager, 45–55). Named clients come
  from the logos in `/public/logos` and the testimonials (Asistir, Sanatorio Bernal, Nobis Center).
- Testimonials are real YouTube Shorts (IDs in `Testimonials.tsx`). Thumbnails load from
  `i.ytimg.com`, which is allowed in `next.config.ts` `images.remotePatterns`.

## 6. ⚠️ Drift between `CLAUDE.md` and the code

`CLAUDE.md` describes an earlier iteration. Trust the code:

| `CLAUDE.md` says | Code actually does |
| --- | --- |
| Brand "PrestoBots Salud", subdomain `landing.prestobots.com` | Brand **Cauce**, domain **caucebot.com** |
| Yellow/black palette (`#FFCC33`, `#000`) | **Bordó `#6E2E3A` + gold `#D4A55C` + cream paper `#FDFAF4`**; old token names (`brand-yellow`, `ink`) were kept and repointed |
| Open Sans + Source Sans 3 | Instrument Sans + IBM Plex Sans + JetBrains Mono |
| In-page capture **form** (8 fields, HubSpot later) | **No form.** `#form` section is a WhatsApp CTA ("Hablar con el bot") |
| Metrics strip, "Para quién es" section, final CTA with bubble | Not present; sections are listed in §3 |
| `wrangler.jsonc` `name: cauce` | `name: "cauce-webpage"` **but** service binding `WORKER_SELF_REFERENCE → "cauce"`. This is exactly the mismatch `CLAUDE.md` warns will fail with *"references Worker … which was not found"* unless the Worker is really named `cauce` in Cloudflare. **Verify before deploying.** |
| README (create-next-app default) mentions Geist/Vercel | Irrelevant boilerplate |

`AGENTS.md` warns: *"This is NOT the Next.js you know"*. Read `node_modules/next/dist/docs/` before
changing framework-level code.

## 7. SEO and metadata

- `metadata` in `layout.tsx` sets the title template `%s | Cauce`, the description, keywords,
  OpenGraph (`es_AR`), Twitter `summary_large_image`, canonical `/`, manifest and icons.
  `themeColor` is `#6E2E3A`.
- JSON-LD `@graph` contains an `Organization` and a `SoftwareApplication`.
- `opengraph-image.tsx` is generated at build or request time.
- `robots.txt` allows all and points to `https://caucebot.com/sitemap.xml`.

## 8. Gotchas

- `.env*` is gitignored. No env vars are used today.
- `ads/` (Google Ads CSVs) and `notas*.txt` are gitignored.
- `next.config.ts` `allowedDevOrigins` covers the `192.168.0.*` and `192.168.1.*` LAN ranges, for testing on phones.
- Footer privacy and terms links go to `prestobots.com`, not Cauce pages.
- No `data-testid` attributes. E2E tests should use roles, accessible names and the `href`/`id`
  attributes listed above (see doc 04).
