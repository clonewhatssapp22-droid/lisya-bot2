require("dotenv").config();

const fs = require("fs");
const axios = require("axios");
const mongoose = require("mongoose");
const { Telegraf, Markup } = require("telegraf");

const OWNER_ID = "6551372143";
function isAdmin(ctx) {
  return String(ctx.from.id) === OWNER_ID;
}

console.log("BOT TOKEN:", process.env.BOT_TOKEN);
const bot = new Telegraf(process.env.BOT_TOKEN);

// =========================
// MONGODB
// =========================

mongoose.connect(process.env.MONGO_URI)
.then(() => { console.log("✅ MongoDB Connected"); })
.catch((err) => { console.log(err); });

// =========================
// SCHEMA
// =========================

const userSchema = new mongoose.Schema({
  telegramId: String,
  username: String,
  status: { type: String, default: "INACTIVE" },
  premiumExpired: { type: Date, default: null },
  balance: { type: Number, default: 0 },
  banned: { type: Boolean, default: false },
  totalConvert: { type: Number, default: 0 },
  refBy: { type: String, default: null },
  referralCount: { type: Number, default: 0 },
  convertHistory: { type: Array, default: [] },
});

const User = mongoose.model("User", userSchema);

// =========================
// SESSION
// =========================
const activeProcesses = new Set();
const userSessions = {};

// =========================
// GRUP WAJIB
// =========================

const REQUIRED_CHANNELS = [
  { id: "@bussinesworkallcountries", name: "Business Work All Countries", url: "https://t.me/bussinesworkallcountries" },
  { id: "@lisyastorejaseb",          name: "Lisya Store Jasa B",          url: "https://t.me/lisyastorejaseb" },
  { id: "@freelancejobindonesian",   name: "Freelance Job Indonesian",    url: "https://t.me/freelancejobindonesian" },
  { id: "@Lokermedaninfoo",          name: "Loker Medan Info",            url: "https://t.me/Lokermedaninfoo" },
];

async function checkJoinChannels(userId) {
  const notJoined = [];
  for (const ch of REQUIRED_CHANNELS) {
    try {
      const member = await bot.telegram.getChatMember(ch.id, userId);
      if (["left", "kicked"].includes(member.status)) {
        notJoined.push(ch);
      }
    } catch (e) {
      // Kalau bot bukan admin grup, anggap sudah join
      console.log(`Cannot check ${ch.id}:`, e.message);
    }
  }
  return notJoined;
}

function joinMessage(notJoined) {
  let msg = "⚠️ Kamu belum join grup/channel wajib!\n\nSilakan join dulu:\n\n";
  notJoined.forEach((ch, i) => {
    msg += `${i + 1}. <a href="${ch.url}">${ch.name}</a>\n`;
  });
  msg += "\nSetelah join, klik /start lagi.";
  return msg;
}

// =========================
// HELPER
// =========================

function cleanNumber(text) {
  if (!text) return "";
  return String(text).replace(/\D/g, "");
}

async function getFileContent(fileId) {
  const file = await bot.telegram.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
  const response = await axios.get(fileUrl);
  return response.data;
}

async function getBuffer(fileId) {
  const file = await bot.telegram.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
  const response = await axios.get(fileUrl, { responseType: "arraybuffer" });
  return response.data;
}

async function checkPremium(ctx) {
  const user = await User.findOne({ telegramId: String(ctx.from.id) });
  if (!user) return false;
  if (user.premiumExpired && new Date() > user.premiumExpired) {
    user.status = "INACTIVE";
    user.premiumExpired = null;
    await user.save();
  }
  return user.status === "ACTIVE";
}

function isProcessing(userId) { return activeProcesses.has(userId); }
function startProcess(userId) { activeProcesses.add(userId); }
function endProcess(userId) { activeProcesses.delete(userId); }

// =========================
// EXPIRED CHECKER
// =========================

async function checkExpiredUsers() {
  const now = new Date();
  const expiredUsers = await User.find({ premiumExpired: { $lte: now }, status: "ACTIVE" });
  for (const user of expiredUsers) {
    user.status = "INACTIVE";
    user.premiumExpired = null;
    await user.save();
    try {
      await bot.telegram.sendMessage(user.telegramId, "❌ Premium kamu telah expired\n\nSilakan renew membership.");
    } catch (err) { console.log(err); }
  }
}

setInterval(checkExpiredUsers, 1000 * 60 * 60);

