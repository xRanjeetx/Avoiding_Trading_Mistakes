from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """JSON uses camelCase (what the React app already uses); Python uses snake_case."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class Credentials(BaseModel):
    email: str = Field(max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=8, max_length=72)


class Token(BaseModel):
    access_token: str
    email: str


class SettingsOut(CamelModel):
    lot: float = Field(0.02, gt=0)
    min_rr: float = Field(2, gt=0, alias="minRR")
    max_trades: int = Field(4, ge=1)
    max_sl: int = Field(4, ge=1, alias="maxSL")
    london_start: str = Field("12:30", pattern=r"^\d{2}:\d{2}$")
    london_end: str = Field("17:30", pattern=r"^\d{2}:\d{2}$")
    session_start: str = Field("18:00", pattern=r"^\d{2}:\d{2}$")
    session_end: str = Field("22:30", pattern=r"^\d{2}:\d{2}$")
    balance: float = Field(0, ge=0)
    currency: str = Field("$", max_length=4)


class EntryIn(CamelModel):
    id: str | None = Field(None, max_length=40)
    timestamp: int
    pair: str = Field("", max_length=30)
    dir: Literal["buy", "sell"] | None = None
    setup: str | None = Field(None, max_length=20)
    lot: float | None = None
    entry: float | None = None
    sl: float | None = None
    tp: float | None = None
    rr: float | None = None
    answers: dict[str, bool] = {}
    failed_rules: list[int] = []
    traded: bool = True
    result: Literal["open", "tp", "sl", "be", "ctc", "manual"] = "open"
    exit: float | None = None
    pnl: float | None = None
    closed_at: int | None = None
    notes: str = ""
    lesson: str = ""


class EntryOut(EntryIn):
    id: str
