from sqlalchemy import String, inspect, text


def ensure_columns(eng) -> None:
    """create_all only creates missing tables, so add columns introduced after a table already exists."""
    have = {c["name"] for c in inspect(eng).get_columns("user_settings")}
    for col in ("killzones", "pairs", "rules", "news", "loss_limits"):
        if col not in have:
            with eng.begin() as conn:
                conn.execute(text(f"ALTER TABLE user_settings ADD COLUMN {col} JSON"))
    entry_cols = {c["name"] for c in inspect(eng).get_columns("entries")} if inspect(eng).has_table("entries") else None
    for col in ("emotion", "emotion_after"):
        if entry_cols is not None and col not in entry_cols:
            with eng.begin() as conn:
                conn.execute(text(f"ALTER TABLE entries ADD COLUMN {col} VARCHAR(255)"))
    if entry_cols is not None and "images" not in entry_cols:
        with eng.begin() as conn:
            conn.execute(text("ALTER TABLE entries ADD COLUMN images JSON"))
    # An older build created these as INTEGER. The app stores a key such as "calm", which Postgres rejects, so every
    # new entry failed. Convert them to text (existing numbers just become their text form). Also widen the old
    # VARCHAR(20), since a trade can now hold several comma-separated emotions.
    if eng.dialect.name == "postgresql" and inspect(eng).has_table("entries"):
        for c in inspect(eng).get_columns("entries"):
            if c["name"] in ("emotion", "emotion_after") and (
                not isinstance(c["type"], String) or (c["type"].length or 255) < 255
            ):
                with eng.begin() as conn:
                    conn.execute(text(f"ALTER TABLE entries ALTER COLUMN {c['name']} TYPE VARCHAR(255) USING {c['name']}::text"))
    # Accounts that already exist are treated as verified (the DEFAULT TRUE backfills them).
    user_cols = {c["name"] for c in inspect(eng).get_columns("users")}
    if "email_verified" not in user_cols:
        with eng.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT TRUE"))
    for col, ddl in (
        ("is_admin", "BOOLEAN NOT NULL DEFAULT FALSE"),
        ("is_active", "BOOLEAN NOT NULL DEFAULT TRUE"),
        ("created_at", "TIMESTAMP"),
    ):
        if col not in user_cols:
            with eng.begin() as conn:
                conn.execute(text(f"ALTER TABLE users ADD COLUMN {col} {ddl}"))
