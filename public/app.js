// ─── 상수 ───────────────────────────────────────────────────────────────────
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const TIME_LABELS = {
  '아침 식전': '🌅 아침 식전',
  '아침 식후': '🌅 아침 식후',
  '점심 식전': '☀️ 점심 식전',
  '점심 식후': '☀️ 점심 식후',
  '저녁 식전': '🌙 저녁 식전',
  '저녁 식후': '🌙 저녁 식후',
  '자기 전':   '🛌 자기 전',
};

let supplements = [];
let editingId   = null;
let selectedDbId = null;

// ─── 초기화 ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  initDayButtons('addDaysGrid');
  initDayButtons('editDaysGrid');
  initTimeButtons('addTimesGrid');
  initTimeButtons('editTimesGrid');

  document.getElementById('addCustomTime').addEventListener('keypress', e => {
    if (e.key === 'Enter') addCustomTimeBtn('addTimesGrid', 'addCustomTime');
  });
  document.getElementById('editCustomTime').addEventListener('keypress', e => {
    if (e.key === 'Enter') addCustomTimeBtn('editTimesGrid', 'editCustomTime');
  });

  // URL에 에러 파라미터가 있으면 표시
  const params = new URLSearchParams(location.search);
  if (params.get('error')) {
    const el = document.getElementById('loginError');
    el.textContent = '로그인에 실패했습니다. 다시 시도해주세요.';
    el.classList.add('show');
    history.replaceState({}, '', '/');
  }
});

// ─── 인증 ────────────────────────────────────────────────────────────────────
async function checkAuth() {
  const res    = await fetch('/api/auth/status');
  const status = await res.json();

  if (!status.loggedIn) {
    show('loginScreen');
    return;
  }

  if (!status.databaseId) {
    show('dbScreen');
    loadDatabases();
    return;
  }

  selectedDbId = status.databaseId;
  document.getElementById('workspaceBadge').textContent = status.workspaceName || '';
  show('mainApp');
  initMain();
}

function show(id) {
  ['loginScreen', 'dbScreen', 'mainApp'].forEach(s => {
    const el = document.getElementById(s);
    if (s === 'mainApp') {
      el.style.display = s === id ? 'block' : 'none';
    } else {
      el.classList.toggle('hidden', s !== id);
    }
  });
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.reload();
}

// ─── DB 선택 ─────────────────────────────────────────────────────────────────
async function loadDatabases() {
  const listEl = document.getElementById('dbList');
  try {
    const res    = await fetch('/api/databases');
    const result = await res.json();
    if (!result.success) throw new Error(result.error);

    if (result.data.length === 0) {
      listEl.innerHTML = '<div style="text-align:center;color:var(--text-sub);font-size:13px;padding:20px">접근 가능한 데이터베이스가 없습니다<br>Notion에서 Integration에 DB를 공유해주세요</div>';
      return;
    }

    listEl.innerHTML = result.data.map(db => `
      <button class="db-item" data-id="${db.id}" onclick="selectDbItem(this)">
        📋 ${escapeHtml(db.title)}
      </button>
    `).join('');
  } catch (err) {
    listEl.innerHTML = `<div style="color:var(--error);font-size:13px;padding:10px">오류: ${err.message}</div>`;
  }
}

function selectDbItem(el) {
  document.querySelectorAll('.db-item').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  selectedDbId = el.dataset.id;
  document.getElementById('dbConfirmBtn').disabled = false;
}

async function confirmDatabase() {
  if (!selectedDbId) return;
  const res    = await fetch('/api/databases/select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ databaseId: selectedDbId }),
  });
  const result = await res.json();
  if (result.success) {
    show('mainApp');
    initMain();
  }
}

// ─── 메인 앱 초기화 ──────────────────────────────────────────────────────────
function initMain() {
  setToday();
  loadSupplements();
  document.getElementById('suppName').addEventListener('keypress', e => {
    if (e.key === 'Enter') addSupplement();
  });
  document.getElementById('startDate').addEventListener('change', renderWeekPreview);
}

