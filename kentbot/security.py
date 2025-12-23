import re
from aiogram.types import Message

PROHIBITED_PATTERNS = [
    re.compile(r"https?://", re.IGNORECASE),
    re.compile(r"t\.me/", re.IGNORECASE),
    re.compile(r"@\w+"),
    re.compile(r"\+?\d{7,}"),
]


async def ensure_text_only(message: Message) -> bool:
    if message.content_type != "text":
        await message.answer("Разрешены только текстовые сообщения без медиа.")
        return False
    return True


async def validate_message_content(message: Message) -> bool:
    text = message.text or ""
    for pattern in PROHIBITED_PATTERNS:
        if pattern.search(text):
            await message.answer(
                "Запрещены ссылки, телефоны и контактные данные. Сообщение не отправлено."
            )
            return False
    return True
