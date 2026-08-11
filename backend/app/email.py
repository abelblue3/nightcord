import logging

import resend

from app.config import settings

resend.api_key = settings.resend_api_key
logger = logging.getLogger("nightcord.email")


def send_verification_email(to_email: str, token: str) -> None:
    verify_url = f"{settings.frontend_url}/verify.html?token={token}"

    try:
        resend.Emails.send(
            {
                "from": settings.email_from,
                "to": [to_email],
                "subject": "Verify your nightcord account",
                "html": f"""
                    <p>Welcome to nightcord.</p>
                    <p>Click the link below to verify your student email and activate your account:</p>
                    <p><a href="{verify_url}">{verify_url}</a></p>
                    <p>This link expires in 24 hours. If you didn't sign up for nightcord, you can ignore this email.</p>
                """,
            }
        )
    except Exception:
        # The account still gets created even if the email fails to send —
        # the user can request a new link via /auth/resend-verification.
        logger.exception("Failed to send verification email to %s", to_email)