// ─── 탭 전환 ─────────────────────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((btn, i) => {
    btn.classList.toggle('active', (i === 0 && tab === 'setup') || (i === 1 && tab === 'schedule'));
  });
  document.getElementById('tab-setup').classList.toggle('active', tab === 'setup');
  document.getElementById('tab-schedule').classList.toggle('active', tab === 'schedule');
  if (tab === 'schedule') renderWeekPreview();
}

// ─── 날짜 ────────────────────────────────────────────────────────────────────
function setToday() {
  const today = new Date();
  document.getElementById('startDate').value = toDateStr(today);
  renderWeekPreview();
}

function toDateStr(date) {
  return date.toISOString().split('T')[0];
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ─── 요일 버튼 ───────────────────────────────────────────────────────────────
function initDayButtons(gridId) {
  document.querySelectorAll(`#${gridId} .day-btn`).forEach(btn => {
    btn.addEventListener('click', () => btn.classList.toggle('selected'));
  });
}

function getSelectedDays(gridId) {
  return [...document.querySelectorAll(`#${gridId} .day-btn.selected`)]
    .map(btn => parseInt(btn.dataset.day));
}

function setSelectedDays(gridId, days) {
  document.querySelectorAll(`#${gridId} .day-btn`).forEach(btn => {
    btn.classList.toggle('selected', days.includes(parseInt(btn.dataset.day)));
  });
}

function selectAllDays(gridId) {
  document.querySelectorAll(`#${gridId} .day-btn[data-day]`).forEach(btn => btn.classList.add('selected'));
}

function selectWeekdays(gridId) {
  document.querySelectorAll(`#${gridId} .day-btn[data-day]`).forEach(btn => {
    const day = parseInt(btn.dataset.day);
    btn.classList.toggle('selected', day >= 1 && day <= 5);
  });
}

function selectWeekend(gridId) {
  document.querySelectorAll(`#${gridId} .day-btn[data-day]`).forEach(btn => {
    const day = parseInt(btn.dataset.day);
    btn.classList.toggle('selected', day === 0 || day === 6);
  });
}

// ─── 복용 시간 토글 버튼 ─────────────────────────────────────────────────────
function initTimeButtons(gridId) {
  document.querySelectorAll(`#${gridId} .time-toggle-btn`).forEach(btn => {
    btn.addEventListener('click', () => btn.classList.toggle('selected'));
  });
}

function getSelectedTimes(gridId) {
  return [...document.querySelectorAll(`#${gridId} .time-toggle-btn.selected`)]
    .map(btn => btn.dataset.time);
}

function setSelectedTimes(gridId, times) {
  const arr = toTimeArray(times);
  document.querySelectorAll(`#${gridId} .time-toggle-btn`).forEach(btn => {
    btn.classList.toggle('selected', arr.includes(btn.dataset.time));
  });
}

function toTimeArray(time) {
  return Array.isArray(time) ? time : (time ? [time] : []);
}

function timeCssClass(t) {
  return 'time-' + t.replace(/\s+/g, '-');
}

function addCustomTimeBtn(gridId, inputId) {
  const input = document.getElementById(inputId);
  const value = input.value.trim();
  if (!value) return;

  const grid    = document.getElementById(gridId);
  const existing = grid.querySelector(`.time-toggle-btn[data-time="${value}"]`);
  if (existing) {
    existing.classList.add('selected');
    input.value = '';
    return;
  }

  const btn = document.createElement('button');
  btn.className    = 'time-toggle-btn selected';
  btn.dataset.time = value;
  btn.textContent  = value;
  btn.addEventListener('click', () => btn.classList.toggle('selected'));
  grid.appendChild(btn);
  input.value = '';
}

// ─── 영양제 로드 ─────────────────────────────────────────────────────────────
async function loadSupplements() {
  try {
    const res = await fetch('/api/supplements');
    const result = await res.json();
    if (!result.success) throw new Error(result.error);
    supplements = result.data;
    renderSuppList();
  } catch (err) {
    showToast('영양제 목록 로딩 실패: ' + err.message);
  }
}

function renderSuppList() {
  const container = document.getElementById('suppList');
  const count = document.getElementById('suppCount');
  count.textContent = supplements.length > 0 ? `(${supplements.length}개)` : '';

  if (supplements.length === 0) {
    container.innerHTML = '<div class="empty-state">등록된 영양제가 없습니다<br>위에서 영양제를 추가해보세요</div>';
    return;
  }

  const order = ['아침 식전', '아침 식후', '점심 식전', '점심 식후', '저녁 식전', '저녁 식후', '자기 전'];
  const minTimeIdx = s => Math.min(...toTimeArray(s.time).map(t => order.indexOf(t)).filter(i => i !== -1));
  const sorted = [...supplements].sort((a, b) => minTimeIdx(a) - minTimeIdx(b));

  container.innerHTML = sorted.map(supp => {
    const times = toTimeArray(supp.time);
    const timeBadges = times.map(t =>
      `<span class="time-badge ${timeCssClass(t)}">${TIME_LABELS[t] || t}</span>`
    ).join(' ');
    const daysText = supp.days.sort((a,b)=>a-b).map(d => DAY_NAMES[d]).join(' ');
    return `
      <div class="supp-item">
        <div class="supp-info">
          <div class="supp-name">${escapeHtml(supp.name)}</div>
          <div class="supp-meta">
            ${timeBadges}
            <span style="margin-left:4px;font-weight:700;color:var(--text)">${supp.qty ?? 1}개</span>
            &nbsp;${daysText}
          </div>
        </div>
        <div class="supp-actions">
          <button class="btn btn-edit btn-sm" onclick="openEditModal('${supp.id}')">수정</button>
          <button class="btn btn-danger btn-sm" onclick="deleteSupplement('${supp.id}')">삭제</button>
        </div>
      </div>
    `;
  }).join('');
}

// ─── 영양제 추가 ─────────────────────────────────────────────────────────────
async function addSupplement() {
  const name = document.getElementById('suppName').value.trim();
  const qty  = parseInt(document.getElementById('suppQty').value) || 1;
  const time = getSelectedTimes('addTimesGrid');
  const days = getSelectedDays('addDaysGrid');

  if (!name)           return showToast('영양제 이름을 입력해주세요');
  if (time.length === 0) return showToast('복용 시간을 하나 이상 선택해주세요');
  if (days.length === 0) return showToast('복용 요일을 하나 이상 선택해주세요');

  try {
    const res = await fetch('/api/supplements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, qty, time, days })
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error);

    supplements.push(result.data);
    renderSuppList();

    document.getElementById('suppName').value = '';
    document.getElementById('suppQty').value = '1';
    setSelectedTimes('addTimesGrid', []);
    setSelectedDays('addDaysGrid', []);

    showToast(`✓ "${name}" 추가 완료`);
    renderWeekPreview();
  } catch (err) {
    showToast('추가 실패: ' + err.message);
  }
}

// ─── 영양제 삭제 ─────────────────────────────────────────────────────────────
async function deleteSupplement(id) {
  const supp = supplements.find(s => s.id === id);
  if (!supp) return;
  if (!confirm(`"${supp.name}"을 삭제할까요?`)) return;

  try {
    const res = await fetch(`/api/supplements/${id}`, { method: 'DELETE' });
    const result = await res.json();
    if (!result.success) throw new Error(result.error);

    supplements = supplements.filter(s => s.id !== id);
    renderSuppList();
    renderWeekPreview();
    showToast(`"${supp.name}" 삭제됨`);
  } catch (err) {
    showToast('삭제 실패: ' + err.message);
  }
}

// ─── 영양제 수정 (모달) ──────────────────────────────────────────────────────
function openEditModal(id) {
  const supp = supplements.find(s => s.id === id);
  if (!supp) return;

  editingId = id;
  document.getElementById('editName').value = supp.name;
  document.getElementById('editQty').value = supp.qty ?? 1;
  setSelectedTimes('editTimesGrid', supp.time);
  setSelectedDays('editDaysGrid', supp.days);
  document.getElementById('editModal').classList.add('open');
}

function closeEditModal() {
  editingId = null;
  document.getElementById('editModal').classList.remove('open');
}

async function saveEdit() {
  if (!editingId) return;

  const name = document.getElementById('editName').value.trim();
  const qty  = parseInt(document.getElementById('editQty').value) || 1;
  const time = getSelectedTimes('editTimesGrid');
  const days = getSelectedDays('editDaysGrid');

  if (!name)           return showToast('영양제 이름을 입력해주세요');
  if (time.length === 0) return showToast('복용 시간을 하나 이상 선택해주세요');
  if (days.length === 0) return showToast('복용 요일을 하나 이상 선택해주세요');

  try {
    const res = await fetch(`/api/supplements/${editingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, qty, time, days })
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error);

    const idx = supplements.findIndex(s => s.id === editingId);
    supplements[idx] = result.data;
    renderSuppList();
    renderWeekPreview();
    closeEditModal();
    showToast(`✓ "${name}" 수정 완료`);
  } catch (err) {
    showToast('수정 실패: ' + err.message);
  }
}

// 모달 바깥 클릭시 닫기
document.getElementById('editModal').addEventListener('click', function(e) {
  if (e.target === this) closeEditModal();
});

// ─── 주간 미리보기 ────────────────────────────────────────────────────────────
function renderWeekPreview() {
  const container = document.getElementById('weekPreview');
  const startDateVal = document.getElementById('startDate')?.value;
  if (!startDateVal) return;

  if (supplements.length === 0) {
    container.innerHTML = '<div style="font-size:13px;color:var(--text-sub);padding:8px 0">⚙️ 영양제 설정 탭에서 영양제를 먼저 등록해주세요</div>';
    return;
  }

  const startDate = new Date(startDateVal + 'T00:00:00');
  const rows = [];

  for (let offset = 0; offset < 7; offset++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + offset);
    const dow = date.getDay();
    const dateStr = toDateStr(date);
    const daySupps = supplements.filter(s => s.days.includes(dow));

    const order = ['아침 식전', '아침 식후', '점심 식전', '점심 식후', '저녁 식전', '저녁 식후', '자기 전'];
    daySupps.sort((a, b) => {
      const aMin = Math.min(...toTimeArray(a.time).map(t => order.indexOf(t)).filter(i => i !== -1));
      const bMin = Math.min(...toTimeArray(b.time).map(t => order.indexOf(t)).filter(i => i !== -1));
      return aMin - bMin;
    });

    const isToday = dateStr === toDateStr(new Date());
    const isWeekend = dow === 0 || dow === 6;

    rows.push(`
      <div class="day-row">
        <div class="day-label" style="color:${isWeekend ? '#ef4444' : 'var(--text-sub)'}${isToday ? ';font-size:13px;color:var(--primary)' : ''}">
          ${DAY_NAMES[dow]}<br>
          <span class="day-date">${formatDate(dateStr)}</span>
          ${isToday ? '<br><span style="font-size:10px;color:var(--primary)">오늘</span>' : ''}
        </div>
        <div class="day-supplements">
          ${daySupps.length > 0
            ? daySupps.map(s => {
                const times = toTimeArray(s.time).join(', ');
                return `<span class="supp-pill">${escapeHtml(s.name)}<span style="opacity:.6;margin-left:3px;font-size:10px">${times}</span></span>`;
              }).join('')
            : '<span class="no-supp">복용 없음</span>'
          }
        </div>
      </div>
    `);
  }

  const totalEntries = supplements.reduce((sum, s) => {
    const timeCount = toTimeArray(s.time).length;
    let count = 0;
    for (let offset = 0; offset < 7; offset++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + offset);
      if (s.days.includes(date.getDay())) count += timeCount;
    }
    return sum + count;
  }, 0);

  container.innerHTML = rows.join('') +
    `<div style="font-size:12px;color:var(--text-sub);text-align:right;margin-top:8px">총 ${totalEntries}개 항목이 추가됩니다</div>`;
}

// ─── 노션에 일주일 일정 추가 ─────────────────────────────────────────────────
let lastCreatedPageIds = [];

async function addWeeklySchedule() {
  if (supplements.length === 0) {
    showToast('⚙️ 먼저 영양제를 설정해주세요');
    switchTab('setup');
    return;
  }

  const startDate = document.getElementById('startDate').value;
  const btn = document.getElementById('addWeekBtn');
  const resultBox = document.getElementById('scheduleResult');

  btn.disabled = true;
  btn.textContent = '⏳ 추가 중...';
  resultBox.className = 'result-box';

  try {
    const res = await fetch('/api/schedule/week', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate })
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error);

    lastCreatedPageIds = result.pageIds || [];
    resultBox.innerHTML = `
      <div class="result-count">✅ ${result.created}개 추가 완료</div>
      <div>${result.startDate} 부터 7일간 일정이 노션에 추가되었습니다</div>
      ${result.errors > 0 ? `<div style="margin-top:8px;color:#dc2626">⚠️ ${result.errors}개 실패</div>` : ''}
      <button class="btn-undo" onclick="undoWeeklySchedule()">↩ 방금 추가한 일정 취소</button>
    `;
    resultBox.className = 'result-box success';
    showToast(`✓ ${result.created}개 항목이 노션에 추가되었습니다`);
  } catch (err) {
    resultBox.innerHTML = `<div><strong>오류 발생</strong></div><div style="margin-top:4px">${err.message}</div>`;
    resultBox.className = 'result-box error';
  } finally {
    btn.disabled = false;
    btn.textContent = '📥 노션에 일주일 일정 추가';
  }
}

async function undoWeeklySchedule() {
  if (lastCreatedPageIds.length === 0) return;
  if (!confirm(`방금 추가한 ${lastCreatedPageIds.length}개 일정을 노션에서 삭제할까요?`)) return;

  const resultBox = document.getElementById('scheduleResult');
  resultBox.innerHTML = '<div>⏳ 취소 중...</div>';

  try {
    const res = await fetch('/api/schedule/undo', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageIds: lastCreatedPageIds }),
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error);

    lastCreatedPageIds = [];
    resultBox.innerHTML = `<div class="result-count" style="font-size:16px">↩ ${result.deleted}개 일정 취소 완료</div>`;
    resultBox.className = 'result-box';
    resultBox.style.cssText = 'display:block;background:#fff7ed;color:#9a3412;border:1px solid #fed7aa';
    showToast(`↩ ${result.deleted}개 일정이 삭제되었습니다`);
  } catch (err) {
    resultBox.innerHTML = `<div>오류: ${err.message}</div>`;
    showToast('취소 실패: ' + err.message);
  }
}

// ─── DB 속성 확인 ─────────────────────────────────────────────────────────────
async function checkDbInfo() {
  const el = document.getElementById('dbInfoResult');
  el.textContent = '확인 중...';
  try {
    const res = await fetch('/api/db-info');
    const result = await res.json();
    if (!result.success) throw new Error(result.error);
    el.innerHTML = `<strong>${result.title}</strong><br>` +
      result.properties.map(p => `• ${p.name} (${p.type})`).join('<br>');
  } catch (err) {
    el.textContent = '오류: ' + err.message;
  }
}

// ─── 토스트 ───────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

// ─── XSS 방지 ─────────────────────────────────────────────────────────────────
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
