import enum
from datetime import datetime, timedelta

from sqlalchemy import Boolean, Column, DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from .db import Base
from .config import PLAN_DURATIONS


class UserRole(enum.Enum):
    user = "user"
    kent = "kent"
    admin = "admin"


class ChatSender(enum.Enum):
    user = "user"
    kent = "kent"


class PaymentStatus(enum.Enum):
    pending = "pending"
    paid = "paid"
    canceled = "canceled"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    telegram_id = Column(Integer, unique=True, nullable=False)
    username = Column(String, nullable=True)
    role = Column(Enum(UserRole), default=UserRole.user, nullable=False)
    is_blocked = Column(Boolean, default=False)
    active_kent_id = Column(Integer, ForeignKey("kents.id"), nullable=True)

    subscriptions = relationship("Subscription", back_populates="user")
    complaints = relationship("Complaint", back_populates="user")


class Kent(Base):
    __tablename__ = "kents"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    bio = Column(Text, default="")
    telegram_id = Column(Integer, nullable=True)
    active = Column(Boolean, default=True)

    users = relationship("User", backref="kent")
    complaints = relationship("Complaint", back_populates="kent")


class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    plan = Column(String, nullable=False)
    start_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    end_at = Column(DateTime, nullable=False)

    user = relationship("User", back_populates="subscriptions")

    @classmethod
    def create_for_plan(cls, user_id: int, plan: str) -> "Subscription":
        days = PLAN_DURATIONS.get(plan, 0)
        now = datetime.utcnow()
        end_at = now + timedelta(days=days)
        return cls(user_id=user_id, plan=plan, start_at=now, end_at=end_at)

    @property
    def is_active(self) -> bool:
        return self.end_at >= datetime.utcnow()


class Payment(Base):
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    plan = Column(String, nullable=False)
    amount = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    yookassa_id = Column(String, nullable=True)
    status = Column(Enum(PaymentStatus), default=PaymentStatus.pending, nullable=False)

    user = relationship("User")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    kent_id = Column(Integer, ForeignKey("kents.id"), nullable=False)
    sender = Column(Enum(ChatSender), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class Complaint(Base):
    __tablename__ = "complaints"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    kent_id = Column(Integer, ForeignKey("kents.id"), nullable=False)
    message = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    resolved = Column(Boolean, default=False)

    user = relationship("User", back_populates="complaints")
    kent = relationship("Kent", back_populates="complaints")

