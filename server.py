import os
import sqlite3
import threading
import urllib.request
import urllib.error
import json
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory

load_dotenv()

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)
DB_PATH = DATA_DIR / "cha-de-panela.db"

DEFAULT_GIFTS = [
    ("Liquidificador", "Eletrodomésticos", 1),
    ("Mixer de mão", "Eletrodomésticos", 1),
    ("Jogo de panelas antiaderente", "Cozinha", 7),
    ("Jogo de facas", "Cozinha", 5),
    ("Frigideira grande", "Cozinha", 4),
    ("Panela de pressão", "Cozinha", 2),
    ("Jogo de pratos", "Mesa", 10),
    ("Jogo de copos", "Mesa", 5),
    ("Jogo de talheres", "Mesa", 10),
    ("Jogo de xícaras", "Mesa", 5),
    ("Jogo de travessas", "Mesa", 2),
    ("Tábua de corte", "Utensílios", 1),
    ("Escorredor de macarrão", "Utensílios", 3),
    ("Conjunto de potes herméticos", "Organização", 8),
    ("Jogo de formas para bolo", "Assar", 4),
]

app = Flask(__name__, static_folder="public", static_url_path="")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS rsvps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guest_name TEXT NOT NULL,
            attending INTEGER NOT NULL,
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        );
        CREATE TABLE IF NOT EXISTS gifts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            category TEXT DEFAULT 'geral',
            is_custom INTEGER DEFAULT 0,
            max_reservations INTEGER DEFAULT 1,
            reserved_by TEXT,
            custom_description TEXT,
            reserved_at TEXT
        );
        CREATE TABLE IF NOT EXISTS gift_reservations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            gift_id INTEGER NOT NULL,
            deliverer_name TEXT NOT NULL,
            session_token TEXT,
            reserved_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (gift_id) REFERENCES gifts(id)
        );
    """)

    columns = {row[1] for row in conn.execute("PRAGMA table_info(gifts)").fetchall()}
    if "unlimited" in columns and "max_reservations" not in columns:
        conn.execute("ALTER TABLE gifts ADD COLUMN max_reservations INTEGER DEFAULT 1")
        conn.execute("UPDATE gifts SET max_reservations = CASE WHEN unlimited = 1 THEN 999 ELSE 1 END")
    if "max_reservations" not in columns:
        conn.execute("ALTER TABLE gifts ADD COLUMN max_reservations INTEGER DEFAULT 1")

    res_columns = {row[1] for row in conn.execute("PRAGMA table_info(gift_reservations)").fetchall()}
    if "session_token" not in res_columns:
        conn.execute("ALTER TABLE gift_reservations ADD COLUMN session_token TEXT")

    limits = {name: limit for name, _, limit in DEFAULT_GIFTS}
    for name, limit in limits.items():
        conn.execute(
            "UPDATE gifts SET max_reservations = ? WHERE name = ? AND is_custom = 0",
            (limit, name),
        )
    conn.commit()

    count = conn.execute("SELECT COUNT(*) FROM gifts WHERE is_custom = 0").fetchone()[0]
    if count == 0:
        conn.executemany(
            "INSERT INTO gifts (name, category, max_reservations) VALUES (?, ?, ?)",
            DEFAULT_GIFTS,
        )
        conn.commit()
    conn.close()


def _send_email_async(subject, html):
    """Envia e-mail via Resend (API HTTPS) em vez de SMTP.
    O Render bloqueia as portas SMTP (25/465/587) no plano free,
    então usamos uma chamada HTTPS normal, que não é bloqueada."""
    organizer = os.getenv("ORGANIZER_EMAIL")
    resend_key = os.getenv("RESEND_API_KEY")

    if not organizer:
        print("ORGANIZER_EMAIL não configurado.")
        return
    if not resend_key:
        print("[simulado] " + subject)
        return

    payload = json.dumps({
        # "onboarding@resend.dev" funciona sem precisar verificar domínio.
        # Se depois você verificar um domínio próprio no Resend, troque aqui.
        "from": "Chá de Panela <onboarding@resend.dev>",
        "to": [organizer],
        "subject": subject,
        "html": html,
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {resend_key}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp.read()
        print(f"E-mail enviado para {organizer}")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")
        print(f"Erro ao enviar e-mail (HTTP {e.code}): {body}")
    except Exception as e:
        print(f"Erro ao enviar e-mail: {e}")


def _send_email(subject, html):
    t = threading.Thread(target=_send_email_async, args=(subject, html), daemon=True)
    t.start()


def _rsvp_summary(conn):
    attending = [r["guest_name"] for r in conn.execute("SELECT guest_name FROM rsvps WHERE attending = 1")]
    not_attending = [r["guest_name"] for r in conn.execute("SELECT guest_name FROM rsvps WHERE attending = 0")]
    return attending, not_attending


def _gift_summary_items(conn):
    items = []
    for g in conn.execute(
        "SELECT name, reserved_by, custom_description, is_custom FROM gifts WHERE reserved_by IS NOT NULL"
    ):
        item = g["custom_description"] if g["is_custom"] else g["name"]
        items.append(f"<li><strong>{g['reserved_by']}</strong> → {item}</li>")

    for row in conn.execute("""
        SELECT gr.deliverer_name, g.name
        FROM gift_reservations gr
        JOIN gifts g ON g.id = gr.gift_id
        ORDER BY gr.reserved_at ASC
    """):
        items.append(f"<li><strong>{row['deliverer_name']}</strong> → {row['name']}</li>")

    return items


def send_decline_email(guest_name):
    conn = get_db()
    attending, not_attending = _rsvp_summary(conn)
    gift_items = _gift_summary_items(conn)
    conn.close()

    html = f"""
    <div style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; color: #4a3728;">
      <h2 style="color: #c45c6a;">Chá de Panela — Confirmação de ausência</h2>
      <p><strong>{guest_name}</strong> informou que <strong>não poderá comparecer</strong>.</p>
      <hr style="border: none; border-top: 1px solid #e8d5c4; margin: 24px 0;">
      <h3>Resumo de presenças</h3>
      <p><strong>Vão ({len(attending)}):</strong> {', '.join(attending) or 'Ninguém ainda'}</p>
      <p><strong>Não vão ({len(not_attending)}):</strong> {', '.join(not_attending) or 'Ninguém ainda'}</p>
      <h3>Presentes escolhidos</h3>
      <ul>{''.join(gift_items) or '<li>Nenhum presente escolhido ainda</li>'}</ul>
    </div>
    """
    _send_email(f"🤍 {guest_name} não poderá ir ao chá de panela", html)


def send_gift_email(deliverer_name, gift_name, is_custom):
    conn = get_db()
    attending, not_attending = _rsvp_summary(conn)
    gift_items = _gift_summary_items(conn)
    conn.close()

    subject = (
        f"🎁 {deliverer_name} escolheu um presente personalizado"
        if is_custom
        else f"🎁 {deliverer_name} escolheu: {gift_name}"
    )

    html = f"""
    <div style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; color: #4a3728;">
      <h2 style="color: #c45c6a;">Chá de Panela — Nova escolha de presente</h2>
      <p><strong>{deliverer_name}</strong> confirmou que vai levar:</p>
      <p style="font-size: 18px; background: #fdf6f0; padding: 12px 16px; border-radius: 8px;">
        {'🎀 Outros: <em>' + gift_name + '</em>' if is_custom else '🎁 ' + gift_name}
      </p>
      <hr style="border: none; border-top: 1px solid #e8d5c4; margin: 24px 0;">
      <h3>Resumo de presenças</h3>
      <p><strong>Vão ({len(attending)}):</strong> {', '.join(attending) or 'Ninguém ainda'}</p>
      <p><strong>Não vão ({len(not_attending)}):</strong> {', '.join(not_attending) or 'Ninguém ainda'}</p>
      <h3>Presentes escolhidos</h3>
      <ul>{''.join(gift_items) or '<li>Nenhum presente escolhido ainda</li>'}</ul>
    </div>
    """
    _send_email(subject, html)


@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/api/event")
def api_event():
    return jsonify({
        "host": os.getenv("EVENT_HOST", "Lucas e Laila"),
        "location": os.getenv("EVENT_LOCATION", "Local a confirmar"),
    })


@app.route("/api/gifts")
def api_gifts():
    conn = get_db()
    rows = conn.execute("""
        SELECT id, name, category, is_custom, max_reservations, reserved_by, custom_description
        FROM gifts ORDER BY is_custom ASC, category ASC, name ASC
    """).fetchall()

    reservation_counts = {}
    reservation_tokens = {}
    for row in conn.execute("""
        SELECT gift_id, COUNT(*) as cnt, GROUP_CONCAT(session_token) as tokens
        FROM gift_reservations GROUP BY gift_id
    """):
        reservation_counts[row["gift_id"]] = row["cnt"]
        reservation_tokens[row["gift_id"]] = (row["tokens"] or "").split(",")

    conn.close()

    result = []
    for r in rows:
        max_res = r["max_reservations"]
        count = reservation_counts.get(r["id"], 0)
        is_single = max_res == 1

        result.append({
            "id": r["id"],
            "name": r["name"],
            "category": r["category"],
            "isCustom": bool(r["is_custom"]),
            "maxReservations": max_res,
            "reservationCount": count,
            "full": count >= max_res,
            "reserved": bool(r["reserved_by"]) if is_single else False,
            "reservedBy": r["reserved_by"],
            "sessionTokens": reservation_tokens.get(r["id"], []),
            "customDescription": r["custom_description"],
        })

    return jsonify(result)


@app.route("/api/rsvp", methods=["POST"])
def api_rsvp():
    data = request.get_json(silent=True) or {}
    guest_name = (data.get("guestName") or "").strip()
    attending = data.get("attending")

    if len(guest_name) < 2:
        return jsonify({"error": "Informe seu nome (mínimo 2 caracteres)."}), 400
    if not isinstance(attending, bool):
        return jsonify({"error": "Informe se você irá ou não."}), 400

    conn = get_db()
    conn.execute(
        "INSERT INTO rsvps (guest_name, attending) VALUES (?, ?)",
        (guest_name, 1 if attending else 0),
    )
    conn.commit()
    conn.close()

    if not attending:
        try:
            send_decline_email(guest_name)
        except Exception as exc:
            print(f"Erro ao enviar e-mail de ausência: {exc}")

    return jsonify({"success": True, "attending": attending})


@app.route("/api/gifts/<int:gift_id>/reserve", methods=["POST"])
def api_reserve_gift(gift_id):
    data = request.get_json(silent=True) or {}
    deliverer_name = (data.get("delivererName") or "").strip()
    session_token = (data.get("sessionToken") or "").strip()

    if len(deliverer_name) < 2:
        return jsonify({"error": "Informe o nome de quem entregará o presente."}), 400

    conn = get_db()
    gift = conn.execute("SELECT * FROM gifts WHERE id = ?", (gift_id,)).fetchone()

    if not gift:
        conn.close()
        return jsonify({"error": "Presente não encontrado."}), 404

    if gift["is_custom"]:
        conn.close()
        return jsonify({"error": "Presente inválido."}), 400

    max_res = gift["max_reservations"]
    count = conn.execute(
        "SELECT COUNT(*) FROM gift_reservations WHERE gift_id = ?", (gift_id,)
    ).fetchone()[0]

    if count >= max_res:
        conn.close()
        return jsonify({"error": "Este presente já atingiu o limite de escolhas."}), 409

    now = datetime.now().strftime("%d/%m/%Y %H:%M")
    conn.execute(
        "INSERT INTO gift_reservations (gift_id, deliverer_name, session_token, reserved_at) VALUES (?, ?, ?, ?)",
        (gift_id, deliverer_name, session_token, now),
    )
    conn.commit()
    conn.close()

    try:
        send_gift_email(deliverer_name, gift["name"], False)
    except Exception as exc:
        print(f"Erro ao enviar e-mail: {exc}")

    return jsonify({
        "success": True,
        "gift": {
            "id": gift_id,
            "name": gift["name"],
            "reservedBy": deliverer_name,
            "sessionToken": session_token,
        },
    })


@app.route("/api/gifts/<int:gift_id>/cancel", methods=["POST"])
def api_cancel_gift(gift_id):
    data = request.get_json(silent=True) or {}
    session_token = (data.get("sessionToken") or "").strip()

    if not session_token:
        return jsonify({"error": "Token inválido."}), 400

    conn = get_db()
    result = conn.execute(
        "DELETE FROM gift_reservations WHERE gift_id = ? AND session_token = ?",
        (gift_id, session_token),
    )
    conn.commit()
    conn.close()

    if result.rowcount == 0:
        return jsonify({"error": "Reserva não encontrada."}), 404

    return jsonify({"success": True})


@app.route("/api/gifts/other", methods=["POST"])
def api_other_gift():
    data = request.get_json(silent=True) or {}
    deliverer_name = (data.get("delivererName") or "").strip()
    description = (data.get("description") or "").strip()

    if len(deliverer_name) < 2:
        return jsonify({"error": "Informe o nome de quem entregará o presente."}), 400
    if len(description) < 2:
        return jsonify({"error": "Descreva o presente que você vai levar."}), 400

    now = datetime.now().strftime("%d/%m/%Y %H:%M")
    conn = get_db()
    cur = conn.execute(
        """INSERT INTO gifts (name, category, is_custom, reserved_by, custom_description, reserved_at)
           VALUES (?, ?, 1, ?, ?, ?)""",
        ("Outros", "Personalizado", deliverer_name, description, now),
    )
    conn.commit()
    gift_id = cur.lastrowid
    conn.close()

    try:
        send_gift_email(deliverer_name, description, True)
    except Exception as exc:
        print(f"Erro ao enviar e-mail: {exc}")

    return jsonify({
        "success": True,
        "gift": {
            "id": gift_id,
            "name": description,
            "reservedBy": deliverer_name,
            "isCustom": True,
        },
    })


@app.route("/api/summary")
def api_summary():
    conn = get_db()
    rsvps = conn.execute(
        "SELECT guest_name, attending, created_at FROM rsvps ORDER BY created_at DESC"
    ).fetchall()
    single_gifts = conn.execute("""
        SELECT name, category, reserved_by, custom_description, is_custom, reserved_at
        FROM gifts WHERE reserved_by IS NOT NULL ORDER BY reserved_at DESC
    """).fetchall()
    multi_gifts = conn.execute("""
        SELECT g.name, gr.deliverer_name AS reserved_by, gr.reserved_at
        FROM gift_reservations gr
        JOIN gifts g ON g.id = gr.gift_id
        ORDER BY gr.reserved_at DESC
    """).fetchall()
    conn.close()

    gifts = [
        {
            "name": g["custom_description"] if g["is_custom"] else g["name"],
            "reservedBy": g["reserved_by"],
            "reservedAt": g["reserved_at"],
        }
        for g in single_gifts
    ]
    gifts.extend({
        "name": g["name"],
        "reservedBy": g["reserved_by"],
        "reservedAt": g["reserved_at"],
    } for g in multi_gifts)

    return jsonify({
        "attending": [r["guest_name"] for r in rsvps if r["attending"]],
        "notAttending": [r["guest_name"] for r in rsvps if not r["attending"]],
        "gifts": gifts,
    })



@app.route("/api/finish", methods=["POST"])
def api_finish():
    data = request.get_json(silent=True) or {}
    guest_name = (data.get("guestName") or "").strip()
    session_token = (data.get("sessionToken") or "").strip()

    conn = get_db()
    reservations = conn.execute("""
        SELECT g.name FROM gift_reservations gr
        JOIN gifts g ON g.id = gr.gift_id
        WHERE gr.session_token = ?
        ORDER BY gr.reserved_at ASC
    """, (session_token,)).fetchall()

    single_gifts = conn.execute("""
        SELECT name, custom_description, is_custom FROM gifts
        WHERE reserved_by = ? AND session_token IS NULL
    """, (guest_name,)).fetchall() if guest_name else []

    conn.close()

    gift_list = [r["name"] for r in reservations]

    if not gift_list:
        return jsonify({"success": True})

    items_html = "".join(f"<li>🎁 {g}</li>" for g in gift_list)

    html = f"""
    <div style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; color: #1A1F3A;">
      <h2 style="color: #2E4A9E;">Chá de Panela — Resumo final do convidado</h2>
      <p><strong>{guest_name or 'Convidado'}</strong> finalizou a escolha de presentes:</p>
      <ul style="margin: 1rem 0; padding-left: 1.5rem; line-height: 2;">
        {items_html}
      </ul>
      <hr style="border: none; border-top: 1px solid #dce4f5; margin: 24px 0;">
      <p style="color: #4A5480; font-size: 0.9rem;">Este resumo foi enviado ao clicar em "Enviar" no convite.</p>
    </div>
    """

    try:
        _send_email(f"✦ {guest_name} finalizou os presentes", html)
    except Exception as exc:
        print(f"Erro ao enviar e-mail de finalização: {exc}")

    return jsonify({"success": True})

if __name__ == "__main__":
    init_db()
    port = int(os.getenv("PORT", "3000"))
    print(f"\nChá de Panela rodando em http://localhost:{port}\n")
    app.run(host="0.0.0.0", port=port, debug=True)