// =========================
// KEYBOARD
// =========================

function adminKeyboard() {
  return Markup.keyboard([
    ["👥 Cek User Aktif"],
    ["✅ Aktifkan User", "❌ Putuskan User"],
    ["🔍 Cek User", "📢 Broadcast"],
    ["🏠 Menu Utama"],
  ]).resize();
}

function mainKeyboard() {
  return Markup.keyboard([
    ["📄 TXT → VCF", "♻️ VCF → TXT"],
    ["📊 XLS → TXT", "📁 CSV → TXT"],
    ["💬 MSG → VCF"],
    ["📎 Gabung TXT", "📇 Gabung VCF"],
    ["✂️ Bagi TXT", "🧩 Bagi VCF"],
    ["👤 Profile", "💎 Status"],
    ["💰 Deposit", "🛒 Buy Premium"],
  ]).resize();
}

function adminMainKeyboard() {
  return Markup.keyboard([
    ["📄 TXT → VCF", "♻️ VCF → TXT"],
    ["📊 XLS → TXT", "📁 CSV → TXT"],
    ["💬 MSG → VCF"],
    ["📎 Gabung TXT", "📇 Gabung VCF"],
    ["✂️ Bagi TXT", "🧩 Bagi VCF"],
    ["👤 Profile", "💎 Status"],
    ["💰 Deposit", "🛒 Buy Premium"],
    ["👑 Menu Admin"],
  ]).resize();
}

// =========================
// START
// =========================

bot.start(async (ctx) => {

  // Buat atau update user
  let user = await User.findOne({ telegramId: String(ctx.from.id) });
  if (!user) {
    user = await User.create({
      telegramId: String(ctx.from.id),
      username: ctx.from.username || "no_username",
    });
  } else {
    user.username = ctx.from.username || user.username;
    await user.save();
  }

  if (user.banned) {
    return ctx.reply("🚫 Kamu telah dibanned dari bot ini.");
  }

  // Skip cek join untuk admin
  if (!isAdmin(ctx)) {
    const notJoined = await checkJoinChannels(ctx.from.id);
    if (notJoined.length > 0) {
      return ctx.reply(joinMessage(notJoined), {
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🔄 Saya Sudah Join", "check_join")],
        ]),
      });
    }
  }

  if (isAdmin(ctx)) {
    return ctx.reply("👑 Welcome Admin LISYA BOT\n\nPilih menu:", adminKeyboard());
  }

  ctx.reply(
    "💎 Welcome to LISYA BOT\n\nPremium Converter Tools\nFast • Secure • Premium\n\n✅ TXT → VCF\n✅ VCF → TXT\n✅ XLS → TXT\n✅ CSV → TXT\n✅ MSG → VCF\n✅ Merge & Split Files\n\n🔥 Upgrade premium untuk unlock semua fitur.\n\n📢 Jangan lupa join group official:\nhttps://t.me/+RnXaaNZLYG5lN2Vl",
    mainKeyboard()
  );
});

// =========================
// CALLBACK - CEK JOIN
// =========================

bot.action("check_join", async (ctx) => {
  await ctx.answerCbQuery();

  const notJoined = await checkJoinChannels(ctx.from.id);

  if (notJoined.length > 0) {
    return ctx.editMessageText(joinMessage(notJoined), {
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🔄 Cek Lagi", "check_join")],
      ]),
    });
  }

  await ctx.deleteMessage();

  const user = await User.findOne({ telegramId: String(ctx.from.id) });

  ctx.reply(
    "✅ Terima kasih sudah join!\n\n💎 Welcome to LISYA BOT\n\nPremium Converter Tools\nFast • Secure • Premium",
    mainKeyboard()
  );
});

// =========================
// ADMIN - CEK USER AKTIF
// =========================

bot.hears("👥 Cek User Aktif", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("❌ Khusus owner");

  const users = await User.find({ status: "ACTIVE" });

  if (users.length === 0) {
    return ctx.reply("📭 Tidak ada user aktif saat ini.", adminKeyboard());
  }

  let msg = "👥 DAFTAR USER AKTIF\n\n";
  users.forEach((u, i) => {
    const exp = u.premiumExpired
      ? new Date(u.premiumExpired).toLocaleString("id-ID")
      : "-";
    msg += `${i + 1}. @${u.username || "no_username"}\n`;
    msg += `   🆔 ${u.telegramId}\n`;
    msg += `   ⏳ ${exp}\n\n`;
  });
  msg += `Total: ${users.length} user aktif`;

  ctx.reply(msg, adminKeyboard());
});

