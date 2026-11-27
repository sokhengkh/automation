# n8n Optional Reference Workflows

On this machine, the global `n8n` CLI (`C:\Users\ADMIN\AppData\Roaming\npm\n8n`) is currently incomplete (`MODULE_NOT_FOUND`), and your Gemini API key uses Google's newer `AQ.` format which works natively with the official `@google/genai` SDK.

Because of that, the main system in `src/server.js` already handles the entire pipeline natively (Telegram + ngrok + Gemini + Google Sheets + 2-sheet Excel + Monthly Schedule + Web Dashboard) with no broken dependencies.

If you later install/repair `n8n` (recommended on Node 20 or 22 LTS via `npm install -g n8n`), you can import these two starter workflow JSON files into n8n:
- `daily-expense-workflow.json` — Telegram Trigger -> Parse via local AI API / Gemini HTTP -> Append to Google Sheets -> Reply
- `monthly-excel-workflow.json` — End-of-Month Afternoon Schedule -> Download 2-Sheet Excel from `/api/report/excel` -> Send Document on Telegram
