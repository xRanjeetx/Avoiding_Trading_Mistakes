from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, field_validator
from pydantic.alias_generators import to_camel

# 24-hour clock, "00:00" to "23:59".
CLOCK = r"^([01]\d|2[0-3]):[0-5]\d$"
# Epoch milliseconds: from 1970 to the year 9999, which also fits a 64-bit database integer.
EpochMs = Annotated[int, Field(ge=0, le=253_402_300_799_000)]


class CamelModel(BaseModel):
    """JSON uses camelCase (what the React app already uses); Python uses snake_case."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


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


class SettingsOut(CamelModel):
    lot: FiniteFloat = Field(0.02, gt=0)
    min_rr: FiniteFloat = Field(2, gt=0, alias="minRR")
    max_trades: int = Field(4, ge=1)
    max_sl: int = Field(4, ge=1, alias="maxSL")
    london_start: str = Field("12:30", pattern=CLOCK)
    london_end: str = Field("17:30", pattern=CLOCK)
    session_start: str = Field("18:00", pattern=CLOCK)
    session_end: str = Field("22:30", pattern=CLOCK)
    balance: FiniteFloat = Field(0, ge=0)
    currency: str = Field("$", max_length=4)


class EntryIn(CamelModel):
    id: str | None = Field(None, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
    timestamp: EpochMs
    pair: str = Field("", max_length=30)
    dir: Literal["buy", "sell"] | None = None
    setup: str | None = Field(None, max_length=20)
    lot: FiniteFloat | None = None
    entry: FiniteFloat | None = None
    sl: FiniteFloat | None = None
    tp: FiniteFloat | None = None
    rr: FiniteFloat | None = None
    answers: dict[str, bool] = {}
    failed_rules: list[int] = []
    traded: bool = True
    result: Literal["open", "tp", "sl", "be", "ctc", "manual"] = "open"
    exit: FiniteFloat | None = None
    pnl: FiniteFloat | None = None
    closed_at: EpochMs | None = None
    notes: str = ""
    lesson: str = ""


class EntryOut(EntryIn):
    # Output only: ids stored by older versions of the app are returned as they are.
    id: str
