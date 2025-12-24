import { Bot, Context, InlineKeyboard, Keyboard, session, SessionFlavor } from "grammy";

interface Env {
  TELEGRAM_BOT_TOKEN: string;
  ADMIN_TELEGRAM_IDS: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  APP_NAME: string;
  DB: D1Database;
}

type ActorRole = "admin" | "kent" | "user";

type AdminAddKentStep =
  | { step: "tg_id" }
  | { step: "name"; tg_id: string }
  | { step: "age"; tg_id: string; name: string }
  | { step: "city"; tg_id: string; name: string; age: number }
  | { step: "country"; tg_id: string; name: string; age: number; city: string }
  | { step: "games"; tg_id: string; name: string; age: number; city: string; country: string }
  | { step: "bio"; tg_id: string; name: string; age: number; city: string; country: string; games: string }
  | { step: "status"; tg_id: string; name: string; age: number; city: string; country: string; games: string; bio: string };

interface SessionData {
  adminAddKent?: AdminAddKentStep;
}

interface UserRecord {
  id: string;
  tg_id: string;
  role: string;
  is_banned: number;
  warn_count: number;
  ban_expires_at?: string | null;
}

interface KentRecord {
  id: string;
  tg_id: string;
  name: string;
  age: number;
  city: string;
  country: string;
  games: string;
  bio: string;
  status: string;
  is_banned: number;
}

interface ConversationRecord {
  id: string;
  user_tg_id: string;
  kent_tg_id: string;
  state: string;
  created_at: string;
}

interface ReportRecord {
  id: string;
  from_tg_id: string;
  against_tg_id: string;
  conv_id: string;
  reason: string;
  created_at: string;
}

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;
const WARN_LIMIT = 3;

const rateLimits = new Map<string, { count: number; windowStart: number }>();
let cachedBot: Bot<KentContext> | undefined;
let bootstrapped = false;

const violationPattern =
  /(https?:\/\/\S+|www\.\S+|@\w+|\+?\d[\d\s\-()]{6,}|t\.me\/\S+)/gim;

interface KentContext extends Context, SessionFlavor<SessionData> {
  env: Env;
  db: D1Database;
  actorRole: ActorRole;
}

const mainKeyboard = new Keyboard()
  .text("💬 Найти Кента")
  .row()
  .text("⭐ Мой Кент")
  .row()
  .text("📜 Правила")
  .text("🆘 Поддержка")
  .resized();

function isoNow() {
  return new Date().toISOString();
}

function sanitizeMessage(text: string) {
  let violation = false;
  const cleanText = text.replace(violationPattern, () => {
    violation = true;
    return "[запрещено]";
  });
  return { cleanText, violation };
}

function checkRateLimit(tgId: string) {
  const now = Date.now();
  const entry = rateLimits.get(tgId) ?? { count: 0, windowStart: now };
  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry.windowStart = now;
    entry.count = 0;
  }
  entry.count += 1;
  rateLimits.set(tgId, entry);
  return entry.count <= RATE_LIMIT_MAX;
}

async function ensureBootstrap(env: Env) {
  if (bootstrapped) return;
  await ensureAdminUsers(env);
  await ensureSeedKents(env);
  bootstrapped = true;
}

async function ensureAdminUsers(env: Env) {
  const adminIds = env.ADMIN_TELEGRAM_IDS.split(",").map((id) => id.trim()).filter(Boolean);
  for (const tgId of adminIds) {
    const existing = await env.DB.prepare("SELECT id FROM users WHERE tg_id = ?").bind(tgId).first();
    if (!existing) {
      await env.DB.prepare(
        "INSERT INTO users (id, tg_id, role, is_banned, warn_count, created_at) VALUES (?, ?, 'admin', 0, 0, ?)"
      )
        .bind(crypto.randomUUID(), tgId, isoNow())
        .run();
    }
  }
}