// =========================
// ADMIN - AKTIFKAN USER
// =========================

bot.hears("✅ Aktifkan User", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("❌ Khusus owner");

  const users = await User.find({ status: "INACTIVE", banned: false });

  if (users.length === 0) {
    return ctx.reply("📭 Tidak ada user inactive.", adminKeyboard());
  }

  const buttons = users.map((u) => [
    Markup.button.callback(
      `${u.username || "no_username"} (${u.telegramId})`,
      `aktif_${u.telegramId}`
    ),
  ]);

  ctx.reply("Pilih user yang ingin diaktifkan 30 hari:",
    Markup.inlineKeyboard(buttons)
  );
});

// =========================
// ADMIN - PUTUSKAN USER
// =========================

bot.hears("❌ Putuskan User", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("❌ Khusus owner");

  const users = await User.find({ status: "ACTIVE" });

  if (users.length === 0) {
    return ctx.reply("📭 Tidak ada user aktif.", adminKeyboard());
  }

  const buttons = users.map((u) => [
    Markup.button.callback(
      `${u.username || "no_username"} (${u.telegramId})`,
      `putus_${u.telegramId}`
    ),
  ]);

  ctx.reply("Pilih user yang ingin dinonaktifkan:",
    Markup.inlineKeyboard(buttons)
  );
});

// =========================
// ADMIN - CEK USER
// =========================

bot.hears("🔍 Cek User", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("❌ Khusus owner");

  const users = await User.find({});

  if (users.length === 0) {
    return ctx.reply("📭 Belum ada user.", adminKeyboard());
  }

  const buttons = users.map((u) => [
    Markup.button.callback(
      `${u.status === "ACTIVE" ? "✅" : "❌"} ${u.username || "no_username"} (${u.telegramId})`,
      `cek_${u.telegramId}`
    ),
  ]);

  ctx.reply("Pilih user yang ingin dicek:",
    Markup.inlineKeyboard(buttons)
  );
});

// =========================
// ADMIN - BROADCAST
// =========================

bot.hears("📢 Broadcast", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("❌ Khusus owner");

  userSessions[ctx.from.id] = { step: "BROADCAST_WAIT" };

  ctx.reply(
    "📢 BROADCAST\n\nKirim pesan yang ingin di-broadcast:\n• Teks biasa\n• Foto + caption\n• Video + caption\n\nPesan akan dikirim ke semua user terdaftar.",
    Markup.inlineKeyboard([
      [Markup.button.callback("❌ Batal", "broadcast_cancel")],
    ])
  );
});

bot.action("broadcast_cancel", async (ctx) => {
  delete userSessions[ctx.from.id];
  await ctx.answerCbQuery("Dibatalkan");
  ctx.reply("❌ Broadcast dibatalkan.", adminKeyboard());
});

// =========================
// ADMIN - MENU UTAMA
// =========================

bot.hears("🏠 Menu Utama", async (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.reply("💎 Menu Utama", adminMainKeyboard());
});

bot.hears("👑 Menu Admin", async (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.reply("👑 Menu Admin", adminKeyboard());
});

// =========================
// CALLBACK - AKTIFKAN
// =========================

bot.action(/^aktif_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("❌ Khusus owner");

  const userId = ctx.match[1];
  const user = await User.findOne({ telegramId: String(userId) });
  if (!user) return ctx.answerCbQuery("❌ User tidak ditemukan");

  const expired = new Date();
  expired.setDate(expired.getDate() + 30);
  user.status = "ACTIVE";
  user.premiumExpired = expired;
  await user.save();

  try {
    await bot.telegram.sendMessage(userId,
      `✅ Premium kamu telah diaktifkan oleh admin!\n\n💎 Durasi : 30 Hari\n⏳ Expired : ${expired.toLocaleString("id-ID")}`
    );
  } catch (e) { console.log(e); }

  await ctx.editMessageText(
    `✅ Berhasil diaktifkan!\n\n🆔 User : ${userId}\n💎 Status : ACTIVE\n⏳ Expired : ${expired.toLocaleString("id-ID")}`
  );
  ctx.answerCbQuery("✅ User diaktifkan!");
});

// =========================
// CALLBACK - PUTUSKAN
// =========================

