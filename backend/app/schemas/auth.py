from pydantic import BaseModel, Field, field_validator

from .base import CamelModel


class Credentials(BaseModel):
    email: str = Field(max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=8, max_length=72)

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


class ActiveIn(CamelModel):
    is_active: bool


class RegisterOut(BaseModel):
    """access_token is None when the account must verify its email before logging in."""

    access_token: str | None = None
    email: str
    verification_sent: bool = False


class EmailOnly(BaseModel):
    email: str = Field(max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class TokenIn(BaseModel):
    token: str = Field(max_length=2000)


class ResetIn(TokenIn):
    password: str = Field(min_length=8, max_length=72)

    @field_validator("password")
    @classmethod
    def _fits_bcrypt(cls, v: str) -> str:
        if len(v.encode()) > 72:
            raise ValueError("Password is too long (72 bytes at most; some characters use more than one)")
        return v


class DeleteAccountIn(BaseModel):
    password: str = Field(max_length=200)
