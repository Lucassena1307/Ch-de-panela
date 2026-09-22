let sessionToken = localStorage.getItem('sessionToken');
if (!sessionToken) {
  sessionToken = crypto.randomUUID();
  localStorage.setItem('sessionToken', sessionToken);
}

let myReservations = JSON.parse(localStorage.getItem('myReservations') || '{}');
function saveMyReservations() {
  localStorage.setItem('myReservations', JSON.stringify(myReservations));
}

let pendingSelections = {};
const state = { guestName: '' };

const steps = {
  invite:  document.getElementById('step-invite'),
  decline: document.getElementById('step-decline'),
  gifts:   document.getElementById('step-gifts'),
  confirm: document.getElementById('step-confirm'),
  other:   document.getElementById('step-other'),
  success: document.getElementById('step-success'),
};

const continueBar = document.getElementById('continue-bar');

function showStep(stepKey) {
  Object.values(steps).forEach(el => el.classList.remove('active'));
  steps[stepKey].classList.add('active');
  
  if (stepKey !== 'gifts') continueBar.classList.add('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.getElementById('btn-back-decline').addEventListener('click', () => showStep('invite'));
document.getElementById('btn-back-gifts').addEventListener('click', () => showStep('invite'));
document.getElementById('btn-back-confirm').addEventListener('click', () => {
  showStep('gifts');
  updateContinueBar();
});
document.getElementById('btn-back-other').addEventListener('click', () => showStep('gifts'));
document.getElementById('btn-back-to-gifts').addEventListener('click', () => {
  showStep('gifts');
  loadGifts();
});

document.querySelectorAll('.rsvp-buttons .btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const guestName = document.getElementById('guest-name').value.trim();
    const attending = btn.dataset.attending === 'true';
    const errorEl   = document.getElementById('rsvp-error');
    errorEl.classList.add('hidden');

    if (guestName.length < 2) {
      errorEl.textContent = 'Por favor, informe seu nome antes de confirmar.';
      errorEl.classList.remove('hidden');
      document.getElementById('guest-name').focus();
      return;
    }

    btn.disabled = true;
    try {
      const res  = await fetch('/api/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestName, attending }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao registrar.');

      state.guestName = guestName;

      if (attending) {
        document.getElementById('gifts-guest-name').textContent = guestName;
        pendingSelections = {};
        showStep('gifts');
        loadGifts();
      } else {
        document.getElementById('decline-name').textContent = guestName;
        showStep('decline');
      }
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
    }
  });
});

function renderGiftItem(gift) {
  const myConfirmed = myReservations[gift.id]?.count || 0;
  const myPending   = pendingSelections[gift.id]?.count || 0;
  const totalMine   = myConfirmed + myPending;
  const isMultiple  = gift.maxReservations > 1;
  const isFull      = gift.full;
  const remaining   = gift.maxReservations - gift.reservationCount;

  if (!isMultiple) {
    if (myConfirmed > 0) {
      return `
        <div class="gift-item gift-mine">
          <div class="gift-info">
            <strong>${escapeHtml(gift.name)}</strong>
            <span class="gift-category">${escapeHtml(gift.category)}</span>
            <span class="gift-mine-label">✓ Você escolheu este</span>
          </div>
          <button class="btn btn-cancel" data-id="${gift.id}" data-token="${myReservations[gift.id].tokens[0]}">Cancelar</button>
        </div>`;
    }
    if (gift.reserved) {
      return `
        <div class="gift-item gift-taken">
          <div class="gift-info">
            <strong>${escapeHtml(gift.name)}</strong>
            <span class="gift-category">${escapeHtml(gift.category)}</span>
            <span class="gift-taken-label">Já foi escolhido</span>
          </div>
        </div>`;
    }
    return `
      <div class="gift-item">
        <div class="gift-info">
          <strong>${escapeHtml(gift.name)}</strong>
          <span class="gift-category">${escapeHtml(gift.category)}</span>
        </div>
        <button class="btn btn-choose" data-id="${gift.id}" data-name="${escapeHtml(gift.name)}">Escolher</button>
      </div>`;
  }

  const canAdd = (remaining - myPending) > 0 && !isFull;

  if (totalMine > 0) {
    const slotsLeft = remaining - myPending;
    return `
      <div class="gift-item gift-mine">
        <div class="gift-info">
          <strong>${escapeHtml(gift.name)}</strong>
          <span class="gift-category">${escapeHtml(gift.category)}</span>
          ${myPending > 0 ? `<span class="gift-pending-label">+ ${myPending} selecionado(s)</span>` : ''}
          ${myConfirmed > 0 ? `<span class="gift-mine-label">✓ ${myConfirmed}x confirmado(s)</span>` : ''}
          ${isFull && myPending === 0 ? '<span class="gift-full-label">Esgotado</span>' : slotsLeft > 0 ? `<span class="gift-slots-label">${slotsLeft} item(ns) restante(s)</span>` : ''}
        </div>
        <div class="gift-counter-group">
          <button class="btn btn-counter btn-minus" data-id="${gift.id}">−</button>
          <span class="gift-counter-num">${totalMine}</span>
          <button class="btn btn-counter btn-plus ${!canAdd ? 'btn-counter-disabled' : ''}"
            data-id="${gift.id}" data-name="${escapeHtml(gift.name)}" ${!canAdd ? 'disabled' : ''}>+</button>
        </div>
      </div>`;
  }

  if (isFull) {
    return `
      <div class="gift-item gift-taken">
        <div class="gift-info">
          <strong>${escapeHtml(gift.name)}</strong>
          <span class="gift-category">${escapeHtml(gift.category)}</span>
          <span class="gift-full-label">Esgotado</span>
        </div>
      </div>`;
  }

  return `
    <div class="gift-item">
      <div class="gift-info">
        <strong>${escapeHtml(gift.name)}</strong>
        <span class="gift-category">${escapeHtml(gift.category)}</span>
        <span class="gift-slots-label">${remaining} item(ns) disponível(is)</span>
      </div>
      <button class="btn btn-choose" data-id="${gift.id}" data-name="${escapeHtml(gift.name)}">Escolher</button>
    </div>`;
}