bot.action(/^putus_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("❌ Khusus owner");

  const userId = ctx.match[1];
  const user = await User.findOne({ telegramId: String(userId) });
  if (!user) return ctx.answerCbQuery("❌ User tidak ditemukan");

  user.status = "INACTIVE";
  user.premiumExpired = null;
  await user.save();

  try {
    await bot.telegram.sendMessage(userId, "❌ Premium kamu telah dinonaktifkan oleh admin.");
  } catch (e) { console.log(e); }

  await ctx.editMessageText(
    `✅ Berhasil dinonaktifkan!\n\n🆔 User : ${userId}\n💎 Status : INACTIVE`
  );
  ctx.answerCbQuery("✅ User dinonaktifkan!");
});

// =========================
// CALLBACK - CEK USER
// =========================

bot.action(/^cek_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("❌ Khusus owner");

  const userId = ctx.match[1];
  const user = await User.findOne({ telegramId: String(userId) });
  if (!user) return ctx.answerCbQuery("❌ User tidak ditemukan");

  let expired = "Tidak aktif";
  if (user.premiumExpired) {
    expired = new Date(user.premiumExpired).toLocaleString("id-ID");
  }

  await ctx.answerCbQuery();
  ctx.reply(`
👤 INFO USER

🆔 ID : ${user.telegramId}
📛 Username : @${user.username || "Tidak ada"}
💎 Status : ${user.status}
⏳ Expired : ${expired}
💰 Saldo : Rp${user.balance}
🔄 Total Convert : ${user.totalConvert}
🚫 Banned : ${user.banned ? "Ya" : "Tidak"}
`);
});

// =========================
// PROFILE
// =========================

bot.hears("👤 Profile", async (ctx) => {
  const user = await User.findOne({ telegramId: String(ctx.from.id) });
  if (!user) return ctx.reply("❌ User tidak ditemukan");
  ctx.reply(`
👤 USER PROFILE

🆔 ID : ${ctx.from.id}
📛 Username : @${ctx.from.username || "Tidak ada"}
💎 Status : ${user.status}
💰 Saldo : Rp${user.balance}
`);
});

// =========================
// STATUS
// =========================

bot.hears("💎 Status", async (ctx) => {
  const user = await User.findOne({ telegramId: String(ctx.from.id) });
  if (!user) return ctx.reply("❌ User tidak ditemukan");
  let expired = "Tidak aktif";
  if (user.premiumExpired) {
    expired = new Date(user.premiumExpired).toLocaleString("id-ID");
  }
  ctx.reply(`
💎 STATUS MEMBERSHIP

👤 Username : @${ctx.from.username || "Tidak ada"}
💎 Status : ${user.status}
⏳ Expired : ${expired}
`);
});

// =========================
// DEPOSIT
// =========================

bot.hears("💰 Deposit", async (ctx) => {
  ctx.reply(`
💰 DEPOSIT SALDO

🏦 SeaBank
👤 NURASIAH
🔢 901954431148

Minimal deposit Rp30.000
`);
});

// =========================
// BUY PREMIUM
// =========================

bot.hears("🛒 Buy Premium", async (ctx) => {
  const PRICE = 30000;
  const user = await User.findOne({ telegramId: String(ctx.from.id) });
  if (!user) return ctx.reply("❌ User tidak ditemukan");
  if (user.balance < PRICE) {
    return ctx.reply("❌ Saldo tidak cukup\n\nHarga premium:\nRp30.000 / 30 Hari");
  }
  user.balance -= PRICE;
  user.status = "ACTIVE";
  const expired = new Date();
  expired.setDate(expired.getDate() + 30);
  user.premiumExpired = expired;
  await user.save();
  ctx.reply(`✅ Premium berhasil aktif\n\n💎 Durasi : 30 Hari\n💰 Sisa saldo : Rp${user.balance}`);
});

// =========================
// SLASH ADMIN (backup)
// =========================

bot.command("aktifkanuser", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("❌ Khusus owner");
  const userId = ctx.message.text.split(" ")[1];
  if (!userId) return ctx.reply("Format: /aktifkanuser userid");
  const user = await User.findOne({ telegramId: String(userId) });
  if (!user) return ctx.reply("❌ User tidak ditemukan");
  const expired = new Date();
  expired.setDate(expired.getDate() + 30);
  user.status = "ACTIVE";
  user.premiumExpired = expired;
  await user.save();
  try { await bot.telegram.sendMessage(userId, `✅ Premium diaktifkan admin!\n💎 30 Hari\n⏳ ${expired.toLocaleString("id-ID")}`); } catch(e){}
  ctx.reply(`✅ User ${userId} diaktifkan\n⏳ ${expired.toLocaleString("id-ID")}`);
});

