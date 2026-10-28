import logging
import smtplib
from email.message import EmailMessage

from . import config

log = logging.getLogger("tradeguard.mail")


def _send(msg: EmailMessage) -> None:
    try:
        if config.SMTP_SSL:
            smtp = smtplib.SMTP_SSL(config.SMTP_HOST, config.SMTP_PORT, timeout=15)
        else:
            smtp = smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=15)
        with smtp:
            if not config.SMTP_SSL:
                smtp.starttls()
            if config.SMTP_USER:
                smtp.login(config.SMTP_USER, config.SMTP_PASSWORD)
            smtp.send_message(msg)
    except Exception:
        # Runs as a background task: never surface provider errors (or whether the address exists) to the caller.
        log.exception("Could not send email to %s", msg["To"])


def send_link_email(to: str, subject: str, intro: str, button: str, link: str, outro: str) -> None:
    """Sends a short email with one call-to-action link. Without SMTP configured, logs the link instead."""
    if not config.EMAIL_ENABLED:
        log.warning("Email not configured. To: %s | %s | %s", to, subject, link)
        return
    msg = EmailMessage()
    msg["From"] = config.SMTP_FROM
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(f"{intro}\n\n{link}\n\n{outro}")
    msg.add_alternative(
        f"""<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#0f172a">
<h2 style="margin:0 0 12px">Trade Guard</h2>
<p>{intro}</p>
<p><a href="{link}" style="display:inline-block;background:#14b8a6;color:#04201c;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">{button}</a></p>
<p style="font-size:13px;color:#64748b">Or paste this link into your browser:<br>{link}</p>
<p style="font-size:13px;color:#64748b">{outro}</p></div>""",
        subtype="html",
    )
    _send(msg)
