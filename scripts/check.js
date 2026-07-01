// ============================================================
//  مراقب نتائج الثالث المتوسط — صلاح الدين 2026
//  الطريقة: PDF (أكثر ثباتاً من API) | لا npm
// ============================================================

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

// ──────────── إعدادات ────────────
const TELEGRAM_TOKEN   = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error('❌ Secrets ناقصة: TELEGRAM_TOKEN أو TELEGRAM_CHAT_ID');
  process.exit(1);
}

const STUDENTS = [
  { name: 'خالد وليد جاسم محمد',    examNo: '182691150021598' },
  { name: 'سوزان زيد ابراهيم ناصر', examNo: '182692320600051' },
];

const BROWSER_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124',
  'Accept':          'text/html,application/xhtml+xml,application/json,*/*',
  'Accept-Language': 'ar,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate',
};

// ──────────── HTTP fetch ────────────
function fetchUrl(url, headers = {}, maxRedirects = 6) {
  return new Promise((resolve, reject) => {
    function doFetch(currentUrl, remaining) {
      const parsed = new URL(currentUrl);
      const lib    = parsed.protocol === 'https:' ? https : http;
      const req = lib.get(
        { hostname: parsed.hostname, path: parsed.pathname + parsed.search,
          headers: { ...BROWSER_HEADERS, ...headers } },
        (res) => {
          if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location && remaining > 0) {
            const next = new URL(res.headers.location, currentUrl).href;
            res.resume();
            return doFetch(next, remaining - 1);
          }
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
        }
      );
      req.setTimeout(20000, () => { req.destroy(); reject(new Error('TIMEOUT')); });
      req.on('error', reject);
    }
    doFetch(url, maxRedirects);
  });
}

// ──────────── curl download (أسرع للـ PDF) ────────────
function downloadFile(url, dest) {
  execSync(
    `curl -L -s -o "${dest}" ` +
    `--max-time 90 --retry 3 --retry-delay 2 ` +
    `--user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" ` +
    `"${url}"`,
    { stdio: 'inherit' }
  );
}

