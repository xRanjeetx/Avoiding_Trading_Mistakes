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


class Killzone(BaseModel):
    """One market session. Times are New York clock times, so daylight saving needs no manual change."""

    key: Literal["asian", "london", "newyork", "londonclose"]
    start: str = Field(pattern=CLOCK)
    end: str = Field(pattern=CLOCK)
    on: bool = True
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")


DEFAULT_KILLZONES = [
    {"key": "asian", "start": "20:00", "end": "00:00", "on": True, "color": "#06b6d4"},
    {"key": "london", "start": "02:00", "end": "05:00", "on": True, "color": "#f59e0b"},
    {"key": "newyork", "start": "07:00", "end": "10:00", "on": True, "color": "#a78bfa"},
    {"key": "londonclose", "start": "10:00", "end": "12:00", "on": True, "color": "#ec4899"},
]


class PairLot(BaseModel):
    """The fixed lot size for one trading pair."""

    pair: str = Field(min_length=1, max_length=30, pattern=r"^[A-Z0-9._-]+$")
    lot: FiniteFloat = Field(gt=0)


DEFAULT_PAIRS = [{"pair": "XAUUSD", "lot": 0.02}, {"pair": "EURUSD", "lot": 0.2}]


class SettingsOut(CamelModel):
    lot: FiniteFloat = Field(0.02, gt=0)
    min_rr: FiniteFloat = Field(2, gt=0, alias="minRR")
    max_trades: int = Field(4, ge=1)
    max_sl: int = Field(4, ge=1, alias="maxSL")
    balance: FiniteFloat = Field(0, ge=0)
    currency: str = Field("$", max_length=4)
    killzones: list[Killzone] = Field(default_factory=lambda: [Killzone(**z) for z in DEFAULT_KILLZONES], max_length=4)

    pairs: list[PairLot] = Field(default_factory=lambda: [PairLot(**p) for p in DEFAULT_PAIRS], max_length=50)

    @field_validator("killzones", mode="before")
    @classmethod
    def _default_when_unset(cls, v):
        return DEFAULT_KILLZONES if v is None else v  # rows created before killzones existed

    @field_validator("pairs", mode="before")
    @classmethod
    def _default_pairs_when_unset(cls, v):
        return DEFAULT_PAIRS if v is None else v  # rows created before per-pair lots existed

    @field_validator("pairs")
    @classmethod
    def _unique_pairs(cls, v: list[PairLot]) -> list[PairLot]:
        if len({p.pair for p in v}) != len(v):
            raise ValueError("Each pair can appear only once")
        return v

    @field_validator("killzones")
    @classmethod
    def _unique_keys(cls, v: list[Killzone]) -> list[Killzone]:
        if len({z.key for z in v}) != len(v):
            raise ValueError("Each session can appear only once")
        return v


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
