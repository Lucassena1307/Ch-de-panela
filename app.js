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
    document.getElementById('event-host').textContent = 'dsds';
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
  const reservedLabel = gift.reserved
    ? `<span class="gift-reserved-label">Escolhido por ${escapeHtml(gift.reservedBy)}</span>`
    : '';

  const unlimitedNote =
    gift.unlimited && gift.reservedByList?.length
      ? `<span class="gift-unlimited-label">Já escolhido por: ${gift.reservedByList.map(escapeHtml).join(', ')}</span>`
      : gift.unlimited
        ? `<span class="gift-unlimited-badge">Pode ser escolhido por várias pessoas</span>`
        : '';

  if (gift.reserved) {
    return `
      <div class="gift-item reserved">
        <div class="gift-info">
          <strong>${escapeHtml(gift.name)}</strong>
          <span>${escapeHtml(gift.category)}</span>
        </div>
        ${reservedLabel}
      </div>`;
  }

  return `
    <div class="gift-item${gift.unlimited ? ' unlimited' : ''}" data-id="${gift.id}">
      <div class="gift-info">
        <strong>${escapeHtml(gift.name)}</strong>
        <span>${escapeHtml(gift.category)}</span>
        ${unlimitedNote}
      </div>
      <button type="button" class="btn btn-choose" data-id="${gift.id}" data-name="${escapeHtml(gift.name)}">
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
const text = await res.text(); // Lê o que veio primeiro

// Só transforma em JSON se a resposta não for vazia
const gifts = text ? JSON.parse(text) : []; 

if (!res.ok) throw new Error(gifts.error || 'Erro ao carregar presentes.');

    grid.innerHTML = gifts
      .filter((g) => !g.isCustom)
      .map(renderGiftItem)
      .join('');

    grid.querySelectorAll('.btn-choose').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.selectedGiftId = Number(btn.dataset.id);
        state.selectedGiftName = btn.dataset.name;
        document.getElementById('selected-gift-name').textContent = state.selectedGiftName;
        document.getElementById('deliverer-name-gift').value = state.guestName;
        showStep('nameGift');
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
      body: JSON.stringify({ delivererName }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao reservar presente.');

    showSuccess(delivererName, data.gift.name);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
    if (err.message.includes('já foi escolhido') || err.message.includes('acabou de ser')) {
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