// ──────────── Telegram ────────────
async function sendTelegram(text) {
  const body = JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' });
  const res  = await fetchUrl(
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
    { 'Content-Type': 'application/json' }
  );
  // Telegram POST — نستخدم https.request مباشرة
  return new Promise((resolve, reject) => {
    const parsed = new URL(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`);
    const req = https.request(
      { hostname: parsed.hostname, path: parsed.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        const c = []; res.on('data', d => c.push(d));
        res.on('end', () => {
          const r = JSON.parse(Buffer.concat(c).toString());
          if (r.ok) { console.log('📨 تلغرام أُرسل'); resolve(); }
          else { console.error('❌ تلغرام خطأ:', r.description); resolve(); }
        });
      }
    );
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// ──────────── استخراج رابط PDF صلاح الدين ────────────
async function findPdfLink() {
  console.log('🌐 أبحث عن رابط صلاح الدين...');

  // المصادر بالترتيب
  const sources = [
    'https://results.edu2iq.net/',
    'https://results.mlazemna.com/rr26t/',
    'https://iraqedu.net/نتائج-الثالث-المتوسط/',
  ];

  for (const src of sources) {
    try {
      const res = await fetchUrl(src);
      if (res.status !== 200) continue;
      const html = res.text;

      // ابحث عن صلاح الدين + رابط Google Drive أو مباشر
      const patterns = [
        // Google Drive
        /صلاح[\s\S]{0,300}?href="(https:\/\/drive\.google\.com[^"]+)"/i,
        /صلاح الدين[\s\S]{0,500}?(https:\/\/drive\.google\.com\/[^\s"<]+)/i,
        // روابط مباشرة أخرى
        /صلاح الدين[\s\S]{0,500}?(https?:\/\/[^\s"<]+\.pdf)/i,
        // أي رابط بجانب صلاح الدين
        /href="(https?:\/\/[^"]+)"[^>]*>[^<]*صلاح/i,
      ];

      for (const pat of patterns) {
        const m = html.match(pat);
        if (m && m[1]) {
          console.log(`✅ رابط وُجد في ${src}: ${m[1]}`);
          return m[1];
        }
      }
      console.log(`  ⏳ ${src} — صلاح الدين لم تُعلن بعد`);
    } catch (e) {
      console.warn(`  ⚠️  ${src} → ${e.message}`);
    }
  }

  return null;
}

// ──────────── تحميل وفحص PDF ────────────
function searchPDF(pdfUrl) {
  const tmpDir = os.tmpdir();
  const id     = crypto.randomBytes(4).toString('hex');
  const pdf    = path.join(tmpDir, `results_${id}.pdf`);
  const txt    = path.join(tmpDir, `results_${id}.txt`);

  try {
    console.log('📥 تحميل PDF...');
    downloadFile(pdfUrl, pdf);

    const sizeMB = (fs.statSync(pdf).size / 1024 / 1024).toFixed(2);
    console.log(`📄 حجم الملف: ${sizeMB} MB`);

    console.log('🔍 استخراج النص...');
    execSync(`pdftotext -layout "${pdf}" "${txt}"`, { stdio: 'inherit' });

    const text  = fs.readFileSync(txt, 'utf8');
    const lines = text.split('\n');

    const found = [];

    for (const student of STUDENTS) {
      let matched = false;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(student.examNo)) {
          // سياق: 3 أسطر قبل + 3 بعد
          const ctx = lines.slice(Math.max(0, i - 3), i + 4).join('\n').trim();
          found.push({ student, context: ctx, line: i + 1 });
          matched = true;
          console.log(`✅ ${student.name} — سطر ${i + 1}`);
          break;
        }
      }
      if (!matched) {
        // جرب البحث بالاسم
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(student.name) || lines[i].includes(student.examNo.slice(-6))) {
            const ctx = lines.slice(Math.max(0, i - 2), i + 4).join('\n').trim();
            found.push({ student, context: ctx, line: i + 1 });
            matched = true;
            console.log(`✅ ${student.name} (بالاسم) — سطر ${i + 1}`);
            break;
          }
        }
      }
      if (!matched) {
        console.log(`❓ ${student.name} — لم يوجد في PDF`);
        found.push({ student, context: null });
      }
    }

    return found;
  } finally {
    // تنظيف
    try { fs.unlinkSync(pdf); } catch (_) {}
    try { fs.unlinkSync(txt); } catch (_) {}
  }
}

// ──────────── تنسيق رسالة التلغرام ────────────
function buildMessage(results, pdfUrl) {
  const time = new Date().toLocaleString('ar-IQ', { timeZone: 'Asia/Baghdad' });
  let msg = `🎓 <b>نتائج الثالث المتوسط 2026 — صلاح الدين</b>\n⏰ ${time}\n\n`;

  for (const r of results) {
    msg += `👤 <b>${r.student.name}</b>\n`;
    msg += `🔢 <code>${r.student.examNo}</code>\n`;
    if (r.context) {
      msg += `\n📊 <b>البيانات:</b>\n<pre>${r.context}</pre>\n`;
    } else {
      msg += `⚠️ لم يُعثر عليه في PDF\n`;
    }
    msg += '\n─────────────────\n\n';
  }

  msg += `🔗 <a href="${pdfUrl}">تحميل PDF الرسمي</a>`;
  return msg;
}

// ──────────── الحلقة الرئيسية ────────────
async function main() {
  const time = new Date().toLocaleString('ar-IQ', { timeZone: 'Asia/Baghdad' });
  console.log(`\n══════════════════════════════════`);
  console.log(`🔄 فحص — ${time}`);
  console.log(`══════════════════════════════════\n`);

  // 1. دور على رابط PDF صلاح الدين
  const pdfUrl = await findPdfLink();

  if (!pdfUrl) {
    console.log('\n📭 صلاح الدين: لم تُعلن بعد — الفحص القادم خلال 5 دقائق\n');
    return;
  }

  // 2. تحميل وفحص
  console.log('\n📊 PDF وُجد! أبدأ التحليل...\n');
  const results = searchPDF(pdfUrl);

  // 3. إرسال تلغرام
  const msg = buildMessage(results, pdfUrl);
  await sendTelegram(msg);
  console.log('\n✅ تم الإرسال\n');
}

main().catch(e => {
  console.error('💥 خطأ:', e.message);
  process.exit(1);
});
