from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

# 24-hour clock, "00:00" to "23:59".
CLOCK = r"^([01]\d|2[0-3]):[0-5]\d$"
# An emotion key such as "calm" or "fomo". The app decides which keys exist, so the API only checks the shape.
# A trade can carry several, comma-separated ("calm,focused"), up to 12.
EMOTION = r"^[a-z][a-z_]{0,19}(,[a-z][a-z_]{0,19}){0,11}$"
# Epoch milliseconds: from 1970 to the year 9999, which also fits a 64-bit database integer.
EpochMs = Annotated[int, Field(ge=0, le=253_402_300_799_000)]


class CamelModel(BaseModel):
    """JSON uses camelCase (what the React app already uses); Python uses snake_case."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)
