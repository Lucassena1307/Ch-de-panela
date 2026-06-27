// Token de sessão único por dispositivo
let sessionToken = localStorage.getItem('sessionToken');
if (!sessionToken) {
  sessionToken = crypto.randomUUID();
  localStorage.setItem('sessionToken', sessionToken);
}

// Reservas feitas neste dispositivo: { giftId: { count, tokens: [] } }
let myReservations = JSON.parse(localStorage.getItem('myReservations') || '{}');

function saveMyReservations() {
  localStorage.setItem('myReservations', JSON.stringify(myReservations));
}

const state = {
  guestName: '',
  selectedGiftId: null,
  selectedGiftName: '',
  pendingQuantity: 1,
};

const steps = {
  invite: document.getElementById('step-invite'),
  decline: document.getElementById('step-decline'),
  gifts: document.getElementById('step-gifts'),
  nameGift: document.getElementById('step-name-gift'),
  other: document.getElementById('step-other'),
  success: document.getElementById('step-success'),
};

function showStep(stepKey) {
  Object.values(steps).forEach((el) => el.classList.remove('active'));
  steps[stepKey].classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadEvent() {
  try {
    const res = await fetch('/api/event');
    const data = await res.json();
    document.getElementById('event-host').textContent = data.host;
    document.getElementById('event-location').textContent = data.location;
  } catch {
    document.getElementById('event-host').textContent = '';
  }
}

document.querySelectorAll('.rsvp-buttons .btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const guestName = document.getElementById('guest-name').value.trim();
    const attending = btn.dataset.attending === 'true';
    const errorEl = document.getElementById('rsvp-error');

    errorEl.classList.add('hidden');

    if (guestName.length < 2) {
      errorEl.textContent = 'Por favor, informe seu nome antes de confirmar.';
      errorEl.classList.remove('hidden');
      document.getElementById('guest-name').focus();
      return;
    }

    btn.disabled = true;

    try {
      const res = await fetch('/api/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestName, attending }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao registrar resposta.');

      state.guestName = guestName;

      if (attending) {
        document.getElementById('gifts-guest-name').textContent = guestName;
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
  const myData = myReservations[gift.id];
  const myCount = myData ? myData.count : 0;
  const isMultiple = gift.maxReservations > 1;
  const isFull = gift.full;

  // Item de vaga única
  if (!isMultiple) {
    // Eu escolhi neste dispositivo
    if (myCount > 0) {
      return `
        <div class="gift-item gift-mine">
          <div class="gift-info">
            <strong>${escapeHtml(gift.name)}</strong>
            <span class="gift-category">${escapeHtml(gift.category)}</span>
            <span class="gift-mine-label">✓ Você escolheu este</span>
          </div>
          <button class="btn btn-cancel" data-id="${gift.id}" data-token="${myData.tokens[0]}">
            Cancelar
          </button>
        </div>`;
    }
    // Já escolhido por outro
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
    // Disponível
    return `
      <div class="gift-item">
        <div class="gift-info">
          <strong>${escapeHtml(gift.name)}</strong>
          <span class="gift-category">${escapeHtml(gift.category)}</span>
        </div>
        <button class="btn btn-choose" data-id="${gift.id}" data-name="${escapeHtml(gift.name)}">
          Escolher
        </button>
      </div>`;
  }

  // Item de múltiplas vagas
  const remaining = gift.maxReservations - gift.reservationCount;

  // Tenho reservas neste dispositivo
  if (myCount > 0) {
    const canAddMore = !isFull && myCount < gift.maxReservations;
    return `
      <div class="gift-item gift-mine gift-multiple">
        <div class="gift-info">
          <strong>${escapeHtml(gift.name)}</strong>
          <span class="gift-category">${escapeHtml(gift.category)}</span>
          <span class="gift-mine-label">✓ Você escolheu ${myCount}x</span>
          ${!isFull ? `<span class="gift-slots-label">${remaining} vaga(s) restante(s)</span>` : '<span class="gift-full-label">Esgotado</span>'}
        </div>
        <div class="gift-counter-group">
          <button class="btn btn-counter btn-cancel-one" data-id="${gift.id}" data-token="${myData.tokens[myData.tokens.length - 1]}">−</button>
          <span class="gift-counter-num">${myCount}</span>
          <button class="btn btn-counter btn-add-one ${!canAddMore ? 'btn-counter-disabled' : ''}"
            data-id="${gift.id}" data-name="${escapeHtml(gift.name)}"
            ${!canAddMore ? 'disabled' : ''}>+</button>
        </div>
      </div>`;
  }

  // Esgotado sem minhas reservas
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

  // Disponível com vagas
  return `
    <div class="gift-item gift-multiple">
      <div class="gift-info">
        <strong>${escapeHtml(gift.name)}</strong>
        <span class="gift-category">${escapeHtml(gift.category)}</span>
        <span class="gift-slots-label">${remaining} vaga(s) disponível(is)</span>
      </div>
      <button class="btn btn-choose" data-id="${gift.id}" data-name="${escapeHtml(gift.name)}">
        Escolher
      </button>
    </div>`;
}

async function loadGifts() {
  const loading = document.getElementById('gifts-loading');
  const grid = document.getElementById('gifts-grid');
  const errorEl = document.getElementById('gifts-error');

  loading.classList.remove('hidden');
  grid.classList.add('hidden');
  errorEl.classList.add('hidden');

  try {
    const res = await fetch('/api/gifts');
    const text = await res.text();
    const gifts = text ? JSON.parse(text) : [];
    if (!res.ok) throw new Error(gifts.error || 'Erro ao carregar presentes.');

    // Sincronizar myReservations com tokens da sessão vindos do servidor
    gifts.forEach(g => {
      const myTokens = (g.sessionTokens || []).filter(t => t === sessionToken);
      if (myTokens.length > 0) {
        myReservations[g.id] = {
          count: myTokens.length,
          tokens: myTokens,
        };
      } else if (myReservations[g.id]) {
        // Limpar se o servidor não reconhece mais
        delete myReservations[g.id];
      }
    });
    saveMyReservations();

    grid.innerHTML = gifts
      .filter((g) => !g.isCustom)
      .map(renderGiftItem)
      .join('');

    // Botão escolher (único ou primeira vez múltiplo)
    grid.querySelectorAll('.btn-choose').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.selectedGiftId = Number(btn.dataset.id);
        state.selectedGiftName = btn.dataset.name;
        state.pendingQuantity = 1;
        document.getElementById('selected-gift-name').textContent = state.selectedGiftName;
        document.getElementById('deliverer-name-gift').value = state.guestName;
        showStep('nameGift');
      });
    });

    // Botão + (adicionar mais uma unidade)
    grid.querySelectorAll('.btn-add-one').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.selectedGiftId = Number(btn.dataset.id);
        state.selectedGiftName = btn.dataset.name;
        state.pendingQuantity = 1;
        document.getElementById('selected-gift-name').textContent = state.selectedGiftName;
        document.getElementById('deliverer-name-gift').value = state.guestName;
        showStep('nameGift');
      });
    });

    // Botão − (cancelar uma unidade)
    grid.querySelectorAll('.btn-cancel-one').forEach((btn) => {
      btn.addEventListener('click', () => cancelReservation(Number(btn.dataset.id), btn.dataset.token));
    });

    // Botão cancelar (item único)
    grid.querySelectorAll('.btn-cancel').forEach((btn) => {
      btn.addEventListener('click', () => cancelReservation(Number(btn.dataset.id), btn.dataset.token));
    });

    loading.classList.add('hidden');
    grid.classList.remove('hidden');
  } catch {
    loading.classList.add('hidden');
    errorEl.textContent = 'Não foi possível carregar os presentes. Recarregue a página.';
    errorEl.classList.remove('hidden');
  }
}

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

