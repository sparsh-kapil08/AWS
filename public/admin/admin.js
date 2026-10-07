/**
 * KhetVaani - Production Admin Operations Console Client JS
 */

let map;
let plotMarkers = [];
let eventCircles = [];

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initFormListeners();
  loadDashboardData();
  initAdminSSE();
});

function initMap() {
  map = L.map('map').setView([26.9124, 75.7873], 9);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(map);

  map.on('click', (e) => {
    document.getElementById('event-lat').value = e.latlng.lat.toFixed(4);
    document.getElementById('event-lon').value = e.latlng.lng.toFixed(4);
  });
}

function initFormListeners() {
  document.getElementById('form-create-event').addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = document.getElementById('event-type').value;
    const severity = document.getElementById('event-severity').value;
    const radius_km = document.getElementById('event-radius').value;
    const center_lat = document.getElementById('event-lat').value;
    const center_lon = document.getElementById('event-lon').value;

    try {
      const res = await fetch('/api/admin/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          severity,
          radius_km,
          center_lat,
          center_lon,
          simulated: false // Real production event
        })
      });
      const data = await res.json();
      if (data.success) {
        loadDashboardData();
      }
    } catch (err) {
      console.error('Failed to broadcast event:', err);
    }
  });

  document.getElementById('btn-preview-impact').addEventListener('click', handleRulePreview);
  document.getElementById('btn-confirm-rule-edit').addEventListener('click', handleRuleConfirm);
  document.getElementById('btn-cancel-rule-edit').addEventListener('click', () => {
    document.getElementById('modal-edit-rule').style.display = 'none';
  });
}

async function loadDashboardData() {
  try {
    const res = await fetch('/api/admin/dashboard');
    const data = await res.json();
    renderDashboard(data);
  } catch (err) {
    console.error('Failed to load dashboard:', err);
  }
}

function renderDashboard(data) {
  renderActiveEvents(data.event_stats || []);
  renderMapPlots(data.plots || []);
  renderFollowUpAlerts(data.follow_up_alerts || []);
  renderRules(data.flagged_rules || []);
}

function renderActiveEvents(events) {
  const container = document.getElementById('active-events-list');
  if (events.length === 0) {
    container.innerHTML = '<p class="empty-msg">No active weather alerts currently broadcasting.</p>';
    return;
  }

  container.innerHTML = events.map(e => `
    <div class="event-item-card ${e.severity}">
      <div>
        <strong>${e.type.toUpperCase()} ALERT</strong>
        <br>
        <small>Targeted: ${e.stats.targeted} | Delivered: ${e.stats.delivered} | Heard: ${e.stats.played} | Acked: ${e.stats.acked}</small>
      </div>
      <button class="resolve-btn" onclick="window.resolveEvent('${e.event_id}')">✔ Resolve</button>
    </div>
  `).join('');
}

window.resolveEvent = async function(eventId) {
  try {
    await fetch(`/api/admin/events/${eventId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' })
    });
    loadDashboardData();
  } catch (err) {
    console.error('Failed to resolve event:', err);
  }
};

function renderMapPlots(plots) {
  plotMarkers.forEach(m => map.removeLayer(m));
  plotMarkers = [];

  plots.forEach(plot => {
    const color = plot.current_level === 'red' ? '#dc2626' : plot.current_level === 'yellow' ? '#ca8a04' : '#15803d';
    const marker = L.circleMarker([plot.lat, plot.lon], {
      color,
      fillColor: color,
      fillOpacity: 0.8,
      radius: 10
    }).addTo(map);

    marker.bindPopup(`
      <b>Plot ID:</b> ${plot.id}<br>
      <b>Crop:</b> ${plot.crop}<br>
      <b>State:</b> ${plot.current_level.toUpperCase()}<br>
      <b>Lat/Lon:</b> ${plot.lat.toFixed(4)}, ${plot.lon.toFixed(4)}
    `);

    plotMarkers.push(marker);
  });
}

function renderFollowUpAlerts(alerts) {
  const container = document.getElementById('followup-list');
  if (alerts.length === 0) {
    container.innerHTML = '<p class="empty-msg">No delayed alerts requiring helper follow-up.</p>';
    return;
  }

  container.innerHTML = alerts.map(a => `
    <div class="event-item-card red">
      <div>
        <strong>Plot: ${a.plot_id}</strong> (${a.level.toUpperCase()})
        <br>
        <small>Created: ${new Date(a.created_at).toLocaleTimeString()} - Unopened >10m</small>
      </div>
      <button class="secondary-btn" style="padding: 4px 8px;">Contact Helper</button>
    </div>
  `).join('');
}

function renderRules(rules) {
  const container = document.getElementById('rules-grid');
  container.innerHTML = `
    <div class="rule-card flagged">
      <div><strong>wheat / crown_root_initiation</strong></div>
      <div>Threshold: 5 mm_48h | Severity: yellow</div>
      <div>Source: <span class="source-badge flagged">⚠️ PLACEHOLDER</span> (v1)</div>
      <button class="secondary-btn" style="margin-top: 8px;" onclick="window.openRuleEdit('rule_wheat_cri_rain', 5, 'mm_48h', 'yellow', 'PLACEHOLDER')">✏ Edit Rule</button>
    </div>
    <div class="rule-card flagged">
      <div><strong>mustard / flowering_pod_formation</strong></div>
      <div>Threshold: 4 temp_min | Severity: red</div>
      <div>Source: <span class="source-badge flagged">⚠️ PLACEHOLDER</span> (v1)</div>
      <button class="secondary-btn" style="margin-top: 8px;" onclick="window.openRuleEdit('rule_mustard_flowering_frost', 4, 'temp_min', 'red', 'PLACEHOLDER')">✏ Edit Rule</button>
    </div>
  `;
}

window.openRuleEdit = function(id, threshold, unit, severity, source) {
  document.getElementById('edit-rule-id').value = id;
  document.getElementById('edit-rule-label').value = id;
  document.getElementById('edit-rule-threshold').value = threshold;
  document.getElementById('edit-rule-unit').value = unit;
  document.getElementById('edit-rule-severity').value = severity;
  document.getElementById('edit-rule-source').value = source;
  document.getElementById('preview-result-box').style.display = 'none';
  document.getElementById('modal-edit-rule').style.display = 'flex';
};

async function handleRulePreview() {
  const ruleId = document.getElementById('edit-rule-id').value;
  const threshold = document.getElementById('edit-rule-threshold').value;
  const unit = document.getElementById('edit-rule-unit').value;
  const severity = document.getElementById('edit-rule-severity').value;

  try {
    const res = await fetch(`/api/admin/rules/${ruleId}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threshold, unit, severity })
    });
    const data = await res.json();
    
    const box = document.getElementById('preview-result-box');
    const text = document.getElementById('preview-summary-text');
    box.style.display = 'block';
    text.innerText = `Updating this rule will change alert status for ${data.preview.affected_plots_count} plot(s).`;
  } catch (err) {
    console.error('Preview error:', err);
  }
}