let cachedGifts = [];

async function loadGifts() {
  const loading = document.getElementById('gifts-loading');
  const grid    = document.getElementById('gifts-grid');
  const errorEl = document.getElementById('gifts-error');

  loading.classList.remove('hidden');
  grid.classList.add('hidden');
  errorEl.classList.add('hidden');

  try {
    const res   = await fetch('/api/gifts');
    cachedGifts = res.ok ? await res.json() : [];

    cachedGifts.forEach(g => {
      const myTokens = (g.sessionTokens || []).filter(t => t === sessionToken);
      if (myTokens.length > 0) {
        myReservations[g.id] = { count: myTokens.length, tokens: myTokens, name: g.name };
      } else {
        delete myReservations[g.id];
      }
    });
    saveMyReservations();

    renderGrid();
    updateContinueBar();
    loading.classList.add('hidden');
    grid.classList.remove('hidden');
  } catch {
    loading.classList.add('hidden');
    errorEl.textContent = 'Não foi possível carregar os presentes. Recarregue a página.';
    errorEl.classList.remove('hidden');
  }
}

function renderGrid() {
  const grid = document.getElementById('gifts-grid');
  grid.innerHTML = cachedGifts.filter(g => !g.isCustom).map(renderGiftItem).join('');
  attachGridListeners();
}

function attachGridListeners() {
  document.querySelectorAll('.btn-choose').forEach(btn => {
    btn.addEventListener('click', () => {
      const id   = Number(btn.dataset.id);
      const name = btn.dataset.name;
      const gift = cachedGifts.find(g => g.id === id);
      if (!gift) return;

      if (gift.maxReservations === 1) {
        // Item único: vai direto para confirmação com só esse item
        pendingSelections = { [id]: { name, count: 1 } };
        goToConfirm();
      } else {
        if (!pendingSelections[id]) pendingSelections[id] = { name, count: 0 };
        pendingSelections[id].count += 1;
        renderGrid();
        updateContinueBar();
      }
    });
  });

  document.querySelectorAll('.btn-plus').forEach(btn => {
    btn.addEventListener('click', () => {
      const id   = Number(btn.dataset.id);
      const name = btn.dataset.name;
      if (!pendingSelections[id]) pendingSelections[id] = { name, count: 0 };
      pendingSelections[id].count += 1;
      renderGrid();
      updateContinueBar();
    });
  });

  document.querySelectorAll('.btn-minus').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      if (pendingSelections[id]?.count > 0) {
        pendingSelections[id].count -= 1;
        if (pendingSelections[id].count === 0) delete pendingSelections[id];
        renderGrid();
        updateContinueBar();
      } else if (myReservations[id]) {
        const token = myReservations[id].tokens[myReservations[id].tokens.length - 1];
        cancelReservation(id, token);
      }
    });
  });

  document.querySelectorAll('.btn-cancel').forEach(btn => {
    btn.addEventListener('click', () => cancelReservation(Number(btn.dataset.id), btn.dataset.token));
  });
}