document.getElementById('name-gift-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const delivererName = document.getElementById('deliverer-name-gift').value.trim();
  const errorEl = document.getElementById('name-gift-error');
  const submitBtn = e.target.querySelector('button[type="submit"]');

  errorEl.classList.add('hidden');
  submitBtn.disabled = true;

  try {
    const res = await fetch(`/api/gifts/${state.selectedGiftId}/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delivererName, sessionToken }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao reservar presente.');

    // Salvar localmente
    if (!myReservations[state.selectedGiftId]) {
      myReservations[state.selectedGiftId] = { count: 0, tokens: [] };
    }
    myReservations[state.selectedGiftId].count += 1;
    myReservations[state.selectedGiftId].tokens.push(sessionToken);
    saveMyReservations();

    showSuccess(delivererName, data.gift.name);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
    if (err.message.includes('limite') || err.message.includes('já foi escolhido')) {
      setTimeout(() => { showStep('gifts'); loadGifts(); }, 2000);
    }
  } finally {
    submitBtn.disabled = false;
  }
});

document.getElementById('other-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const description = document.getElementById('other-description').value.trim();
  const delivererName = document.getElementById('deliverer-name-other').value.trim();
  const errorEl = document.getElementById('other-error');
  const submitBtn = e.target.querySelector('button[type="submit"]');

  errorEl.classList.add('hidden');
  submitBtn.disabled = true;

  try {
    const res = await fetch('/api/gifts/other', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delivererName, description }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao registrar presente.');

    showSuccess(delivererName, data.gift.name);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
  }
});

function showSuccess(delivererName, giftName) {
  document.getElementById('success-message').textContent =
    `Obrigado, ${delivererName}! Seu presente foi registrado com sucesso.`;
  document.getElementById('success-gift').textContent = giftName;
  document.getElementById('success-deliverer').textContent = delivererName;
  showStep('success');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

loadEvent();
