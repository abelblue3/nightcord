import logging

import resend

from app.config import settings

resend.api_key = settings.resend_api_key
logger = logging.getLogger("nightcord.email")


def send_verification_email(to_email: str, code: str) -> None:
    try:
        resend.Emails.send(
            {
                "from": settings.email_from,
                "to": [to_email],
                "subject": "Your nightcord verification code",
                "html": f"""
                    <p>Welcome to nightcord.</p>
                    <p>Enter this code to verify your student email and activate your account:</p>
                    <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">{code}</p>
                    <p>This code expires in 15 minutes. If you didn't sign up for nightcord, you can ignore this email.</p>
                """,
            }
        )
    except Exception:
        # The account still gets created even if the email fails to send —
        # the user can request a new code via /auth/resend-verification.
        logger.exception("Failed to send verification email to %s", to_email)
