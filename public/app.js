const el = (id) => document.getElementById(id);

function formatUsd(val) {
  return `$${Number(val || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatKhr(val) {
  return `${Math.round(Number(val || 0)).toLocaleString('en-US')} ៛`;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function setFeedback(targetId, msg, isOk = true) {
  const box = el(targetId);
  box.textContent = msg;
  box.className = `feedback ${isOk ? 'ok' : 'err'}`;
}

async function fetchStatus() {
  const res = await fetch('/api/status');
  const data = await res.json();
  if (!data.ok) return;

  if (!el('monthPicker').value) {
    el('monthPicker').value = data.currentMonth;
  }

  // Populate category select
  const catSelect = el('mCategory');
  if (catSelect.options.length === 0) {
    for (const c of data.categories) {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      catSelect.appendChild(opt);
    }
  }

  el('stTelegram').textContent = data.telegram.username
    ? `@${data.telegram.username}`
    : data.telegram.configured
      ? 'Configured'
      : 'Not Configured';
  el('stTelegramSub').textContent =
    data.telegram.mode === 'webhook'
      ? 'Webhook Active (ngrok)'
      : data.telegram.mode === 'polling'
        ? 'Polling Mode'
        : 'Idle';

  el('stNgrok').textContent = data.ngrok.publicUrl || 'Offline / Polling Mode';
  el('stNgrokSub').textContent = data.telegram.webhookUrl || 'Waiting for ngrok tunnel';

  el('stGemini').textContent = data.gemini.configured ? data.gemini.model : 'Missing Key';

  const modeLabels = {
    apps_script: 'Connected (Apps Script)',
    service_account: 'Connected (Service Account)',
    local_only: 'Local Only (Needs Setup)',
  };
  el('stSheet').textContent = `${modeLabels[data.googleSheet.mode] || data.googleSheet.mode}`;
  el('openSheetLink').href = data.googleSheet.sheetUrl || '#';

  const alertBanner = el('sheetAlert');
  if (data.googleSheet.mode === 'local_only') {
    alertBanner.classList.remove('hidden');
  } else {
    alertBanner.classList.add('hidden');
  }

  const hh = String(data.schedule.hour).padStart(2, '0');
  const mm = String(data.schedule.minute).padStart(2, '0');
  el('kpiSchedule').textContent = `ចុងខែម៉ោង ${hh}:${mm} (${data.timezone})`;
}

async function fetchTransactions() {
  const month = el('monthPicker').value;
  const type = el('typeFilter').value;
  const currency = el('currencyFilter').value;
  const q = el('searchInput').value.trim();

  const params = new URLSearchParams();
  if (month) params.set('month', month);
  if (type) params.set('type', type);
  if (currency) params.set('currency', currency);
  if (q) params.set('q', q);

  const res = await fetch(`/api/transactions?${params.toString()}`);
  const data = await res.json();
  if (!data.ok) return;

  const { totals, count } = data.summary;
  el('kpiUsdIncome').textContent = formatUsd(totals.USD.income);
  el('kpiKhrIncome').textContent = formatKhr(totals.KHR.income);
  el('kpiUsdExpense').textContent = formatUsd(totals.USD.expense);
  el('kpiKhrExpense').textContent = formatKhr(totals.KHR.expense);
  el('kpiUsdNet').textContent = formatUsd(totals.USD.net);
  el('kpiKhrNet').textContent = formatKhr(totals.KHR.net);
  el('kpiCount').textContent = String(count);

  const tbody = el('txTableBody');
  if (!data.transactions.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty">មិនទាន់មានទិន្នន័យសម្រាប់ខែនេះទេ — សាកល្បងផ្ញើសារទៅ Telegram Bot!</td></tr>';
    return;
  }

  tbody.innerHTML = data.transactions
    .map((tx) => {
      const isIncome = tx.type === 'ចំណូល';
      const amtFormatted =
        tx.currency === '៛'
          ? Math.round(tx.amount).toLocaleString('en-US')
          : Number(tx.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      return `
        <tr>
          <td>${escapeHtml(tx.date)}</td>
          <td><span class="badge ${isIncome ? 'badge-income' : 'badge-expense'}">${escapeHtml(tx.type)}</span></td>
          <td>${escapeHtml(tx.categories)}</td>
          <td class="num"><strong>${amtFormatted}</strong></td>
          <td>${escapeHtml(tx.currency)}</td>
          <td class="wrap">${escapeHtml(tx.description || '-')}</td>
          <td>${escapeHtml(tx.paymentMethod || '-')}</td>
          <td class="wrap">${escapeHtml(tx.location || '-')}</td>
          <td><span class="badge ${tx.syncedToSheet ? 'badge-synced' : 'badge-local'}">${tx.syncedToSheet ? 'Sheet' : 'Local'}</span></td>
          <td><button class="btn-del" data-id="${escapeHtml(tx.id)}" title="Delete">🗑</button></td>
        </tr>
      `;
    })
    .join('');

  tbody.querySelectorAll('.btn-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      if (!confirm('លុបកំណត់ត្រានេះចេញពី Local?')) return;
      await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
      await loadAll();
    });
  });
}

async function loadAll() {
  await fetchStatus();
  await fetchTransactions();
}

// Tabs
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.getAttribute('data-tab');
    el('aiForm').classList.toggle('hidden', tab !== 'ai');
    el('manualForm').classList.toggle('hidden', tab !== 'manual');
    el('formFeedback').textContent = '';
  });
});

el('aiForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = el('aiInputText').value.trim();
  if (!text) return;
  const submitBtn = el('aiSubmitBtn');
  submitBtn.disabled = true;
  setFeedback('formFeedback', '🤖 Gemini AI កំពុងវិភាគ...', true);

  try {
    const res = await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ useAi: true, text }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setFeedback('formFeedback', data.error || 'បរាជ័យ', false);
    } else {
      el('aiInputText').value = '';
      setFeedback(
        'formFeedback',
        `✅ បានកត់ត្រា ${data.transactions.length} ប្រតិបត្តិការ! (${data.syncResult?.synced ? 'ចូល Google Sheet រួច' : 'រក្សាទុកក្នុង Local'})`,
        true
      );
      await loadAll();
    }
  } catch (err) {
    setFeedback('formFeedback', err.message, false);
  } finally {
    submitBtn.disabled = false;
  }
});

el('manualForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    date: el('mDate').value.trim(),
    type: el('mType').value,
    categories: el('mCategory').value,
    amount: Number(el('mAmount').value),
    currency: el('mCurrency').value,
    paymentMethod: el('mPayment').value.trim(),
    location: el('mLocation').value.trim(),
    description: el('mDescription').value.trim(),
  };

  const res = await fetch('/api/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    setFeedback('formFeedback', data.error || 'បរាជ័យ', false);
  } else {
    el('mAmount').value = '';
    el('mDescription').value = '';
    setFeedback('formFeedback', '✅ បានរក្សាទុកកំណត់ត្រា!', true);
    await loadAll();
  }
});

el('downloadExcelBtn').addEventListener('click', () => {
  const month = el('monthPicker').value;
  window.location.href = `/api/report/excel?month=${encodeURIComponent(month)}`;
});

el('sendTelegramBtn').addEventListener('click', async () => {
  const month = el('monthPicker').value;
  const btn = el('sendTelegramBtn');
  btn.disabled = true;
  try {
    const res = await fetch('/api/report/send-telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      alert(data.error || 'Cannot send report to Telegram');
    } else {
      alert(`✅ បានផ្ញើ File Excel ខែ ${month} ទៅ Telegram រួចរាល់!`);
    }
  } finally {
    btn.disabled = false;
  }
});

el('syncNowBtn').addEventListener('click', async () => {
  const res = await fetch('/api/sync', { method: 'POST' });
  const data = await res.json();
  alert(data.message || 'Done');
  await loadAll();
});

const openModal = () => el('setupModal').classList.remove('hidden');
const closeModal = () => el('setupModal').classList.add('hidden');
el('setupSheetBtn').addEventListener('click', openModal);
el('alertSetupBtn').addEventListener('click', openModal);
el('closeModalBtn').addEventListener('click', closeModal);

el('appsScriptForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = el('appsScriptUrlInput').value.trim();
  setFeedback('modalFeedback', 'កំពុងសាកល្បងភ្ជាប់...', true);
  const res = await fetch('/api/config/apps-script', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const data = await res.json();
  if (data.ok) {
    setFeedback('modalFeedback', `✅ ភ្ជាប់ជោគជ័យ! (${data.sync?.message || ''})`, true);
    await loadAll();
    setTimeout(closeModal, 1200);
  } else {
    setFeedback('modalFeedback', `❌ ${data.test?.error || data.error || 'Failed'}`, false);
  }
});

['monthPicker', 'typeFilter', 'currencyFilter', 'searchInput'].forEach((id) => {
  el(id).addEventListener('change', fetchTransactions);
  if (id === 'searchInput') {
    el(id).addEventListener('input', fetchTransactions);
  }
});

loadAll();
setInterval(fetchStatus, 15000);