bot.command("putuskanuser", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("❌ Khusus owner");
  const userId = ctx.message.text.split(" ")[1];
  if (!userId) return ctx.reply("Format: /putuskanuser userid");
  const user = await User.findOne({ telegramId: String(userId) });
  if (!user) return ctx.reply("❌ User tidak ditemukan");
  user.status = "INACTIVE";
  user.premiumExpired = null;
  await user.save();
  try { await bot.telegram.sendMessage(userId, "❌ Premium dinonaktifkan admin."); } catch(e){}
  ctx.reply(`✅ User ${userId} dinonaktifkan`);
});

bot.command("cekuser", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("❌ Khusus owner");
  const userId = ctx.message.text.split(" ")[1];
  if (!userId) return ctx.reply("Format: /cekuser userid");
  const user = await User.findOne({ telegramId: String(userId) });
  if (!user) return ctx.reply("❌ User tidak ditemukan");
  let expired = "Tidak aktif";
  if (user.premiumExpired) expired = new Date(user.premiumExpired).toLocaleString("id-ID");
  ctx.reply(`👤 INFO USER\n\n🆔 ${user.telegramId}\n📛 @${user.username}\n💎 ${user.status}\n⏳ ${expired}\n💰 Rp${user.balance}`);
});

bot.command("cekuseraktif", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("❌ Khusus owner");
  const users = await User.find({ status: "ACTIVE" });
  if (users.length === 0) return ctx.reply("📭 Tidak ada user aktif.");
  let msg = "👥 USER AKTIF\n\n";
  users.forEach((u, i) => {
    const exp = u.premiumExpired ? new Date(u.premiumExpired).toLocaleString("id-ID") : "-";
    msg += `${i+1}. @${u.username || "no_username"} | ${u.telegramId}\n⏳ ${exp}\n\n`;
  });
  ctx.reply(msg);
});

bot.command("addsaldo", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("❌ Khusus owner");
  const args = ctx.message.text.split(" ");
  const userId = args[1];
  const amount = Number(args[2]);
  if (!userId || !amount) return ctx.reply("Format: /addsaldo userid jumlah");
  const user = await User.findOne({ telegramId: String(userId) });
  if (!user) return ctx.reply("❌ User tidak ditemukan");
  user.balance += amount;
  await user.save();
  ctx.reply(`✅ Saldo ditambah\n\n👤 ${userId}\n💰 Rp${user.balance}`);
});

bot.command("premium", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("❌ Khusus owner");
  const userId = ctx.message.text.split(" ")[1];
  if (!userId) return ctx.reply("Format: /premium userid");
  const expired = new Date();
  expired.setDate(expired.getDate() + 30);
  await User.findOneAndUpdate({ telegramId: String(userId) }, { status: "ACTIVE", premiumExpired: expired });
  ctx.reply(`✅ Premium aktif\n👤 ${userId}\n⏳ 30 Hari`);
});

// =========================
// TXT -> VCF
// =========================

bot.hears("📄 TXT → VCF", async (ctx) => {
  if (isProcessing(ctx.from.id)) return ctx.reply("⏳ Masih ada proses berjalan. Tunggu sampai selesai.");
  startProcess(ctx.from.id);
  if (!(await checkPremium(ctx))) {
    endProcess(ctx.from.id);
    return ctx.reply("❌ Premium only");
  }
  userSessions[ctx.from.id] = { step: "TXT_UPLOAD" };
  ctx.reply("📄 Upload file TXT");
});

// =========================
// VCF -> TXT
// =========================

bot.hears("♻️ VCF → TXT", async (ctx) => {
  if (isProcessing(ctx.from.id)) return ctx.reply("⏳ Masih ada proses berjalan. Tunggu sampai selesai.");
  startProcess(ctx.from.id);
  if (!(await checkPremium(ctx))) {
    endProcess(ctx.from.id);
    return ctx.reply("❌ Premium only");
  }
  userSessions[ctx.from.id] = { step: "VCF_UPLOAD" };
  ctx.reply("♻️ Upload file VCF");
});

// =========================
// MSG -> VCF
// =========================

