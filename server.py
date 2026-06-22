import os
import sqlite3
import smtplib
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory

load_dotenv()

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)
DB_PATH = DATA_DIR / "cha-de-panela.db"

DEFAULT_GIFTS = [
    # (nome, categoria, unlimited)
    # Eletrodomésticos: unlimited=False → só uma pessoa pode escolher
    ("Liquidificador", "Eletrodomésticos", False),
    ("Mixer de mão", "Eletrodomésticos", False),
    # Todos os outros: unlimited=True → várias pessoas podem escolher
    ("Jogo de panelas antiaderente", "Cozinha", True),
    ("Jogo de facas", "Cozinha", True),
    ("Frigideira grande", "Cozinha", True),
    ("Panela de pressão", "Cozinha", True),
    ("Jogo de pratos (6 pessoas)", "Mesa", True),
    ("Jogo de copos", "Mesa", True),
    ("Jogo de talheres", "Mesa", True),
    ("Jogo de xícaras", "Mesa", True),
    ("Jogo de travessas", "Mesa", True),
    ("Tábua de corte", "Utensílios", True),
    ("Escorredor de macarrão", "Utensílios", True),
    ("Conjunto de potes herméticos", "Organização", True),
    ("Jogo de formas para bolo", "Assar", True),
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
            unlimited INTEGER DEFAULT 0,
            reserved_by TEXT,
            custom_description TEXT,
            reserved_at TEXT
        );
        CREATE TABLE IF NOT EXISTS gift_reservations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            gift_id INTEGER NOT NULL,
            deliverer_name TEXT NOT NULL,
            reserved_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (gift_id) REFERENCES gifts(id)
        );
    """)

    columns = {row[1] for row in conn.execute("PRAGMA table_info(gifts)").fetchall()}
    if "unlimited" not in columns:
        conn.execute("ALTER TABLE gifts ADD COLUMN unlimited INTEGER DEFAULT 0")

    unlimited_by_name = {name: int(unlimited) for name, _, unlimited in DEFAULT_GIFTS}
    for name, unlimited in unlimited_by_name.items():
        conn.execute(
            "UPDATE gifts SET unlimited = ? WHERE name = ? AND is_custom = 0",
            (unlimited, name),
        )
    conn.commit()

    count = conn.execute("SELECT COUNT(*) FROM gifts WHERE is_custom = 0").fetchone()[0]
    if count == 0:
        conn.executemany(
            "INSERT INTO gifts (name, category, unlimited) VALUES (?, ?, ?)",
            DEFAULT_GIFTS,
        )
        conn.commit()
    conn.close()


def _smtp_configured():
    return bool(os.getenv("SMTP_USER") and os.getenv("SMTP_PASS"))


def _send_email(subject, html):
    organizer = os.getenv("ORGANIZER_EMAIL")
    if not organizer:
        print("ORGANIZER_EMAIL não configurado — e-mail não enviado.")
        return

    smtp_user = os.getenv("SMTP_USER")
    smtp_pass = os.getenv("SMTP_PASS")
    if not smtp_user or not smtp_pass:
        print(f"[simulado] {subject}")
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f'"Chá de Panela" <{smtp_user}>'
    msg["To"] = organizer
    msg.attach(MIMEText(html, "html", "utf-8"))

    host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    port = int(os.getenv("SMTP_PORT", "587"))

    with smtplib.SMTP(host, port) as server:
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.sendmail(smtp_user, organizer, msg.as_string())

    print(f"E-mail enviado para {organizer}")


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
      <p><strong>{guest_name}</strong> informou que <strong>não poderá comparecer</strong> ao chá de panela.</p>
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
        SELECT id, name, category, is_custom, unlimited, reserved_by, custom_description
        FROM gifts ORDER BY is_custom ASC, category ASC, name ASC
    """).fetchall()

    unlimited_reservations = {}
    for row in conn.execute("""
        SELECT gift_id, deliverer_name FROM gift_reservations ORDER BY reserved_at ASC
    """):
        unlimited_reservations.setdefault(row["gift_id"], []).append(row["deliverer_name"])

    conn.close()

    result = []
    for r in rows:
        is_unlimited = bool(r["unlimited"])
        reserved_names = unlimited_reservations.get(r["id"], [])
        result.append({
            "id": r["id"],
            "name": r["name"],
            "category": r["category"],
            "isCustom": bool(r["is_custom"]),
            "unlimited": is_unlimited,
            "reserved": bool(r["reserved_by"]) if not is_unlimited else False,
            "reservedBy": r["reserved_by"],
            "reservedByList": reserved_names,
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

    now = datetime.now().strftime("%d/%m/%Y %H:%M")

    if gift["unlimited"]:
        conn.execute(
            "INSERT INTO gift_reservations (gift_id, deliverer_name, reserved_at) VALUES (?, ?, ?)",
            (gift_id, deliverer_name, now),
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
                "id": gift["id"],
                "name": gift["name"],
                "reservedBy": deliverer_name,
            },
        })

    if gift["reserved_by"]:
        conn.close()
        return jsonify({"error": "Este presente já foi escolhido por outra pessoa."}), 409

    conn.execute(
        "UPDATE gifts SET reserved_by = ?, reserved_at = ? WHERE id = ? AND reserved_by IS NULL",
        (deliverer_name, now, gift_id),
    )
    conn.commit()
    updated = conn.execute("SELECT * FROM gifts WHERE id = ?", (gift_id,)).fetchone()
    conn.close()

    if not updated["reserved_by"]:
        return jsonify({"error": "Este presente acabou de ser escolhido por outra pessoa."}), 409

    try:
        send_gift_email(deliverer_name, gift["name"], False)
    except Exception as exc:
        print(f"Erro ao enviar e-mail: {exc}")

    return jsonify({
        "success": True,
        "gift": {
            "id": updated["id"],
            "name": updated["name"],
            "reservedBy": updated["reserved_by"],
        },
    })


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
    gifts.extend(
        {
            "name": g["name"],
            "reservedBy": g["reserved_by"],
            "reservedAt": g["reserved_at"],
        }
        for g in multi_gifts
    )

    return jsonify({
        "attending": [r["guest_name"] for r in rsvps if r["attending"]],
        "notAttending": [r["guest_name"] for r in rsvps if not r["attending"]],
        "gifts": gifts,
    })


if __name__ == "__main__":
    init_db()
    port = int(os.getenv("PORT", "3000"))
    print(f"\nChá de Panela rodando em http://localhost:{port}\n")
    if not os.getenv("ORGANIZER_EMAIL"):
        print("Configure ORGANIZER_EMAIL no .env para receber e-mails.")
    if not _smtp_configured():
        print("Configure SMTP no .env para envio de e-mails.")
    app.run(host="0.0.0.0", port=port, debug=True)