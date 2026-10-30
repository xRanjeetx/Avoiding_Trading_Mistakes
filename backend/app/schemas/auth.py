from pydantic import BaseModel, Field, field_validator

from ..core.config import PASSWORD_MIN_LENGTH
from .base import CamelModel


class LoginIn(BaseModel):
    """No length minimum here: accounts made under older, looser rules must still be able to log in."""

    email: str = Field(max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=1, max_length=72)

    @field_validator("password")
    @classmethod
    def _fits_bcrypt(cls, v: str) -> str:
        if len(v.encode()) > 72:
            raise ValueError("Password is too long (72 bytes at most; some characters use more than one)")
        return v


class Credentials(BaseModel):
    """A new account. The strength rules beyond length (common/breached passwords) are checked in core/passwords.py."""

    email: str = Field(max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=72)
    captcha_token: str | None = Field(None, max_length=4096)

    @field_validator("password")
    @classmethod
    def _fits_bcrypt(cls, v: str) -> str:
        # bcrypt only reads the first 72 BYTES. Longer passwords would be silently cut, so two
        # different passwords could open the same account.
        if len(v.encode()) > 72:
            raise ValueError("Password is too long (72 bytes at most; some characters use more than one)")
        return v


class Token(BaseModel):
    access_token: str
    email: str
    is_admin: bool = False


class MeOut(CamelModel):
    email: str
    is_admin: bool
    two_factor: bool = False


class LoginOut(BaseModel):
    """Either a finished login (access_token...), or `mfa_required` with a short-lived `mfa_token` to send to /login/2fa."""

    access_token: str | None = None
    email: str | None = None
    is_admin: bool = False
    mfa_required: bool = False
    mfa_token: str | None = None
    pending_approval: bool = False  # email verified (or password reset) but an admin has not approved the account yet


class MfaIn(BaseModel):
    mfa_token: str = Field(max_length=2000)
    code: str = Field(min_length=1, max_length=40)


class PasswordIn(BaseModel):
    password: str = Field(max_length=200)


class CodeIn(BaseModel):
    code: str = Field(min_length=1, max_length=40)


class DisableTwoFactorIn(PasswordIn):
    code: str = Field(min_length=1, max_length=40)


class ActiveIn(CamelModel):
    is_active: bool


class RegisterOut(BaseModel):
    """access_token is None when the account must verify its email before logging in."""

    access_token: str | None = None
    email: str
    verification_sent: bool = False
    pending_approval: bool = False  # the account exists but an admin must approve it before the first login


class EmailOnly(BaseModel):
    email: str = Field(max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class ForgotIn(EmailOnly):
    captcha_token: str | None = Field(None, max_length=4096)


class TokenIn(BaseModel):
    token: str = Field(max_length=2000)


class ResetIn(TokenIn):
    password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=72)

    @field_validator("password")
    @classmethod
    def _fits_bcrypt(cls, v: str) -> str:
        if len(v.encode()) > 72:
            raise ValueError("Password is too long (72 bytes at most; some characters use more than one)")
        return v


class DeleteAccountIn(BaseModel):
    password: str = Field(max_length=200)
