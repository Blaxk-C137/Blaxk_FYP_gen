# fypgen — Free forever, local FYP report generator

Generate your complete Nigerian final year project — five chapters plus defense slides —
free, on your own machine. No account, no payment, no telemetry.

## Requirements
- Node.js 18+ (https://nodejs.org)
- A free Google Gemini API key (https://aistudio.google.com/apikey) — or an OpenAI/Anthropic key

## Run it

    npx fypgen

Your browser opens automatically. Paste your API key once — it is stored only in your
browser (localStorage) and sent only to the server running on your own machine.

## What it does
1. Takes your topic, university, department, supervisor details
2. Proposes a full five-chapter outline you can edit
3. Generates chapters one by one (or all sequentially) with live streaming
4. Exports a formatted Word document (Times New Roman 12, double-spaced, APA 7 references)
   and PowerPoint defense slides with a Q&A prep appendix

## Important
References are AI-generated. **Verify every reference before submission.**

## Development

    npm install
    npm run dev:api   # terminal 1 — local API server on :5199 (no browser)
    npm run dev       # terminal 2 — vite dev server with HMR, proxies /api to :5199
    npm test          # server + shared unit tests
    cd web && npm test   # web unit tests
    npm run build && npx playwright test   # E2E with mock provider
