from typing import Literal

from pydantic import Field, FiniteFloat, field_validator

from .base import EMOTION, EpochMs, CamelModel


NOTE_MAX = 5000


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
    answers: dict[str, bool] = Field({}, max_length=200)
    failed_rules: list[int] = Field([], max_length=200)
    traded: bool = True
    result: Literal["open", "tp", "sl", "be", "ctc", "manual"] = "open"
    exit: FiniteFloat | None = None
    pnl: FiniteFloat | None = None
    closed_at: EpochMs | None = None
    notes: str = Field("", max_length=NOTE_MAX)
    lesson: str = Field("", max_length=NOTE_MAX)
    emotion: str | None = Field(None, pattern=EMOTION)
    emotion_after: str | None = Field(None, pattern=EMOTION)


class EntryOut(EntryIn):
    # Output only: ids stored by older versions of the app are returned as they are.
    id: str
    # Output is not length-checked: rows saved before these limits existed must still be returned.
    answers: dict[str, bool] = {}
    failed_rules: list[int] = []
    notes: str = ""
    lesson: str = ""
    # Screenshots by slot ("before" / "after"). The value is a token that changes when the image is replaced; the
    # storage key itself stays on the server. Set through the /images endpoints, never through EntryIn.
    images: dict[str, str] = {}

    @field_validator("images", mode="before")
    @classmethod
    def _tokens(cls, v):
        return {slot: key.rsplit("/", 1)[-1].split(".", 1)[0] for slot, key in (v or {}).items()}
