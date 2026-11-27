# វិធីដាក់កម្មវិធីលើ Cloud ដោយមិនអស់លុយ ($0/ខែ, មិនបាច់ប្រើកាត Visa/MasterCard)

ប្រព័ន្ធនេះត្រូវបានកែសម្រួលឱ្យអាច Deploy លើ **Render (Free Plan)** + **cron-job.org (Free)** ដោយមិនចាំបាច់បើកកុំព្យូទ័រ និងមិនចាំបាច់ប្រើ `ngrok` ឡើយ។

---

## ជំហានទី ១ — Upload កូដទៅ GitHub (Private Repository)
> ⚠️ **សំខាន់បំផុត៖** File `.gitignore` បានការពារមិនឱ្យ Upload `.env` ទៅ GitHub រួចហើយ — កុំលុប `.gitignore` ចោល និងគួរបង្កើត Repo ជា **Private** ដើម្បីសុវត្ថិភាព។

```powershell
cd c:\xampp\htdocs\automation
git init
git add .
git commit -m "Initial commit: Khmer Finance Telegram AI"
# រួច Push ទៅកាន់ GitHub Private Repository របស់អ្នក
```

---

## ជំហានទី ២ — Deploy លើ Render ($0/ខែ, គ្មាន Credit Card)
1. ចូលទៅ https://render.com → Sign up ដោយប្រើ **GitHub** (មិនទាមទារ Credit Card ទេ)
2. ចុច **New + → Web Service** (ឬ **Blueprint** ដើម្បីអានពី `render.yaml` ដោយស្វ័យប្រវត្តិ)
3. ជ្រើស Repository របស់អ្នក និងកំណត់៖
   - **Runtime:** `Node`
   - **Plan:** **`Free`** (`$0/month`)
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. បន្ថែម **Environment Variables** ក្នុង Render Dashboard (យកតម្លៃពី `.env` ក្នុងម៉ាស៊ីនអ្នក)៖
   - `TIMEZONE` = `Asia/Phnom_Penh`
   - `TELEGRAM_MODE` = `webhook`
   - `NGROK_AUTOSTART` = `false`
   - `TELEGRAM_BOT_TOKEN` = *(Bot Token របស់អ្នក)*
   - `TELEGRAM_WEBHOOK_SECRET` = `kh_finance_bot_secret_2026`
   - `TELEGRAM_ALLOWED_CHAT_IDS` = `5947328123` *(Chat ID របស់អ្នក — សំខាន់ណាស់ដើម្បីឱ្យ Bot ស្គាល់អ្នកជានិច្ច)*
   - `GEMINI_API_KEY` = *(Gemini API Key របស់អ្នក)*
   - `GEMINI_MODEL` = `gemini-2.5-flash`
   - `GOOGLE_SHEET_ID` = `1X1bPfJXvijvYggVK3osxfcCXY30HBBrWMtHhWeEjZpA`
   - `GOOGLE_APPS_SCRIPT_URL` = *(Web App URL របស់អ្នក)*
   - `GOOGLE_APPS_SCRIPT_SECRET` = `kh_sheet_sync_2026`
   - `CRON_SECRET` = `kh_finance_bot_secret_2026`
5. ចុច **Deploy Web Service**។
   - Render នឹងផ្តល់ URL ជា `https://xxxx.onrender.com` (តាមរយៈ `RENDER_EXTERNAL_URL` ប្រព័ន្ធយើងនឹងប្តូរ Telegram Webhook ទៅ URL នោះដោយស្វ័យប្រវត្តិ!)
   - ⚠️ **សំខាន់៖** ពេលដំណើរការលើ Cloud រួច សូមបិទ Server លើកុំព្យូទ័រផ្ទាល់ខ្លួនចោល កុំឱ្យ `ngrok` មកដណ្តើម Webhook ពី Cloud!

---

## ជំហានទី ៣ — កុំឱ្យ Render Free ដេកលក់ & ផ្ញើ Excel ចុងខែទៀងម៉ោង ($0)
Render Free នឹង Sleep បើគ្មានចរាចរណ៍ 15 នាទី (750 ម៉ោងហ្វ្រី/ខែ)។ ដើម្បីឱ្យ Bot ឆ្លើយតបភ្លាមៗពេលថ្ងៃ និងផ្ញើ Excel ចុងខែម៉ោង `16:00` ទៀងទាត់៖

1. បង្កើតគណនីហ្វ្រីនៅ https://cron-job.org (គ្មាន Credit Card)
2. បង្កើត **Cronjob ទី ១ (Keep Awake — កុំឱ្យ Bot យឺតពេលថ្ងៃ)៖**
   - **URL:** `https://YOUR-APP.onrender.com/api/health`
   - **Schedule:** រៀងរាល់ **14 នាទីម្តង** (ចន្លោះម៉ោង 06:00 ដល់ 23:00 ដើម្បីសន្សំម៉ោងក្រោម 750h/ខែ)
3. បង្កើត **Cronjob ទី ២ (ផ្ញើ Excel ប្រចាំខែពេលរសៀល)៖**
   - **URL:** `https://YOUR-APP.onrender.com/api/cron/monthly-report?secret=kh_finance_bot_secret_2026`
   - **Schedule:** រៀងរាល់ថ្ងៃ ម៉ោង **16:00** (`Asia/Phnom_Penh`)
   - *(ប្រព័ន្ធនឹងឆែកដោយស្វ័យប្រវត្តិ៖ ផ្ញើតែនៅថ្ងៃចុងខែ និងផ្ញើតែ ១ ដងប៉ុណ្ណោះក្នុង ១ ខែ!)*
4. បង្កើត **Cronjob ទី ៣ (រំលឹកបង់វិក្កយបត្រទឹក ២ ខែម្តង ថ្ងៃ 16-18)៖**
   - **URL:** `https://YOUR-APP.onrender.com/api/cron/reminders?secret=kh_finance_bot_secret_2026`
   - **Schedule:** រៀងរាល់ថ្ងៃ ម៉ោង **09:00** (`Asia/Phnom_Penh`)
   - *(រំលឹកតែថ្ងៃទី 16-18 រៀងរាល់ 2 ខែម្តង ហើយឈប់រំលឹកភ្លាមពេលអ្នកបានកត់វិក្កយបត្រទឹកចូល Sheet!)*
