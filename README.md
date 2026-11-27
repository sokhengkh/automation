# កម្មវិធីកត់ត្រាចំណូល-ចំណាយប្រចាំថ្ងៃ AI (Telegram + Gemini + Google Sheets + Excel)

ប្រព័ន្ធស្វ័យប្រវត្តិសម្រាប់កត់ត្រាចំណូល-ចំណាយតាម **Telegram Bot** ដោយគាំទ្រ **សារអក្សរ, សារសំឡេង (Voice), រូបភាពវិក្កយបត្រ (Receipt OCR), និងទីតាំង (Location)** ប្រើ **Gemini AI** រក្សាទុកចូល **Google Workspace Sheet** និងផ្ញើ **File Excel (.xlsx) ២ Sheets (សរុប + លម្អិត)** ត្រឡប់មក Telegram វិញរៀងរាល់ចុងខែពេលរសៀល (ម៉ោង 16:00)។

## មុខងារសំខាន់ៗ
- **Telegram Multimodal Input:**
  - សារអក្សរខ្មែរ/អង់គ្លេស (ឧ. `កាហ្វេ Amazon 2.5$ ABA នៅ BKK1`, `បាយ 12000 រៀល`, `ប្រាក់ខែ 900$ ACLEDA`)
  - សារសំឡេង Voice Note (ខ្មែរ/អង់គ្លេស)
  - រូបភាពវិក្កយបត្រ ឬ Screenshot ផ្ទេរប្រាក់
  - ទីតាំង GPS (ចុចប៊ូតុង `📍 Share Location` ឬសរសេរឈ្មោះហាងក្នុងសារ)
- **រូបិយប័ណ្ណ ២ ដាច់ដោយឡែក៖** USD (`$`) និង KHR (`៛`)
- **ជួរឈរ (Columns) ក្នុង Google Sheet & Excel៖**
  `Date` | `Type` | `Categories` | `Amount` | `Currency` | `Description` | `Payment Method` | `Location`
- **របាយការណ៍ Excel (.xlsx) ២ Sheets៖**
  1. `Summary (សរុប)` — សមតុល្យសរុប (`$` និង `៛`), សង្ខេបតាម Category, តាម Payment Method, និងប្រចាំថ្ងៃ
  2. `Transactions (លម្អិត)` — តារាងប្រតិបត្តិការលម្អិតទាំង ៨ Columns
- **Web Dashboard:** បើកមើល ស្វែងរក បន្ថែម លុប និងទាញយក Excel នៅ `http://localhost:3000`

## របៀបចាប់ផ្តើមប្រើប្រាស់
1. ដំឡើង Dependencies និងដំណើរការ Server ដោយចុចពីរដងលើ `start.bat` ឬវាយក្នុង Terminal៖
   ```powershell
   npm install
   npm start
   ```
2. បើក Telegram Bot របស់អ្នក ហើយផ្ញើពាក្យ `/start` (ដើម្បីចុះឈ្មោះ Chat ID សម្រាប់ទទួលរបាយការណ៍ចុងខែ)។
3. **ភ្ជាប់ Google Sheet (១ នាទីតាម Apps Script)៖**
   - បើក Google Sheet របស់អ្នក → `Extensions` → `Apps Script`
   - ចម្លងកូដពី `google-apps-script/Code.gs` ទៅដាក់ហើយ Save
   - ចុច `Deploy` → `New deployment` → `Web app` (`Execute as: Me`, `Who has access: Anyone`)
   - ចម្លង Web app URL មកដាក់ក្នុង Dashboard (`http://localhost:3000` → "ភ្ជាប់ Apps Script") ឬដាក់ក្នុង `.env` (`GOOGLE_APPS_SCRIPT_URL=...`)។