async function handleRuleConfirm() {
  const ruleId = document.getElementById('edit-rule-id').value;
  const threshold = document.getElementById('edit-rule-threshold').value;
  const unit = document.getElementById('edit-rule-unit').value;
  const severity = document.getElementById('edit-rule-severity').value;
  const source = document.getElementById('edit-rule-source').value;

  try {
    const res = await fetch(`/api/admin/rules/${ruleId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threshold, unit, severity, source, user: 'admin_console' })
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('modal-edit-rule').style.display = 'none';
      loadDashboardData();
    }
  } catch (err) {
    console.error('Confirm error:', err);
  }
}

function initAdminSSE() {
  const evtSource = new EventSource('/api/admin/dashboard/stream');
  const pill = document.getElementById('live-pill');

  evtSource.onopen = () => {
    pill.innerText = '🟢 LIVE Production Sync Active (<5s)';
    pill.style.backgroundColor = '#059669';
  };

  evtSource.onmessage = () => {
    loadDashboardData();
  };

  evtSource.onerror = () => {
    pill.innerText = '🟡 Reconnecting SSE...';
    pill.style.backgroundColor = '#d97706';
    evtSource.close();
    setTimeout(() => {
      initAdminSSE();
    }, 3000);
  };
}

// ── El Niño / NOAA ONI Panel ─────────────────────────────────────────────────

async function loadElNinoPanel() {
  try {
    const res = await fetch('/api/admin/el-nino');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    document.getElementById('oni-value').textContent = data.latest_oni != null ? `${data.latest_oni > 0 ? '+' : ''}${data.latest_oni}` : '–';
    document.getElementById('oni-sample-size').textContent = data.sample_size ?? '–';
    document.getElementById('oni-season').textContent = data.season && data.year ? `${data.season} ${data.year}` : '–';
    document.getElementById('oni-hist-min').textContent = data.historical_spread?.min ?? '–';
    document.getElementById('oni-hist-max').textContent = data.historical_spread?.max ?? '–';
    document.getElementById('oni-std-dev').textContent = data.historical_spread?.std_dev ? `±${data.historical_spread.std_dev}` : '–';
    document.getElementById('oni-uncertainty').textContent = data.uncertainty_label || 'uncertain';

    // Status badge with color coding
    const badge = document.getElementById('oni-status-badge');
    const statusMap = {
      el_nino: { label: '🔥 El Niño', color: '#dc2626' },
      la_nina:  { label: '🌊 La Niña', color: '#2563eb' },
      neutral:  { label: '⚪ Neutral',  color: '#64748b' }
    };
    const s = statusMap[data.status] || { label: data.status || '–', color: '#64748b' };
    badge.textContent = s.label;
    badge.style.backgroundColor = s.color;
    badge.style.color = '#fff';
    badge.style.padding = '4px 12px';
    badge.style.borderRadius = '20px';
    badge.style.fontSize = '0.9rem';
    badge.style.fontWeight = '700';

    // Farmer sentence (shown only if El Niño or La Niña)
    const farmerMsg = document.getElementById('elnino-farmer-msg');
    const farmerSentenceEl = document.getElementById('elnino-farmer-sentence');
    if (data.farmer_sentence_hi) {
      farmerSentenceEl.textContent = `"${data.farmer_sentence_hi}"`;
      farmerMsg.style.display = 'block';
    } else {
      farmerMsg.style.display = 'none';
    }

    // Fetch timestamp
    const fetchedAt = data.fetched_at ? new Date(data.fetched_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '–';
    document.getElementById('oni-fetched-at').textContent = `Source: ${data.source || 'api'} | Last fetched: ${fetchedAt} IST`;

  } catch (err) {
    document.getElementById('oni-fetched-at').textContent = `Error loading ONI data: ${err.message}`;
    console.error('[Admin] El Niño panel load failed:', err);
  }
}

// Auto-load and refresh button
document.addEventListener('DOMContentLoaded', () => {
  loadElNinoPanel();
  document.getElementById('btn-refresh-elnino').addEventListener('click', loadElNinoPanel);
});
