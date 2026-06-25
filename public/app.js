// Token de sessão único por dispositivo
let sessionToken = localStorage.getItem('sessionToken');
if (!sessionToken) {
  sessionToken = crypto.randomUUID();
  localStorage.setItem('sessionToken', sessionToken);
}

// Reservas feitas neste dispositivo: { giftId: true }
let myReservations = JSON.parse(localStorage.getItem('myReservations') || '{}');

function saveMyReservations() {
  localStorage.setItem('myReservations', JSON.stringify(myReservations));
}

const state = {
  guestName: '',
  selectedGiftId: null,
  selectedGiftName: '',
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
  const isMine = myReservations[gift.id];
  const isFull = gift.full;

  // Presente de limite 1 já reservado por outra pessoa
  if (gift.reserved && !isMine) {
    return `
      <div class="gift-item reserved">
        <div class="gift-info">
          <strong>${escapeHtml(gift.name)}</strong>
          <span>${escapeHtml(gift.category)}</span>
        </div>
        <span class="gift-reserved-label">Já escolhido</span>
      </div>`;
  }

  // Presente que eu escolhi — mostro botão de cancelar
  if (isMine) {
    return `
      <div class="gift-item mine">
        <div class="gift-info">
          <strong>${escapeHtml(gift.name)}</strong>
          <span>${escapeHtml(gift.category)}</span>
          <span class="gift-mine-label">✓ Você escolheu este</span>
        </div>
        <button type="button" class="btn btn-cancel" data-id="${gift.id}">
          Cancelar
        </button>
      </div>`;
  }

  // Nota de quantas vagas restam
  let note = '';
  if (gift.maxReservations > 1) {
    const remaining = gift.maxReservations - gift.reservationCount;
    if (isFull) {
      note = `<span class="gift-full-label">Limite atingido</span>`;
    } else if (gift.reservationCount > 0) {
      note = `<span class="gift-unlimited-label">${remaining} vaga(s) restante(s)</span>`;
    } else {
      note = `<span class="gift-unlimited-badge">Até ${gift.maxReservations} pessoas podem escolher</span>`;
    }
  }

  return `
    <div class="gift-item${isFull ? ' reserved' : ''}" data-id="${gift.id}">
      <div class="gift-info">
        <strong>${escapeHtml(gift.name)}</strong>
        <span>${escapeHtml(gift.category)}</span>
        ${note}
      </div>
      <button type="button" class="btn btn-choose${isFull ? ' btn-disabled' : ''}"
        data-id="${gift.id}" data-name="${escapeHtml(gift.name)}"
        ${isFull ? 'disabled' : ''}>
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

    // Atualizar myReservations com base nos tokens da sessão
    gifts.forEach(g => {
      if (g.sessionTokens && g.sessionTokens.includes(sessionToken)) {
        myReservations[g.id] = true;
      }
    });
    saveMyReservations();

    grid.innerHTML = gifts
      .filter((g) => !g.isCustom)
      .map(renderGiftItem)
      .join('');

    // Botões escolher
    grid.querySelectorAll('.btn-choose:not([disabled])').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.selectedGiftId = Number(btn.dataset.id);
        state.selectedGiftName = btn.dataset.name;
        document.getElementById('selected-gift-name').textContent = state.selectedGiftName;
        document.getElementById('deliverer-name-gift').value = state.guestName;
        showStep('nameGift');
      });
    });

    // Botões cancelar
    grid.querySelectorAll('.btn-cancel').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const giftId = Number(btn.dataset.id);
        btn.disabled = true;
        btn.textContent = 'Cancelando...';
        try {
          const res = await fetch(`/api/gifts/${giftId}/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken }),
          });
          if (res.ok) {
            delete myReservations[giftId];
            saveMyReservations();
            loadGifts();
          } else {
            btn.disabled = false;
            btn.textContent = 'Cancelar';
          }
        } catch {
          btn.disabled = false;
          btn.textContent = 'Cancelar';
        }
      });
    });

    loading.classList.add('hidden');
    grid.classList.remove('hidden');
  } catch {
    loading.classList.add('hidden');
    errorEl.textContent = 'Não foi possível carregar os presentes. Recarregue a página.';
    errorEl.classList.remove('hidden');
  }
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

    myReservations[state.selectedGiftId] = true;
    saveMyReservations();

    showSuccess(delivererName, data.gift.name);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
    if (err.message.includes('limite') || err.message.includes('já foi escolhido')) {
      setTimeout(() => {
        showStep('gifts');
        loadGifts();
      }, 2000);
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
