#!/usr/bin/env node
/**
 * build-insights.js
 * HUB CertSecure — Vendor History & Program Summary Builder
 *
 * Reads ALL daily snapshots, builds two persistent insight files:
 *   snapshots/insights/vendor_history.csv   — per-vendor NC journey
 *   snapshots/insights/program_summary.csv  — monthly rolled-up program view
 *
 * Run: node scripts/build-insights.js
 * Called by sync.yml at end of month after snapshot is taken.
 */

const fs   = require('fs');
const path = require('path');

// ── CSV helpers ───────────────────────────────────────────────────────────────

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (!lines.length) return [];
  const headers = splitCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = splitCSVLine(line);
    const row  = {};
    headers.forEach((h, i) => { row[h.trim()] = (vals[i] || '').trim(); });
    return row;
  }).filter(r => Object.values(r).some(v => v));
}

function splitCSVLine(line) {
  const result = [];
  let cur = '', inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i+1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      result.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

function toCSV(rows, headers) {
  const escape = v => {
    const s = String(v == null ? '' : v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')];
  rows.forEach(r => lines.push(headers.map(h => escape(r[h])).join(',')));
  return lines.join('\n') + '\n';
}

function readCSVSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    return parseCSV(fs.readFileSync(filePath, 'utf8'));
  } catch(e) {
    console.warn(`  [warn] Could not read ${filePath}: ${e.message}`);
    return [];
  }
}

// ── Column name normalisation (matches PRT's C constants) ─────────────────────

function getStatus(row) {
  const raw = (row['compliance_status'] || row['status'] || row['overall_compliance'] || '').toLowerCase().trim();
  if (raw === 'compliant' || raw === 'in_compliance') return 'compliant';
  if (raw === 'non_compliant' || raw === 'non-compliant' || raw === 'noncompliant' || raw === 'out_of_compliance') return 'non_compliant';
  return 'unknown';
}

function getClient(row) {
  return (row['client'] || row['client_name'] || row['program'] || '').trim();
}

function getVendor(row) {
  return (row['entity_name'] || row['insured_name'] || row['vendor_name'] || row['name'] || '').trim();
}

function getPlatform(row) {
  return (row['platform'] || row['source'] || '').trim() || 'evident';
}

function isActive(row) {
  return row['active'] !== 'false' && row['paused'] !== 'true';
}

// ── Snapshot discovery ────────────────────────────────────────────────────────

function findAllSnapshots() {
  const snapshots = []; // { date: 'YYYY-MM-DD', evPath, tlPath }

  // Evident: snapshots/YYYY/YYYY-MM-DD/
  const evBase = path.join('snapshots');
  if (!fs.existsSync(evBase)) {
    console.warn('[warn] snapshots/ directory not found — nothing to process');
    return [];
  }

  const years = fs.readdirSync(evBase)
    .filter(d => /^\d{4}$/.test(d) && fs.statSync(path.join(evBase, d)).isDirectory());

  const dateMap = {}; // date -> { evPath, tlPath }

  for (const yr of years) {
    const yrPath = path.join(evBase, yr);
    const dirs   = fs.readdirSync(yrPath)
      .filter(d => fs.statSync(path.join(yrPath, d)).isDirectory());

    for (const dir of dirs) {
      // Accept both YYYY-MM-DD (daily) and YYYY-MM (legacy monthly)
      let date = null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(dir)) {
        date = dir; // already a full date
      } else if (/^\d{4}-\d{2}$/.test(dir)) {
        date = dir + '-01'; // treat monthly as 1st of month
      }
      if (!date) continue;
      if (!dateMap[date]) dateMap[date] = { date, evPath: null, tlPath: null };
      dateMap[date].evPath = path.join(yrPath, dir);
    }
  }

  // TrustLayer: snapshots/trustlayer/YYYY/YYYY-MM-DD/
  const tlBase = path.join('snapshots', 'trustlayer');
  if (fs.existsSync(tlBase)) {
    const tlYears = fs.readdirSync(tlBase)
      .filter(d => /^\d{4}$/.test(d) && fs.statSync(path.join(tlBase, d)).isDirectory());

    for (const yr of tlYears) {
      const yrPath = path.join(tlBase, yr);
      const dirs   = fs.readdirSync(yrPath)
        .filter(d => fs.statSync(path.join(yrPath, d)).isDirectory());

      for (const dir of dirs) {
        let date = null;
        if (/^\d{4}-\d{2}-\d{2}$/.test(dir)) date = dir;
        else if (/^\d{4}-\d{2}$/.test(dir))   date = dir + '-01';
        if (!date) continue;
        if (!dateMap[date]) dateMap[date] = { date, evPath: null, tlPath: null };
        dateMap[date].tlPath = path.join(tlBase, yr, dir);
      }
    }
  }

  return Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));
}

// ── Main build ────────────────────────────────────────────────────────────────

