from dataclasses import dataclass
import os
from typing import Optional


@dataclass
class BotConfig:
    telegram_token: str
    admin_ids: list[int]
    yookassa_shop_id: Optional[str]
    yookassa_secret_key: Optional[str]
    success_url: str = "https://t.me"
    cancel_url: str = "https://t.me"

    @classmethod
    def load(cls) -> "BotConfig":
        token = os.getenv("TELEGRAM_TOKEN")
        if not token:
            raise RuntimeError("TELEGRAM_TOKEN is required")
        admin_raw = os.getenv("ADMIN_IDS", "")
        admin_ids = [int(x) for x in admin_raw.split(",") if x.strip()]
        return cls(
            telegram_token=token,
            admin_ids=admin_ids,
            yookassa_shop_id=os.getenv("YOOKASSA_SHOP_ID"),
            yookassa_secret_key=os.getenv("YOOKASSA_SECRET_KEY"),
            success_url=os.getenv("SUCCESS_URL", "https://t.me"),
            cancel_url=os.getenv("CANCEL_URL", "https://t.me"),
        )


PLAN_PRICES = {
    "day": 199,
    "week": 699,
    "month": 1890,
}


PLAN_DURATIONS = {
    "day": 1,
    "week": 7,
    "month": 31,
}

