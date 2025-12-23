import asyncio
from typing import Optional

from aiogram import Bot, Dispatcher, F
from aiogram.enums import ParseMode
from aiogram.filters import Command, CommandObject
from aiogram.types import (CallbackQuery, InlineKeyboardButton,
                           InlineKeyboardMarkup, Message)

from .config import BotConfig, PLAN_PRICES
from .db import Base, engine, session_scope
from .models import (ChatMessage, ChatSender, Complaint, Kent, Payment,
                     PaymentStatus, Subscription, User, UserRole)
from .payments import PaymentService
from .security import ensure_text_only, validate_message_content


def init_db():
    Base.metadata.create_all(engine)


def subscription_status(user_id: int) -> str:
    with session_scope() as session:
        user = session.get(User, user_id)
        active_sub = None
        for sub in sorted(user.subscriptions, key=lambda s: s.end_at, reverse=True):
            if sub.is_active:
                active_sub = sub
                break
        if active_sub:
            return f"Активная подписка: {active_sub.plan} до {active_sub.end_at:%d.%m.%Y}"
        return "Подписка отсутствует."


def build_payment_keyboard() -> InlineKeyboardMarkup:
    buttons = [
        [InlineKeyboardButton(text=f"{title.capitalize()} — {PLAN_PRICES[plan]} ₽", callback_data=f"buy:{plan}")]
        for plan, title in zip(["day", "week", "month"], ["день", "неделя", "месяц"])
    ]
    return InlineKeyboardMarkup(inline_keyboard=buttons)


def build_complaint_keyboard(user_id: int, kent_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="Пожаловаться", callback_data=f"complain:{user_id}:{kent_id}")]]
    )


def require_admin(user: User) -> bool:
    return user.role == UserRole.admin