function updateContinueBar() {
  const count = Object.values(pendingSelections).reduce((s, v) => s + v.count, 0);
  if (count > 0) {
    continueBar.classList.remove('hidden');
    document.getElementById('continue-count').textContent =
      count === 1 ? '1 item selecionado' : `${count} itens selecionados`;
  } else {
    continueBar.classList.add('hidden');
  }
}

document.getElementById('btn-continue').addEventListener('click', goToConfirm);

function goToConfirm() {
  const list = document.getElementById('confirm-list');
  list.innerHTML = Object.values(pendingSelections).map(item =>
    `<li><strong>${item.count}×</strong> ${escapeHtml(item.name)}</li>`
  ).join('');
  document.getElementById('confirm-deliverer-name').value = state.guestName;
  showStep('confirm');
}

document.getElementById('confirm-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const delivererName = document.getElementById('confirm-deliverer-name').value.trim();
  const errorEl  = document.getElementById('confirm-error');
  const submitBtn = e.target.querySelector('button[type="submit"]');

  errorEl.classList.add('hidden');
  if (delivererName.length < 2) {
    errorEl.textContent = 'Por favor, informe seu nome.';
    errorEl.classList.remove('hidden');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Enviando...';

  const allGiftNames = [];
  let failed = false;

  for (const [id, item] of Object.entries(pendingSelections)) {
    for (let i = 0; i < item.count; i++) {
      try {
        const res  = await fetch(`/api/gifts/${id}/reserve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ delivererName, sessionToken }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        if (!myReservations[id]) myReservations[id] = { count: 0, tokens: [], name: item.name };
        myReservations[id].count += 1;
        myReservations[id].tokens.push(sessionToken);
        allGiftNames.push(item.name);
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
        failed = true;
        break;
      }
    }
    if (failed) break;
  }

  saveMyReservations();

  if (!failed) {
    pendingSelections = {};
    try {
      await fetch('/api/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestName: delivererName, sessionToken }),
      });
    } catch {}
    showSuccess(delivererName, allGiftNames.join(', '));
  }

  submitBtn.disabled = false;
  submitBtn.textContent = '✦ Confirmar e enviar';
});

async function cancelReservation(giftId, token) {
  try {
    const res = await fetch(`/api/gifts/${giftId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionToken: token }),
    });
    if (res.ok) {
      const myData = myReservations[giftId];
      if (myData) {
        myData.count = Math.max(0, myData.count - 1);
        myData.tokens = myData.tokens.filter(t => t !== token);
        if (myData.count === 0) delete myReservations[giftId];
      }
      saveMyReservations();
      loadGifts();
    }
  } catch {}
}

document.getElementById('btn-other').addEventListener('click', () => {
  document.getElementById('deliverer-name-other').value = state.guestName;
  document.getElementById('other-description').value = '';
  showStep('other');
});

document.getElementById('other-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const description   = document.getElementById('other-description').value.trim();
  const delivererName = document.getElementById('deliverer-name-other').value.trim();
  const errorEl  = document.getElementById('other-error');
  const submitBtn = e.target.querySelector('button[type="submit"]');

  errorEl.classList.add('hidden');
  submitBtn.disabled = true;

  try {
    const res  = await fetch('/api/gifts/other', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delivererName, description }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao registrar.');
    showSuccess(delivererName, data.gift.name);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
  }
});

document.getElementById('btn-finish').addEventListener('click', async () => {
  const btn = document.getElementById('btn-finish');
  btn.disabled = true;
  btn.textContent = 'Enviado ✓';
  setTimeout(() => {
    showStep('invite');
    document.getElementById('guest-name').value = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, 1000);
});

function showSuccess(delivererName, giftName) {
  document.getElementById('success-message').textContent =
    `Obrigado, ${delivererName}! Seus presentes foram registrados com sucesso.`;
  document.getElementById('success-gift').textContent = giftName;
  document.getElementById('success-deliverer').textContent = delivererName;
  showStep('success');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function loadEvent() {
  try {
    const res  = await fetch('/api/event');
    const data = await res.json();
    document.getElementById('event-host').textContent     = data.host;
    document.getElementById('event-location').textContent = data.location;
  } catch {}
}

loadEvent();
