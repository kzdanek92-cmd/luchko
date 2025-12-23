import uuid
from typing import Optional, Tuple

from yookassa import Configuration, Payment as YooPayment

from .config import BotConfig, PLAN_PRICES
from .models import PaymentStatus


class PaymentService:
    def __init__(self, config: BotConfig):
        if config.yookassa_shop_id and config.yookassa_secret_key:
            Configuration.account_id = config.yookassa_shop_id
            Configuration.secret_key = config.yookassa_secret_key
        self.config = config

    def create_payment(self, amount: int, description: str) -> Optional[Tuple[str, str]]:
        if not (self.config.yookassa_shop_id and self.config.yookassa_secret_key):
            return None
        payment = YooPayment.create(
            {
                "amount": {"value": f"{amount:.2f}", "currency": "RUB"},
                "confirmation": {
                    "type": "redirect",
                    "return_url": self.config.success_url,
                },
                "capture": True,
                "description": description,
            },
            str(uuid.uuid4()),
        )
        return payment.confirmation.confirmation_url, payment.id

    def fetch_status(self, payment_id: str) -> PaymentStatus:
        if not (self.config.yookassa_shop_id and self.config.yookassa_secret_key):
            return PaymentStatus.pending
        payment = YooPayment.find_one(payment_id)
        if payment.status == "succeeded":
            return PaymentStatus.paid
        if payment.status == "canceled":
            return PaymentStatus.canceled
        return PaymentStatus.pending

    @staticmethod
    def amount_for_plan(plan: str) -> int:
        return PLAN_PRICES[plan]