async function ensureSeedKents(env: Env) {
  const current = await env.DB.prepare("SELECT COUNT(*) as count FROM kents").first<{ count: number }>();
  if (current && current.count > 0) return;
  const fallbackTgId = env.ADMIN_TELEGRAM_IDS.split(",")[0]?.trim() || "0";
  const demoKents = [
    {
      name: "Алекс", age: 26, city: "Москва", country: "Россия", games: ["Valorant", "Apex Legends"],
      bio: "Тактично держу команду в тонусе, люблю координацию и мемы.", status: "online", tg_id: fallbackTgId,
    },
    {
      name: "Лена", age: 24, city: "Санкт-Петербург", country: "Россия", games: ["Genshin Impact", "Stardew Valley"],
      bio: "Спокойно прохожу сюжет, всегда готова помочь новичкам и поддержать беседу.", status: "online", tg_id: fallbackTgId,
    },
  ];

  for (const kent of demoKents) {
    const kentId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO kents (id, tg_id, name, age, city, country, games, bio, status, is_banned, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)"
    )
      .bind(
        kentId,
        kent.tg_id,
        kent.name,
        kent.age,
        kent.city,
        kent.country,
        JSON.stringify(kent.games),
        kent.bio,
        kent.status,
        isoNow()
      )
      .run();
    const existingUser = await env.DB.prepare("SELECT id FROM users WHERE tg_id = ?").bind(kent.tg_id).first();
    if (!existingUser) {
      await env.DB.prepare(
        "INSERT INTO users (id, tg_id, role, is_banned, warn_count, created_at) VALUES (?, ?, 'kent', 0, 0, ?)"
      )
        .bind(crypto.randomUUID(), kent.tg_id, isoNow())
        .run();
    }
  }
}

async function getUser(db: D1Database, tgId: string): Promise<UserRecord | null> {
  const row = await db.prepare("SELECT * FROM users WHERE tg_id = ?").bind(tgId).first<UserRecord>();
  return row ?? null;
}

async function upsertUser(db: D1Database, tgId: string, role: ActorRole) {
  const existing = await getUser(db, tgId);
  if (existing) {
    if (existing.role !== role) {
      await db.prepare("UPDATE users SET role = ? WHERE tg_id = ?").bind(role, tgId).run();
    }
    return existing;
  }
  await db.prepare(
    "INSERT INTO users (id, tg_id, role, is_banned, warn_count, created_at) VALUES (?, ?, ?, 0, 0, ?)"
  )
    .bind(crypto.randomUUID(), tgId, role, isoNow())
    .run();
  return (await getUser(db, tgId)) as UserRecord;
}

async function refreshBan(db: D1Database, user: UserRecord) {
  if (!user.ban_expires_at) return user;
  if (new Date(user.ban_expires_at).getTime() <= Date.now()) {
    await db.prepare("UPDATE users SET is_banned = 0, warn_count = 0, ban_expires_at = NULL WHERE tg_id = ?").bind(user.tg_id).run();
    return { ...user, is_banned: 0, warn_count: 0, ban_expires_at: null } as UserRecord;
  }
  return user;
}

async function incrementWarning(ctx: KentContext, tgId: string) {
  const user = await getUser(ctx.db, tgId);
  if (!user) return;
  const nextWarnings = (user.warn_count ?? 0) + 1;
  if (nextWarnings >= WARN_LIMIT) {
    const banUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await ctx.db
      .prepare("UPDATE users SET warn_count = ?, is_banned = 1, ban_expires_at = ? WHERE tg_id = ?")
      .bind(nextWarnings, banUntil, tgId)
      .run();
  } else {
    await ctx.db.prepare("UPDATE users SET warn_count = ? WHERE tg_id = ?").bind(nextWarnings, tgId).run();
  }
}

async function getActorRole(env: Env, db: D1Database, tgId: string): Promise<ActorRole> {
  const adminIds = env.ADMIN_TELEGRAM_IDS.split(",").map((id) => id.trim());
  if (adminIds.includes(tgId)) return "admin";
  const kent = await db.prepare("SELECT id FROM kents WHERE tg_id = ? AND is_banned = 0").bind(tgId).first();
  if (kent) return "kent";
  return "user";
}

