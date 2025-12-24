# Kent Telegram Bot v0.1 (Cloudflare Workers)

Вебхук-only Telegram-бот подписочного сервиса Kent. Версия 0.1: доступ открыт всем (paywall пока выключен), но таблицы и интерфейсы под подписки готовы.

## Функции
- `/start` — приветствие + меню кнопок (Найти Кента, Мой Кент, Правила, Поддержка).
- `/rules` — короткие правила общения.
- «Найти Кента» — список анкет из D1 (есть 2 демо-кента из сидов).
- «Профиль Кента» — карточка с играми, языком/стилем и статусом.
- «Написать Кенту» — создаёт диалог user↔kent, бот передаёт текст в обе стороны.
- «Пожаловаться» — кнопка в активном диалоге: фиксирует жалобу и шлёт уведомление админу.
- Админ-команды: `/admin`, `/admin_add_kent`, `/admin_list_kents`, `/admin_ban_user <id>`, `/admin_ban_kent <id>`, `/admin_reports`.
- Anti-abuse: запрет ссылок/телефонов/@username (замена на `[запрещено]` + предупреждение), 3 предупреждения → автобан на 24ч; только текст; rate-limit 20 сообщений/минуту.

## Технологии
- Cloudflare Workers (TypeScript) + wrangler.
- Telegram Bot API через вебхуки (`grammy`).
- Хранение: Cloudflare D1 (SQLite) + миграции `migrations/0001_init.sql`.

## Переменные окружения (secrets)
- `TELEGRAM_BOT_TOKEN` — токен бота.
- `ADMIN_TELEGRAM_IDS` — список admin Telegram ID через запятую.
- `TELEGRAM_WEBHOOK_SECRET` — shared secret для вебхука (используется как `secret_token`).
- `APP_NAME` — отображаемое имя (по умолчанию Kent).

## Подготовка и деплой
1. Войти в Cloudflare:
   ```bash
   wrangler login
   ```
2. Создать D1:
   ```bash
   wrangler d1 create kent-bot
   ```
   Скопируйте `database_id` и пропишите его в `wrangler.toml` в блоке `[[d1_databases]]` (поле `database_id`).
3. Применить миграции:
   ```bash
   npm install
   wrangler d1 migrations apply kent-bot
   ```
4. Деплой воркера:
  ```bash
  wrangler deploy
  ```
  После первого старта сиды создадут админа (по первому ID из `ADMIN_TELEGRAM_IDS`) и 2 демо-кента с Telegram ID того же админа (для теста релея).
5. Настроить вебхук Telegram (используется secret_token; при желании можно дублировать параметром `?secret=`):
  ```bash
  export WORKER_URL="https://kent-worker.<your-account>.workers.dev" # или привязанный домен
  export TELEGRAM_BOT_TOKEN="<bot_token>"
  export TELEGRAM_WEBHOOK_SECRET="<secret>"
  curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${WORKER_URL}/webhook&secret_token=${TELEGRAM_WEBHOOK_SECRET}"
   ```

### Локальный прогон
- Проверка типов: `npm run check`
- Локальный dev (эмулятор воркера): `wrangler dev`

## D1 схема
- `users(id, tg_id UNIQUE, role, is_banned, warn_count, ban_expires_at, created_at)`
- `kents(id, tg_id UNIQUE, name, age, city, country, games JSON, bio, status, is_banned, created_at)`
- `conversations(id, user_tg_id, kent_tg_id, state, created_at)`
- `reports(id, from_tg_id, against_tg_id, conv_id, reason, created_at)`
- `subscriptions(id, tg_id, plan, expires_at)` — заглушка под будущий paywall

## Тест-кейсы (ручная проверка)
1) Диалог user↔kent:
   - Отправить `/start` → нажать «Найти Кента» → выбрать профиль → «Написать Кенту».
   - Ввести текст: бот пересылает кенту (в демо это админ); ответ кента пересылается пользователю.
2) Anti-abuse:
   - Отправить сообщение с ссылкой/телефоном — бот заменит на `[запрещено]`, выдаст предупреждение, 3 раза подряд → временный бан.
   - Послать медиа — бот попросит текст.
3) Жалоба:
   - В активном диалоге нажать «Пожаловаться» — запись попадёт в `/admin_reports`, админ получает уведомление.
4) Админ:
   - `/admin_list_kents` — виден список; `/admin_add_kent` — пошаговое создание новой анкеты; `/admin_ban_user <tg_id>` / `/admin_ban_kent <id>` блокируют.

## Примечания
- Версия 0.1 без оплаты, но таблица `subscriptions` и интерфейсы для будущего paywall уже есть.
- Логи/обработка сообщений не выводят токены. Все ограничения антиабьюза работают до релея (Kent получает уже очищенный текст).
