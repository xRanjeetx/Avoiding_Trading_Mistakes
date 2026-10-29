from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, StringConstraints, field_validator, model_validator
from pydantic.alias_generators import to_camel

# 24-hour clock, "00:00" to "23:59".
CLOCK = r"^([01]\d|2[0-3]):[0-5]\d$"
# An emotion key such as "calm" or "fomo". The app decides which keys exist, so the API only checks the shape.
EMOTION = r"^[a-z][a-z_]{0,19}$"
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
    # Money gained or lost when price moves 1.00 with 1 lot (gold 100, EURUSD 100000). Used to turn entry and SL into the
    # risk of a trade. NULL means "use the app's built-in value, if it knows the pair".
    value: FiniteFloat | None = Field(None, gt=0)


DEFAULT_PAIRS = [{"pair": "XAUUSD", "lot": 0.02}, {"pair": "EURUSD", "lot": 0.2}]


class CustomRule(CamelModel):
    """A rule the user wrote. It is a yes/no question: "Yes" always means the rule is respected."""

    id: int = Field(ge=1000, le=999_999)  # built-in rules use ids below 1000
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
    q: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] = ""


class RulesConfig(CamelModel):
    disabled: list[Annotated[int, Field(ge=1, le=999_999)]] = Field(default_factory=list, max_length=200)  # rule ids switched off
    custom: list[CustomRule] = Field(default_factory=list, max_length=30)
    # The id the next custom rule gets. Never reused, so old journal entries keep pointing at the rule they were about.
    next_id: int = Field(1000, ge=1000, le=999_999)

    @field_validator("disabled")
    @classmethod
    def _unique_disabled(cls, v: list[int]) -> list[int]:
        return sorted(set(v))

    @field_validator("custom")
    @classmethod
    def _unique_custom(cls, v: list[CustomRule]) -> list[CustomRule]:
        if len({r.id for r in v}) != len(v):
            raise ValueError("Each custom rule needs its own id")
        return v

    @model_validator(mode="after")
    def _next_id_is_fresh(self):
        if self.custom:
            self.next_id = max(self.next_id, max(r.id for r in self.custom) + 1)
        return self


class NewsEvent(CamelModel):
    """One high-impact news release. `at` is epoch milliseconds, so it means the same moment in every time zone."""

    at: EpochMs
    title: Annotated[str, StringConstraints(strip_whitespace=True, max_length=60)] = ""


class NewsConfig(CamelModel):
    lead_min: int = Field(120, ge=1, le=1440)  # stop trading this many minutes before each event
    auto: bool = True  # also use the automatic news calendar (see calendar.py)
    include_medium: bool = True  # warn about the calendar's medium-impact events too (they never block)
    events: list[NewsEvent] = Field(default_factory=list, max_length=200)

    @field_validator("events")
    @classmethod
    def _in_time_order(cls, v: list[NewsEvent]) -> list[NewsEvent]:
        return sorted(v, key=lambda e: e.at)


class LossLimits(CamelModel):
    """Money limits for the account. Blank (None) means that limit is off."""

    daily: FiniteFloat | None = Field(None, gt=0)  # the most that may be lost in one day (net of the day's profit)
    overall: FiniteFloat | None = Field(None, gt=0)  # the most that may be lost in total since `since`
    since: EpochMs | None = None  # the overall count starts here (epoch ms). None counts every trade


class SettingsOut(CamelModel):
    lot: FiniteFloat = Field(0.02, gt=0)
    min_rr: FiniteFloat = Field(2, gt=0, alias="minRR")
    max_trades: int = Field(4, ge=1)
    max_sl: int = Field(4, ge=1, alias="maxSL")
    balance: FiniteFloat = Field(0, ge=0)
    currency: str = Field("$", max_length=4)
    killzones: list[Killzone] = Field(default_factory=lambda: [Killzone(**z) for z in DEFAULT_KILLZONES], max_length=4)

    pairs: list[PairLot] = Field(default_factory=lambda: [PairLot(**p) for p in DEFAULT_PAIRS], max_length=50)
    rules: RulesConfig = Field(default_factory=RulesConfig)
    news: NewsConfig = Field(default_factory=NewsConfig)
    loss_limits: LossLimits = Field(default_factory=LossLimits)

    @field_validator("loss_limits", mode="before")
    @classmethod
    def _default_loss_limits_when_unset(cls, v):
        return {} if v is None else v  # rows created before loss limits existed

    @field_validator("news", mode="before")
    @classmethod
    def _default_news_when_unset(cls, v):
        return {} if v is None else v  # rows created before news locks existed

    @field_validator("rules", mode="before")
    @classmethod
    def _default_rules_when_unset(cls, v):
        return {} if v is None else v  # rows created before editable rules existed

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
    emotion: str | None = Field(None, pattern=EMOTION)
    emotion_after: str | None = Field(None, pattern=EMOTION)


class EntryOut(EntryIn):
    # Output only: ids stored by older versions of the app are returned as they are.
    id: str
    # Screenshots by slot ("before" / "after"). The value is a token that changes when the image is replaced; the
    # storage key itself stays on the server. Set through the /images endpoints, never through EntryIn.
    images: dict[str, str] = {}

    @field_validator("images", mode="before")
    @classmethod
    def _tokens(cls, v):
        return {slot: key.rsplit("/", 1)[-1].split(".", 1)[0] for slot, key in (v or {}).items()}