bot.hears("💬 MSG → VCF", async (ctx) => {
  if (!(await checkPremium(ctx))) return ctx.reply("❌ Premium only");
  userSessions[ctx.from.id] = { step: "MSG_FILENAME" };
  ctx.reply("📁 Masukkan nama file");
});

// =========================
// DOCUMENT
// =========================

bot.on("document", async (ctx) => {
  try {
    const session = userSessions[ctx.from.id];
    if (!session) return;
    const fileId = ctx.message.document.file_id;

    if (session.step === "TXT_UPLOAD") {
      session.fileId = fileId;
      session.step = "TXT_FILENAME";
      return ctx.reply("📁 Masukkan nama file");
    }

    if (session.step === "VCF_UPLOAD") {
      const content = await getFileContent(fileId);
      const regex = /TEL[^:]*:(.+)/g;
      let numbers = [];
      let match;
      while ((match = regex.exec(content)) !== null) {
        numbers.push(cleanNumber(match[1]));
      }
      fs.writeFileSync("contacts.txt", numbers.join("\n"));
      await ctx.replyWithDocument({ source: "contacts.txt" });
      const currentUser = await User.findOne({ telegramId: String(ctx.from.id) });
      if (currentUser) {
        currentUser.totalConvert += 1;
        currentUser.convertHistory.push({ type: "VCF → TXT", date: new Date() });
        await currentUser.save();
      }
      fs.unlinkSync("contacts.txt");
      delete userSessions[ctx.from.id];
      endProcess(ctx.from.id);
      return ctx.reply("✅ VCF → TXT berhasil");
    }

  } catch (err) {
    console.log(err);
    endProcess(ctx.from.id);
    return ctx.reply("❌ Error");
  }
});

// =========================
// PHOTO (broadcast & convert)
// =========================

bot.on("photo", async (ctx) => {
  try {
    const session = userSessions[ctx.from.id];
    if (!session) return;

    // BROADCAST FOTO
    if (session.step === "BROADCAST_WAIT") {
      if (!isAdmin(ctx)) return;

      delete userSessions[ctx.from.id];

      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const caption = ctx.message.caption || "";
      const allUsers = await User.find({});

      let sukses = 0;
      let gagal = 0;

      const statusMsg = await ctx.reply(`📢 Broadcast dimulai...\nTotal: ${allUsers.length} user`);

      for (const u of allUsers) {
        try {
          await bot.telegram.sendPhoto(u.telegramId, photo.file_id, { caption });
          sukses++;
        } catch (e) {
          gagal++;
        }
        // Delay agar tidak kena flood limit
        await new Promise(r => setTimeout(r, 50));
      }

      ctx.reply(`✅ Broadcast selesai!\n\n✅ Terkirim : ${sukses}\n❌ Gagal : ${gagal}`, adminKeyboard());
    }

  } catch (err) {
    console.log(err);
    return ctx.reply("❌ Error broadcast");
  }
});

// =========================
// VIDEO (broadcast)
// =========================

bot.on("video", async (ctx) => {
  try {
    const session = userSessions[ctx.from.id];
    if (!session) return;

    if (session.step === "BROADCAST_WAIT") {
      if (!isAdmin(ctx)) return;

      delete userSessions[ctx.from.id];

      const video = ctx.message.video;
      const caption = ctx.message.caption || "";
      const allUsers = await User.find({});

      let sukses = 0;
      let gagal = 0;

      await ctx.reply(`📢 Broadcast dimulai...\nTotal: ${allUsers.length} user`);

      for (const u of allUsers) {
        try {
          await bot.telegram.sendVideo(u.telegramId, video.file_id, { caption });
          sukses++;
        } catch (e) {
          gagal++;
        }
        await new Promise(r => setTimeout(r, 50));
      }

      ctx.reply(`✅ Broadcast selesai!\n\n✅ Terkirim : ${sukses}\n❌ Gagal : ${gagal}`, adminKeyboard());
    }

  } catch (err) {
    console.log(err);
    return ctx.reply("❌ Error broadcast");
  }
});

// =========================
// TEXT
// =========================