function build() {
  console.log('=== HUB CertSecure — build-insights.js ===');

  const snapshots = findAllSnapshots();
  if (!snapshots.length) {
    console.log('No snapshots found. Exiting.');
    return;
  }
  console.log(`Found ${snapshots.length} snapshot(s): ${snapshots[0].date} → ${snapshots[snapshots.length-1].date}`);

  // vendor_key -> full history object
  // vendor_key = `${client}||${vendor_name}||${platform}`
  const vendorMap = {};

  const getVK = (client, vendor, platform) =>
    `${client.toLowerCase()}||${vendor.toLowerCase()}||${platform}`;

  const ensureVendor = (client, vendor, platform) => {
    const vk = getVK(client, vendor, platform);
    if (!vendorMap[vk]) {
      vendorMap[vk] = {
        client, vendor_name: vendor, platform,
        // Array of { date, status } — one entry per snapshot the vendor appears in
        timeline: []
      };
    }
    return vendorMap[vk];
  };

  // ── Pass 1: Build per-vendor timelines ──────────────────────────────────────
  for (const snap of snapshots) {
    const rows = [];

    if (snap.evPath) {
      const ins = readCSVSafe(path.join(snap.evPath, 'insureds.csv'));
      ins.forEach(r => { if (isActive(r)) rows.push({ ...r, _platform: 'evident' }); });
    }
    if (snap.tlPath) {
      const ins = readCSVSafe(path.join(snap.tlPath, 'insureds.csv'));
      ins.forEach(r => { if (isActive(r)) rows.push({ ...r, _platform: 'trustlayer' }); });
    }

    if (!rows.length) {
      console.log(`  [${snap.date}] No active rows found — skipping`);
      continue;
    }

    const seen = new Set();
    for (const row of rows) {
      const client   = getClient(row);
      const vendor   = getVendor(row);
      const platform = getPlatform(row) || row._platform;
      const status   = getStatus(row);
      if (!client || !vendor || status === 'unknown') continue;

      const vk = getVK(client, vendor, platform);
      if (seen.has(vk)) continue; // dedupe within same snapshot
      seen.add(vk);

      const v = ensureVendor(client, vendor, platform);
      v.timeline.push({ date: snap.date, status });
    }

    console.log(`  [${snap.date}] ${rows.length} active rows, ${seen.size} unique vendor-client pairs`);
  }

  // ── Pass 2: Compute derived fields per vendor ───────────────────────────────
  const vendorHistory = [];

  for (const v of Object.values(vendorMap)) {
    const tl = v.timeline; // already sorted by date (snapshots were sorted)
    if (!tl.length) continue;

    let firstNCDate         = null;
    let lastNCDate          = null;
    let lastCureDate        = null;
    let consecutiveNC       = 0;
    let totalNCEpisodes     = 0;
    let cureDurations       = []; // array of cure durations in days
    let inNC                = false;
    let episodeStartDate    = null;

    for (const pt of tl) {
      if (pt.status === 'non_compliant') {
        if (!inNC) {
          // Started a new NC episode
          inNC             = true;
          episodeStartDate = pt.date;
          totalNCEpisodes++;
          if (!firstNCDate) firstNCDate = pt.date;
        }
        lastNCDate = pt.date;
        consecutiveNC++;
      } else if (pt.status === 'compliant') {
        if (inNC) {
          // Cured — compute duration from episode start to this date
          const start = new Date(episodeStartDate);
          const end   = new Date(pt.date);
          const days  = Math.round((end - start) / (1000 * 60 * 60 * 24));
          cureDurations.push(days);
          lastCureDate  = pt.date;
          inNC          = false;
          consecutiveNC = 0;
          episodeStartDate = null;
        } else {
          consecutiveNC = 0;
        }
      }
    }

    // If still NC at end of timeline, consecutiveNC is days since episode start
    if (inNC && episodeStartDate) {
      const start   = new Date(episodeStartDate);
      const lastSnap= new Date(tl[tl.length-1].date);
      consecutiveNC = Math.round((lastSnap - start) / (1000 * 60 * 60 * 24));
    }

    const currentStatus = tl[tl.length-1].status;
    const avgCureDays   = cureDurations.length
      ? Math.round(cureDurations.reduce((a,b) => a+b, 0) / cureDurations.length)
      : null;

    vendorHistory.push({
      client:               v.client,
      vendor_name:          v.vendor_name,
      platform:             v.platform,
      current_status:       currentStatus,
      first_nc_date:        firstNCDate    || '',
      last_nc_date:         lastNCDate     || '',
      last_cure_date:       lastCureDate   || '',
      consecutive_nc_days:  inNC ? consecutiveNC : 0,
      total_nc_episodes:    totalNCEpisodes,
      avg_cure_days:        avgCureDays    != null ? avgCureDays : '',
      is_repeat_offender:   totalNCEpisodes >= 2 ? 'true' : 'false',
      snapshot_count:       tl.length
    });
  }

  console.log(`\nVendor history: ${vendorHistory.length} vendor-client records`);

  // ── Pass 3: Build monthly program summary ───────────────────────────────────
  // Group snapshots by YYYY-MM
  const monthBuckets = {};
  for (const snap of snapshots) {
    const mo = snap.date.slice(0, 7); // YYYY-MM
    if (!monthBuckets[mo]) monthBuckets[mo] = [];
    monthBuckets[mo].push(snap);
  }

  // For program_summary we want end-of-month state
  // Use the last snapshot in each month bucket
  const programSummary = [];

  const sortedMonths = Object.keys(monthBuckets).sort();
  let prevMonthVendorStatus = {}; // vendor_key -> status (for newly_nc / newly_cured)

  for (const mo of sortedMonths) {
    const bucket      = monthBuckets[mo];
    const lastSnap    = bucket[bucket.length - 1];

    // Build current month's vendor status map from vendor history
    // (take the last known status up to and including this month)
    const thisMonthStatus = {}; // vendor_key -> status
    for (const v of Object.values(vendorMap)) {
      const vk = getVK(v.client, v.vendor_name, v.platform);
      // Find last timeline entry <= last day of this month
      const lastEntry = [...v.timeline]
        .filter(pt => pt.date <= lastSnap.date)
        .pop();
      if (lastEntry) thisMonthStatus[vk] = lastEntry.status;
    }

    // Count stats
    let ncCount        = 0;
    let compliantCount = 0;
    let newlyNC        = 0;
    let newlyCured     = 0;
    let chronicNC      = 0; // NC for 60+ days

    for (const [vk, status] of Object.entries(thisMonthStatus)) {
      if (status === 'non_compliant') {
        ncCount++;
        const prev = prevMonthVendorStatus[vk];
        if (prev === 'compliant' || !prev) newlyNC++;
        // Check if chronic (60+ consecutive days NC)
        const vData = vendorHistory.find(vh =>
          getVK(vh.client, vh.vendor_name, vh.platform) === vk
        );
        if (vData && vData.consecutive_nc_days >= 60) chronicNC++;
      } else if (status === 'compliant') {
        compliantCount++;
        const prev = prevMonthVendorStatus[vk];
        if (prev === 'non_compliant') newlyCured++;
      }
    }

    // Average cure days for vendors who cured THIS month
    const curedThisMonth = vendorHistory.filter(v => {
      if (!v.last_cure_date) return false;
      return v.last_cure_date.slice(0, 7) === mo;
    });
    const avgCureDays = curedThisMonth.length
      ? Math.round(curedThisMonth.reduce((a,b) => a + (Number(b.avg_cure_days)||0), 0) / curedThisMonth.length)
      : '';

    const repeatOffenders = vendorHistory.filter(v =>
      v.is_repeat_offender === 'true' &&
      thisMonthStatus[getVK(v.client, v.vendor_name, v.platform)] === 'non_compliant'
    ).length;

    const total = ncCount + compliantCount;
    const rate  = total ? Math.round(compliantCount / total * 100) : '';

    programSummary.push({
      month:                    mo,
      total_active:             total,
      compliant_count:          compliantCount,
      nc_count:                 ncCount,
      compliance_rate_pct:      rate,
      newly_nc:                 newlyNC,
      newly_cured:              newlyCured,
      chronic_nc_count:         chronicNC,
      repeat_offender_nc_count: repeatOffenders,
      avg_cure_days:            avgCureDays,
      snapshot_days_in_month:   bucket.length
    });

    prevMonthVendorStatus = { ...thisMonthStatus };
  }

  console.log(`Program summary: ${programSummary.length} monthly rows`);

  // ── Write output files ──────────────────────────────────────────────────────
  const insightsDir = path.join('snapshots', 'insights');
  fs.mkdirSync(insightsDir, { recursive: true });

  const vhHeaders = [
    'client','vendor_name','platform','current_status',
    'first_nc_date','last_nc_date','last_cure_date',
    'consecutive_nc_days','total_nc_episodes','avg_cure_days',
    'is_repeat_offender','snapshot_count'
  ];
  fs.writeFileSync(
    path.join(insightsDir, 'vendor_history.csv'),
    toCSV(vendorHistory, vhHeaders),
    'utf8'
  );
  console.log(`\nWrote: snapshots/insights/vendor_history.csv (${vendorHistory.length} rows)`);

  const psHeaders = [
    'month','total_active','compliant_count','nc_count','compliance_rate_pct',
    'newly_nc','newly_cured','chronic_nc_count','repeat_offender_nc_count',
    'avg_cure_days','snapshot_days_in_month'
  ];
  fs.writeFileSync(
    path.join(insightsDir, 'program_summary.csv'),
    toCSV(programSummary, psHeaders),
    'utf8'
  );
  console.log(`Wrote: snapshots/insights/program_summary.csv (${programSummary.length} rows)`);
  console.log('\n=== build-insights.js complete ===');
}

build();