async function handleComplaint(ctx: KentContext, conv: ConversationRecord, reason = "Пожалоба из диалога") {
  await ctx.db
    .prepare("INSERT INTO reports (id, from_tg_id, against_tg_id, conv_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), ctx.from?.id.toString(), conv.kent_tg_id, conv.id, reason, isoNow())
    .run();
  const adminIds = ctx.env.ADMIN_TELEGRAM_IDS.split(",").map((id) => id.trim()).filter(Boolean);
  for (const admin of adminIds) {
    await ctx.api.sendMessage(
      admin,
      `Новая жалоба от ${ctx.from?.id} на кента ${conv.kent_tg_id}. Причина: ${reason}`
    );
  }
}

async function findActiveConversationForUser(db: D1Database, userTgId: string) {
  return (
    (await db
      .prepare("SELECT * FROM conversations WHERE user_tg_id = ? AND state = 'active' ORDER BY created_at DESC LIMIT 1")
      .bind(userTgId)
      .first<ConversationRecord>()) ?? null
  );
}

async function findActiveConversationForKent(db: D1Database, kentTgId: string) {
  return (
    (await db
      .prepare("SELECT * FROM conversations WHERE kent_tg_id = ? AND state = 'active' ORDER BY created_at DESC LIMIT 1")
      .bind(kentTgId)
      .first<ConversationRecord>()) ?? null
  );
}

async function closeExistingConversations(db: D1Database, userTgId: string) {
  await db.prepare("UPDATE conversations SET state = 'closed' WHERE user_tg_id = ? AND state = 'active'").bind(userTgId).run();
}

async function createConversation(db: D1Database, userTgId: string, kentTgId: string) {
  const convId = crypto.randomUUID();
  await db
    .prepare("INSERT INTO conversations (id, user_tg_id, kent_tg_id, state, created_at) VALUES (?, ?, ?, 'active', ?)")
    .bind(convId, userTgId, kentTgId, isoNow())
    .run();
  return convId;
}

function kentProfileText(kent: KentRecord) {
  const games = JSON.parse(kent.games) as string[];
  return [
    `⭐ ${kent.name}, ${kent.age}`,
    `${kent.city}, ${kent.country}`,
    `Игры: ${games.join(", ")}`,
    `Описание: ${kent.bio}`,
    `Статус: ${kent.status}`,
  ].join("\n");
}

function buildBot(env: Env) {
  const bot = new Bot<KentContext>(env.TELEGRAM_BOT_TOKEN);

  bot.use(session({ initial: (): SessionData => ({}) }));

  bot.use(async (ctx, next) => {
    (ctx as KentContext).env = env;
    (ctx as KentContext).db = env.DB;
    const tgId = ctx.from?.id?.toString();
    if (!tgId) return;
    const role = await getActorRole(env, env.DB, tgId);
    (ctx as KentContext).actorRole = role;
    await upsertUser(env.DB, tgId, role);
    const user = await getUser(env.DB, tgId);
    if (!user) return;
    const refreshed = await refreshBan(env.DB, user);
    if (refreshed.is_banned) {
      const untilText = refreshed.ban_expires_at ? ` до ${refreshed.ban_expires_at}` : "";
      await ctx.reply(`Доступ ограничен${untilText}. Обратитесь в поддержку.`);
      return;
    }
    return next();
  });

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Привет 👋 Я Кент — сервис общения и совместной игры.\n• пообщаться с живыми людьми\n• поиграть вместе\n• просто провести время\nВажно: без 18+ и интимных услуг, без обмена контактами. Только 18+.",
      { reply_markup: mainKeyboard }
    );
  });

  bot.command("rules", async (ctx) => {
    await ctx.reply(
      "Правила:\n• без 18+ и интимного контента\n• не делиться ссылками, телефонами, @username\n• не просить деньги\n• если есть проблема — жмите ‘Пожаловаться’",
      { reply_markup: mainKeyboard }
    );
  });

  bot.command("admin", async (ctx) => {
    if ((ctx as KentContext).actorRole !== "admin") return;
    await ctx.reply(
      "Админ-панель:\n/admin_add_kent — добавить кента\n/admin_list_kents — список кентов\n/admin_ban_user <id> — бан пользователя\n/admin_ban_kent <id> — бан кента\n/admin_reports — жалобы"
    );
  });

  bot.command("admin_list_kents", async (ctx) => {
    if ((ctx as KentContext).actorRole !== "admin") return;
    const rows = await ctx.db.prepare("SELECT id, name, tg_id, is_banned FROM kents").all<KentRecord>();
    if (!rows.results.length) {
      await ctx.reply("Кентов пока нет");
      return;
    }
    const lines = rows.results.map((k) => `${k.name} (id: ${k.id}, tg: ${k.tg_id})${k.is_banned ? " — заблокирован" : ""}`);
    await ctx.reply(lines.join("\n"));
  });

  bot.command("admin_reports", async (ctx) => {
    if ((ctx as KentContext).actorRole !== "admin") return;
    const rows = await ctx.db
      .prepare("SELECT * FROM reports ORDER BY created_at DESC LIMIT 20")
      .all<ReportRecord>();
    if (!rows.results.length) {
      await ctx.reply("Жалоб нет");
      return;
    }
    const lines = rows.results.map((r) => `from ${r.from_tg_id} against ${r.against_tg_id} conv ${r.conv_id}: ${r.reason}`);
    await ctx.reply(lines.join("\n\n"));
  });

  bot.command("admin_ban_user", async (ctx) => {
    if ((ctx as KentContext).actorRole !== "admin") return;
    const parts = ctx.message?.text?.split(" ") ?? [];
    const target = parts[1];
    if (!target) {
      await ctx.reply("Укажите id пользователя");
      return;
    }
    await ctx.db.prepare("UPDATE users SET is_banned = 1 WHERE tg_id = ?").bind(target).run();
    await ctx.reply(`Пользователь ${target} заблокирован`);
  });

  bot.command("admin_ban_kent", async (ctx) => {
    if ((ctx as KentContext).actorRole !== "admin") return;
    const parts = ctx.message?.text?.split(" ") ?? [];
    const target = parts[1];
    if (!target) {
      await ctx.reply("Укажите id кента");
      return;
    }
    await ctx.db.prepare("UPDATE kents SET is_banned = 1 WHERE id = ?").bind(target).run();
    await ctx.reply(`Кент ${target} заблокирован`);
  });

  bot.command("admin_add_kent", async (ctx) => {
    if ((ctx as KentContext).actorRole !== "admin") return;
    ctx.session.adminAddKent = { step: "tg_id" };
    await ctx.reply("Введите Telegram ID кента (числом):");
  });

  bot.hears(/^[0-9]+$/, async (ctx, next) => {
    if (ctx.session.adminAddKent?.step !== "tg_id") {
      return next();
    }
    const text = ctx.message?.text;
    if (!text) {
      return next();
    }
    ctx.session.adminAddKent = { step: "name", tg_id: text.trim() };
    await ctx.reply("Имя кента:");
  });

  bot.on("message:text", async (ctx, next) => {
    if (ctx.session.adminAddKent) {
      const flow = ctx.session.adminAddKent;
      const value = ctx.message!.text.trim();
      if (flow.step === "name") {
        ctx.session.adminAddKent = { ...flow, step: "age", name: value };
        await ctx.reply("Возраст:");
        return;
      }
      if (flow.step === "age") {
        const age = Number(value);
        if (Number.isNaN(age)) {
          await ctx.reply("Укажите число для возраста");
          return;
        }
        ctx.session.adminAddKent = { ...flow, step: "city", age };
        await ctx.reply("Город:");
        return;
      }
      if (flow.step === "city") {
        ctx.session.adminAddKent = { ...flow, step: "country", city: value };
        await ctx.reply("Страна:");
        return;
      }
      if (flow.step === "country") {
        ctx.session.adminAddKent = { ...flow, step: "games", country: value };
        await ctx.reply("Игры (через запятую):");
        return;
      }
      if (flow.step === "games") {
        ctx.session.adminAddKent = { ...flow, step: "bio", games: value };
        await ctx.reply("Короткое био:");
        return;
      }
      if (flow.step === "bio") {
        ctx.session.adminAddKent = { ...flow, step: "status", bio: value };
        await ctx.reply("Статус (online/offline):");
        return;
      }
      if (flow.step === "status") {
        const kentId = crypto.randomUUID();
        await ctx.db
          .prepare(
            "INSERT INTO kents (id, tg_id, name, age, city, country, games, bio, status, is_banned, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)"
          )
          .bind(
            kentId,
            flow.tg_id,
            flow.name,
            flow.age,
            flow.city,
            flow.country,
            JSON.stringify(flow.games.split(",").map((g) => g.trim()).filter(Boolean)),
            flow.bio,
            value,
            isoNow()
          )
          .run();
        await upsertUser(ctx.db, flow.tg_id, "kent");
        ctx.session.adminAddKent = undefined;
        await ctx.reply(`Кент ${flow.name} добавлен (id: ${kentId})`);
        return;
      }
    }
    return next();
  });

  bot.hears("💬 Найти Кента", async (ctx) => {
    const rows = await ctx.db.prepare("SELECT * FROM kents WHERE is_banned = 0 ORDER BY created_at DESC LIMIT 10").all<KentRecord>();
    if (!rows.results.length) {
      await ctx.reply("Анкеты пока пусты. Админ добавит их скоро.");
      return;
    }
    const keyboard = new InlineKeyboard();
    rows.results.forEach((kent) => {
      keyboard.text(`Профиль: ${kent.name}`, `view_${kent.id}`).row();
    });
    await ctx.reply("Выберите кента:", { reply_markup: keyboard });
  });

  bot.callbackQuery(/view_/, async (ctx) => {
    const id = ctx.callbackQuery.data?.replace("view_", "");
    if (!id) return;
    const kent = await ctx.db.prepare("SELECT * FROM kents WHERE id = ?").bind(id).first<KentRecord>();
    if (!kent) {
      await ctx.answerCallbackQuery({ text: "Анкета не найдена", show_alert: true });
      return;
    }
    const keyboard = new InlineKeyboard().text("Написать Кенту", `contact_${kent.id}`);
    await ctx.editMessageText(kentProfileText(kent), { reply_markup: keyboard });
  });

  bot.callbackQuery(/contact_/, async (ctx) => {
    const id = ctx.callbackQuery.data?.replace("contact_", "");
    const userId = ctx.from?.id.toString();
    if (!id || !userId) return;
    const kent = await ctx.db.prepare("SELECT * FROM kents WHERE id = ? AND is_banned = 0").bind(id).first<KentRecord>();
    if (!kent) {
      await ctx.answerCallbackQuery({ text: "Кент недоступен", show_alert: true });
      return;
    }
    await closeExistingConversations(ctx.db, userId);
    const convId = await createConversation(ctx.db, userId, kent.tg_id);
    const reportBtn = new InlineKeyboard().text("Пожаловаться", `report_${convId}`);
    await ctx.api.sendMessage(userId, `Вы связаны с ${kent.name}. Пишите сюда, я передам.`, { reply_markup: reportBtn });
    await ctx.api.sendMessage(
      kent.tg_id,
      `Новый чат с пользователем ${userId}. Ответьте сообщением в этот чат, чтобы продолжить.`,
      { reply_markup: reportBtn }
    );
    await ctx.answerCallbackQuery({ text: "Диалог открыт" });
  });

  bot.callbackQuery(/report_/, async (ctx) => {
    const id = ctx.callbackQuery.data?.replace("report_", "");
    const conv = id
      ? await ctx.db.prepare("SELECT * FROM conversations WHERE id = ?").bind(id).first<ConversationRecord>()
      : null;
    if (!conv) {
      await ctx.answerCallbackQuery({ text: "Диалог не найден", show_alert: true });
      return;
    }
    await handleComplaint(ctx as KentContext, conv);
    await ctx.answerCallbackQuery({ text: "Жалоба отправлена" });
  });

  bot.hears("⭐ Мой Кент", async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;
    const conv = await findActiveConversationForUser(ctx.db, userId);
    if (!conv) {
      await ctx.reply("Пока пусто. Нажмите ‘Найти Кента’, чтобы начать диалог.", { reply_markup: mainKeyboard });
      return;
    }
    const kent = await ctx.db.prepare("SELECT * FROM kents WHERE tg_id = ?").bind(conv.kent_tg_id).first<KentRecord>();
    const reportBtn = new InlineKeyboard().text("Пожаловаться", `report_${conv.id}`);
    await ctx.reply(
      `Сейчас вы общаетесь с ${kent?.name ?? "Кентом"}. Пишите сюда, я передам сообщения.`,
      { reply_markup: reportBtn }
    );
  });

  bot.hears("📜 Правила", async (ctx) => {
    await ctx.reply(
      "Правила: без 18+ и интимного контента, без ссылок/телефонов/@username, не просите деньги. Жалобы принимаются кнопкой.",
      { reply_markup: mainKeyboard }
    );
  });

  bot.hears("🆘 Поддержка", async (ctx) => {
    await ctx.reply("Напишите ваш вопрос здесь, мы ответим. Для срочного вопроса — используйте кнопку ‘Пожаловаться’ в диалоге.");
  });

  bot.on("message", async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    if (!ctx.message?.text) {
      await ctx.reply("Пока принимаю только текст. Пожалуйста, отправьте текстовое сообщение.");
      return;
    }

    const userId = from.id.toString();
    const role = (ctx as KentContext).actorRole;

    if (!checkRateLimit(userId)) {
      await ctx.reply("Слишком много сообщений. Попробуйте через минуту.");
      return;
    }

    const { cleanText, violation } = sanitizeMessage(ctx.message.text);
    if (violation) {
      await incrementWarning(ctx as KentContext, userId);
      await ctx.reply("Контакты и ссылки запрещены. Предупреждение зафиксировано.");
    }

    const userRecord = await getUser(ctx.db, userId);
    if (userRecord?.is_banned) {
      await ctx.reply("Вы временно заблокированы.");
      return;
    }

    if (role === "user") {
      const conv = await findActiveConversationForUser(ctx.db, userId);
      if (!conv) {
        await ctx.reply("Сначала выберите кента через ‘Найти Кента’.", { reply_markup: mainKeyboard });
        return;
      }
      try {
        await ctx.api.sendMessage(conv.kent_tg_id, `От пользователя ${userId}: ${cleanText}`);
      } catch (err) {
        await ctx.reply("Не удалось доставить сообщение кенту. Попробуйте позже.");
        return;
      }
      await ctx.reply("Сообщение отправлено кенту.");
      return;
    }

    if (role === "kent") {
      const conv = await findActiveConversationForKent(ctx.db, userId);
      if (!conv) {
        await ctx.reply("Активный диалог не найден. Подождите, пока пользователь откроет чат." );
        return;
      }
      await ctx.api.sendMessage(conv.user_tg_id, `Ответ от кента: ${cleanText}`);
      return;
    }

    // Admin fallback: if admin writes text without command, allow to forward to support
    if (role === "admin") {
      await ctx.reply("Сообщение принято. Используйте команды /admin_* для действий.");
    }
  });

  return bot;
}

function assertWebhookSecret(request: Request, env: Env) {
  const url = new URL(request.url);
  const secret =
    url.searchParams.get("secret") || request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  return secret === env.TELEGRAM_WEBHOOK_SECRET;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "GET") {
      return new Response(`${env.APP_NAME || "Kent"} worker active`, { status: 200 });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/webhook") {
      return new Response("Not found", { status: 404 });
    }

    if (!assertWebhookSecret(request, env)) {
      return new Response("Forbidden", { status: 403 });
    }

    await ensureBootstrap(env);
    if (!cachedBot) {
      cachedBot = buildBot(env);
    }
    let update: unknown;
    try {
      update = await request.json();
    } catch (err) {
      return new Response("Bad Request", { status: 400 });
    }
    await cachedBot.handleUpdate(update as any);
    return new Response("OK");
  },
};