bot.on("text", async (ctx) => {
  try {
    const session = userSessions[ctx.from.id];
    if (!session) return;

    // BROADCAST TEKS
    if (session.step === "BROADCAST_WAIT") {
      if (!isAdmin(ctx)) return;

      delete userSessions[ctx.from.id];

      const text = ctx.message.text;
      const allUsers = await User.find({});

      let sukses = 0;
      let gagal = 0;

      await ctx.reply(`📢 Broadcast dimulai...\nTotal: ${allUsers.length} user`);

      for (const u of allUsers) {
        try {
          await bot.telegram.sendMessage(u.telegramId, text);
          sukses++;
        } catch (e) {
          gagal++;
        }
        await new Promise(r => setTimeout(r, 50));
      }

      ctx.reply(`✅ Broadcast selesai!\n\n✅ Terkirim : ${sukses}\n❌ Gagal : ${gagal}`, adminKeyboard());
      return;
    }

    // TXT FILENAME
    if (session.step === "TXT_FILENAME") {
      session.output = ctx.message.text;
      session.step = "TXT_CONTACT";
      return ctx.reply("📛 Masukkan nama kontak");
    }

    if (session.step === "TXT_CONTACT") {
      session.contact = ctx.message.text;
      session.step = "TXT_START";
      return ctx.reply("🔢 Masukkan nomor awal");
    }

    if (session.step === "TXT_START") {
      const start = parseInt(ctx.message.text);
      const content = await getFileContent(session.fileId);
      const numbers = content.split(/\r?\n/).map(v => cleanNumber(v)).filter(v => v);
      let vcf = "";
      numbers.forEach((num, i) => {
        vcf += `BEGIN:VCARD\nVERSION:3.0\nFN:${session.contact} ${start + i}\nTEL;TYPE=CELL:${num}\nEND:VCARD\n`;
      });
      const finalFile = `${session.output}.vcf`;
      fs.writeFileSync(finalFile, vcf);
      await ctx.replyWithDocument({ source: finalFile });
      const currentUser = await User.findOne({ telegramId: String(ctx.from.id) });
      if (currentUser) {
        currentUser.totalConvert += 1;
        currentUser.convertHistory.push({ type: "TXT → VCF", date: new Date() });
        await currentUser.save();
      }
      fs.unlinkSync(finalFile);
      delete userSessions[ctx.from.id];
      endProcess(ctx.from.id);
      return ctx.reply("✅ TXT → VCF berhasil");
    }

    if (session.step === "MSG_FILENAME") {
      session.output = ctx.message.text;
      session.step = "MSG_CONTACT";
      return ctx.reply("📛 Masukkan nama kontak");
    }

    if (session.step === "MSG_CONTACT") {
      session.contact = ctx.message.text;
      session.step = "MSG_START";
      return ctx.reply("🔢 Masukkan nomor awal");
    }

    if (session.step === "MSG_START") {
      session.start = parseInt(ctx.message.text);
      session.step = "MSG_NUMBERS";
      return ctx.reply("💬 Kirim nomor\n\nContoh:\n08123\n08124\n08125");
    }

    if (session.step === "MSG_NUMBERS") {
      const numbers = ctx.message.text.split(/\r?\n/).map(v => cleanNumber(v)).filter(v => v);
      let vcf = "";
      numbers.forEach((num, i) => {
        vcf += `BEGIN:VCARD\nVERSION:3.0\nFN:${session.contact} ${session.start + i}\nTEL;TYPE=CELL:${num}\nEND:VCARD\n`;
      });
      const finalFile = `${session.output}.vcf`;
      fs.writeFileSync(finalFile, vcf);
      await ctx.replyWithDocument({ source: finalFile });
      const currentUser = await User.findOne({ telegramId: String(ctx.from.id) });
      if (currentUser) {
        currentUser.totalConvert += 1;
        currentUser.convertHistory.push({ type: "MSG → VCF", date: new Date() });
        await currentUser.save();
      }
      fs.unlinkSync(finalFile);
      delete userSessions[ctx.from.id];
      endProcess(ctx.from.id);
      return ctx.reply("✅ MSG → VCF berhasil");
    }

  } catch (err) {
    console.log(err);
    endProcess(ctx.from.id);
    return ctx.reply("❌ Error");
  }
});

// =========================
// ERROR
// =========================

bot.catch((err) => { console.log("BOT ERROR:", err); });
process.on("unhandledRejection", (err) => { console.log(err); });
process.on("uncaughtException", (err) => { console.log(err); });

// =========================
// LAUNCH
// =========================

bot.launch()
.then(() => { console.log("🚀 BOT SUCCESS ONLINE"); })
.catch((err) => { console.log("❌ BOT LAUNCH ERROR:", err); });