class KentBot:
    def __init__(self, config: BotConfig):
        self.config = config
        self.payment_service = PaymentService(config)
        self.bot = Bot(token=config.telegram_token, parse_mode=ParseMode.HTML)
        self.dp = Dispatcher()
        self.register_handlers()

    async def get_or_create_user(self, message: Message) -> User:
        with session_scope() as session:
            user = session.query(User).filter_by(telegram_id=message.from_user.id).first()
            if not user:
                role = UserRole.admin if message.from_user.id in self.config.admin_ids else UserRole.user
                user = User(telegram_id=message.from_user.id, username=message.from_user.username, role=role)
                session.add(user)
                session.flush()
            return user

    def register_handlers(self):
        dp = self.dp

        @dp.message(Command("start"))
        async def start(message: Message):
            user = await self.get_or_create_user(message)
            text = (
                "Привет! Это сервис \"Кент\" — подписка на общение и совместные игры с Кентами.\n"
                "• Текстовый чат без медиа\n"
                "• Запрет на обмен контактами и ссылками\n"
                "• Жалоба в один клик\n\n"
                "Используй /info чтобы узнать правила или выбери тариф:"
            )
            await message.answer(text, reply_markup=build_payment_keyboard())

        @dp.message(Command("info"))
        async def info(message: Message):
            await message.answer(
                "Правила сервиса:\n"
                "— Только текстовые сообщения, без медиа.\n"
                "— Запрещены ссылки, телефоны и контакты.\n"
                "— Никакого 18+ контента или интимных услуг.\n"
                "— Подписка открывает доступ ко всем Кентам.\n"
                "Если видишь нарушение — используй кнопку жалобы."
            )

        @dp.message(Command("status"))
        async def status(message: Message):
            user = await self.get_or_create_user(message)
            with session_scope() as session:
                payments = (
                    session.query(Payment)
                    .filter_by(user_id=user.id, status=PaymentStatus.pending)
                    .all()
                )
                for payment in payments:
                    if payment.yookassa_id:
                        status_value = self.payment_service.fetch_status(payment.yookassa_id)
                        if status_value == PaymentStatus.paid:
                            sub = Subscription.create_for_plan(user.id, payment.plan)
                            session.add(sub)
                        payment.status = status_value
                        session.add(payment)
            await message.answer(subscription_status(user.id))

        @dp.message(Command("kents"))
        async def list_kents(message: Message):
            user = await self.get_or_create_user(message)
            with session_scope() as session:
                db_user = session.get(User, user.id)
                kent_rows = session.query(Kent).filter_by(active=True).all()
                if not kent_rows:
                    await message.answer("Анкеты Кентов пока не добавлены.")
                    return
                parts = []
                for kent in kent_rows:
                    parts.append(f"#{kent.id} {kent.name}\n{kent.bio}")
                await message.answer(
                    "Доступные Кенты:\n\n" + "\n\n".join(parts) + "\n\nОтветь номером Кента для старта чата.")
                db_user.active_kent_id = None
                session.add(db_user)

        @dp.message(Command("pay"))
        async def pay(message: Message, command: CommandObject):
            plan = (command.args or "").strip() or "month"
            if plan not in PLAN_PRICES:
                await message.answer("Выбери тариф: day, week или month")
                return
            await self.start_payment(message, plan)

        @dp.callback_query(F.data.startswith("buy:"))
        async def buy_callback(callback: CallbackQuery):
            plan = callback.data.split(":", 1)[1]
            await self.start_payment(callback.message, plan, callback)

        @dp.callback_query(F.data.startswith("complain:"))
        async def complain_callback(callback: CallbackQuery):
            _, user_id, kent_id = callback.data.split(":")
            with session_scope() as session:
                complaint = Complaint(user_id=int(user_id), kent_id=int(kent_id), message="Кнопка жалобы")
                session.add(complaint)
            await callback.answer("Жалоба зафиксирована. Мы разберёмся.", show_alert=True)

        @dp.message(Command("admin"))
        async def admin_panel(message: Message):
            user = await self.get_or_create_user(message)
            if not require_admin(user):
                await message.answer("Доступ ограничен")
                return
            await message.answer(
                "Админ-панель:\n"
                "/add_kent Имя|Описание|telegram_id\n"
                "/remove_kent <id>\n"
                "/block <user_id>\n"
                "/complaints — список жалоб"
            )

        @dp.message(Command("add_kent"))
        async def add_kent(message: Message):
            user = await self.get_or_create_user(message)
            if not require_admin(user):
                await message.answer("Нет доступа")
                return
            if not message.get_args():
                await message.answer("Используй: /add_kent Имя|Описание|telegram_id(optional)")
                return
            try:
                name, bio, tg_id = (message.get_args().split("|", 2) + [None])[:3]
            except ValueError:
                await message.answer("Неверный формат")
                return
            with session_scope() as session:
                kent = Kent(name=name.strip(), bio=bio.strip(), telegram_id=int(tg_id) if tg_id else None)
                session.add(kent)
            await message.answer("Кент добавлен")

        @dp.message(Command("remove_kent"))
        async def remove_kent(message: Message):
            user = await self.get_or_create_user(message)
            if not require_admin(user):
                await message.answer("Нет доступа")
                return
            if not message.get_args():
                await message.answer("Используй: /remove_kent <id>")
                return
            with session_scope() as session:
                kent = session.get(Kent, int(message.get_args()))
                if not kent:
                    await message.answer("Не найден")
                    return
                session.delete(kent)
            await message.answer("Кент удалён")

        @dp.message(Command("block"))
        async def block_user(message: Message):
            user = await self.get_or_create_user(message)
            if not require_admin(user):
                await message.answer("Нет доступа")
                return
            if not message.get_args():
                await message.answer("Используй: /block <user_id>")
                return
            with session_scope() as session:
                target = session.get(User, int(message.get_args()))
                if not target:
                    await message.answer("Пользователь не найден")
                    return
                target.is_blocked = True
                session.add(target)
            await message.answer("Пользователь заблокирован")

        @dp.message(Command("complaints"))
        async def list_complaints(message: Message):
            user = await self.get_or_create_user(message)
            if not require_admin(user):
                await message.answer("Нет доступа")
                return
            with session_scope() as session:
                complaints = session.query(Complaint).order_by(Complaint.created_at.desc()).limit(20).all()
                if not complaints:
                    await message.answer("Жалоб нет")
                    return
                lines = []
                for c in complaints:
                    lines.append(
                        f"#{c.id} user={c.user_id} kent={c.kent_id} {c.created_at:%d.%m} resolved={c.resolved}\n{c.message}"
                    )
                await message.answer("\n\n".join(lines))

        @dp.message(Command("reply"))
        async def reply_to_user(message: Message, command: CommandObject):
            user = await self.get_or_create_user(message)
            if user.role not in {UserRole.kent, UserRole.admin}:
                await message.answer("Доступно только Кентам")
                return
            if not command.args or " " not in command.args:
                await message.answer("Используй: /reply <user_id> текст")
                return
            user_id_str, text = command.args.split(" ", 1)
            with session_scope() as session:
                target_user = session.get(User, int(user_id_str))
                if not target_user:
                    await message.answer("Пользователь не найден")
                    return
                kent = session.query(Kent).filter_by(telegram_id=message.from_user.id).first()
                kent_id = kent.id if kent else target_user.active_kent_id
                if not kent_id:
                    await message.answer("Нет активного чата")
                    return
                session.add(
                    ChatMessage(
                        user_id=target_user.id,
                        kent_id=kent_id,
                        sender=ChatSender.kent,
                        content=text,
                    )
                )
            await self.bot.send_message(target_user.telegram_id, f"Сообщение от Кента:\n{text}",
                                         reply_markup=build_complaint_keyboard(target_user.id, kent_id))
            await message.answer("Отправлено")

        @dp.message()
        async def text_router(message: Message):
            user = await self.get_or_create_user(message)
            if user.is_blocked:
                await message.answer("Доступ ограничен модерацией.")
                return
            if not await ensure_text_only(message):
                return
            if not await validate_message_content(message):
                return
            with session_scope() as session:
                db_user = session.get(User, user.id)
                kent_id = db_user.active_kent_id
                if not kent_id:
                    # expecting numeric selection for kent
                    if message.text and message.text.strip().isdigit():
                        kent_id = int(message.text.strip())
                        kent = session.get(Kent, kent_id)
                        if kent and kent.active:
                            db_user.active_kent_id = kent_id
                            session.add(db_user)
                            await message.answer(
                                f"Чат с Кентом {kent.name} открыт. Пиши сообщение.",
                                reply_markup=build_complaint_keyboard(db_user.id, kent_id),
                            )
                        else:
                            await message.answer("Кент не найден или недоступен.")
                    else:
                        await message.answer("Выбери Кента командой /kents и ответь номером.")
                    return
                # log and forward
                session.add(
                    ChatMessage(
                        user_id=db_user.id,
                        kent_id=kent_id,
                        sender=ChatSender.user,
                        content=message.text,
                    )
                )
                kent = session.get(Kent, kent_id)
                if kent and kent.telegram_id:
                    await self.bot.send_message(
                        kent.telegram_id,
                        f"Сообщение от пользователя {db_user.id}:\n{message.text}",
                        reply_markup=InlineKeyboardMarkup(
                            inline_keyboard=[[InlineKeyboardButton(text="Ответить", callback_data=f"replyto:{db_user.id}")]]
                        ),
                    )
                await message.answer("Сообщение отправлено Кенту.",
                                     reply_markup=build_complaint_keyboard(db_user.id, kent_id))

        @dp.callback_query(F.data.startswith("replyto:"))
        async def prompt_reply(callback: CallbackQuery):
            user_id = int(callback.data.split(":")[1])
            await callback.message.answer(
                f"Ответь командой /reply {user_id} <текст> для продолжения диалога."
            )
            await callback.answer()

    async def start_payment(self, message: Message, plan: str, callback: Optional[CallbackQuery] = None):
        user = await self.get_or_create_user(message)
        amount = PLAN_PRICES[plan]
        description = f"Подписка {plan} для пользователя {user.id}"
        with session_scope() as session:
            payment = Payment(user_id=user.id, plan=plan, amount=amount)
            session.add(payment)
            session.flush()
            payment_id = payment.id
        result = self.payment_service.create_payment(amount, description)
        if result:
            url, yookassa_id = result
            with session_scope() as session:
                payment = session.get(Payment, payment_id)
                payment.yookassa_id = yookassa_id
                session.add(payment)
            await message.answer(
                f"Ссылка на оплату: {url}\nПосле оплаты вернись и введи /status для проверки."
            )
        else:
            with session_scope() as session:
                sub = Subscription.create_for_plan(user.id, plan)
                session.add(sub)
                payment = session.get(Payment, payment_id)
                payment.status = PaymentStatus.paid
                session.add(payment)
            await message.answer("Оплата в песочнице пропущена. Подписка активирована.")
        if callback:
            await callback.answer()

    async def run(self):
        init_db()
        await self.dp.start_polling(self.bot)


def main():
    config = BotConfig.load()
    bot = KentBot(config)
    asyncio.run(bot.run())


if __name__ == "__main__":
    main()
