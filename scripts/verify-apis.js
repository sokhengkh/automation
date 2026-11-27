import { geminiService } from '../src/services/geminiService.js';
import { sheetsService } from '../src/services/sheetsService.js';
import { telegramService } from '../src/services/telegramService.js';

async function main() {
  console.log('--- 1. Testing Telegram Bot API ---');
  try {
    const me = await telegramService.apiCall('getMe');
    console.log(`PASS: Telegram Bot connected -> @${me.username} (id: ${me.id})`);
  } catch (err) {
    console.error(`FAIL: Telegram -> ${err.message}`);
  }

  console.log('\n--- 2. Testing Gemini AI Parser (Khmer + English) ---');
  try {
    const parsed = await geminiService.parseInput({
      text: 'ទិញកាហ្វេ Amazon 2.5$ បង់តាម ABA នៅ BKK1',
    });
    console.log('PASS: Gemini AI response ->', JSON.stringify(parsed, null, 2));
  } catch (err) {
    console.error(`FAIL: Gemini -> ${err.message}`);
  }

  console.log('\n--- 3. Testing Google Sheets Connector ---');
  const sheetRes = await sheetsService.testConnection();
  console.log('Google Sheets Status ->', JSON.stringify(sheetRes));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
