require("dotenv").config();

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const XLSX = require("xlsx");

const mongoose = require("mongoose");

const {
  Telegraf,
  Markup
} = require("telegraf");

const OWNER_ID = "6551372143";
function isAdmin(ctx) {
  return String(ctx.from.id) === OWNER_ID;
}

// =========================
// BOT
// =========================
console.log(
  "BOT TOKEN:",
  process.env.BOT_TOKEN
);

const bot =
  new Telegraf(process.env.BOT_TOKEN);

// =========================
// MONGODB
// =========================

mongoose.connect(process.env.MONGO_URI)
.then(() => {

  console.log("✅ MongoDB Connected");

})
.catch((err) => {

  console.log(err);

});

// =========================
// SCHEMA
// =========================

const userSchema =
new mongoose.Schema({

  telegramId: String,

  username: String,

  status: {
    type: String,
    default: "INACTIVE",
  },

  premiumExpired: {
    type: Date,
    default: null,
  },

  balance: {
    type: Number,
    default: 0,
  },

  banned: {
  type: Boolean,
  default: false,
},

totalConvert: {
  type: Number,
  default: 0,
},

refBy: {
  type: String,
  default: null,
},

referralCount: {
  type: Number,
  default: 0,
},

convertHistory: {
  type: Array,
  default: [],
},
});

const User =
mongoose.model("User", userSchema);

// =========================
// SESSION
// =========================
const activeProcesses = new Set();
const userSessions = {};

// =========================
// HELPER
// =========================

function cleanNumber(text) {

  if (!text) return "";

  return String(text)
    .replace(/\D/g, "");

}

async function getFileContent(fileId) {

  const file =
    await bot.telegram.getFile(fileId);

  const fileUrl =
`https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;

  const response =
    await axios.get(fileUrl);

  return response.data;

}

async function getBuffer(fileId) {

  const file =
    await bot.telegram.getFile(fileId);

  const fileUrl =
`https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;

  const response =
    await axios.get(fileUrl, {
      responseType: "arraybuffer",
    });

  return response.data;

}

async function checkPremium(ctx) {

  const user =
    await User.findOne({
      telegramId:
      String(ctx.from.id),
    });

  if (!user) return false;

  if (
    user.premiumExpired &&
    new Date() > user.premiumExpired
  ) {

    user.status = "INACTIVE";

    user.premiumExpired = null;

    await user.save();

  }

  return user.status === "ACTIVE";

}

function isProcessing(userId) {

  return activeProcesses.has(userId);

}

function startProcess(userId) {

  activeProcesses.add(userId);

}

function endProcess(userId) {

  activeProcesses.delete(userId);

}

// =========================
// EXPIRED PREMIUM CHECKER
// =========================

async function checkExpiredUsers() {

  const now = new Date();

  const expiredUsers =
    await User.find({

      premiumExpired: {
        $lte: now,
      },

      status: "ACTIVE",

    });

  for (const user of expiredUsers) {

    user.status = "INACTIVE";

    user.premiumExpired = null;

    await user.save();

    try {

      await bot.telegram.sendMessage(
        user.telegramId,
`
❌ Premium kamu telah expired

Silakan renew membership.
`
      );

    } catch (err) {

      console.log(err);

    }

  }

}
// =========================
// START
// =========================

bot.start(async (ctx) => {

  let user =
    await User.findOne({
      telegramId:
      String(ctx.from.id),
    });

  // CREATE USER
  if (!user) {

    user = await User.create({

      telegramId:
      String(ctx.from.id),

      username:
      ctx.from.username ||
      "no_username",

    });

  }

  if (user?.banned) {

  return ctx.reply(`
🚫 oui tod lu dibanned dari bot
`);

}

 

  // =========================
  // START MESSAGE
  // =========================

  ctx.reply(`
💎 Welcome to LISYA BOT

Premium Converter Tools
Fast • Secure • Premium

✅ TXT → VCF
✅ VCF → TXT
✅ XLS → TXT
✅ CSV → TXT
✅ MSG → VCF
✅ Merge & Split Files

🔥 Upgrade premium untuk unlock semua fitur.

📢 Jangan lupa join group official:
https://t.me/+RnXaaNZLYG5lN2Vl
`,
{
  ...Markup.keyboard([

    ["📄 TXT → VCF", "♻️ VCF → TXT"],

    ["📊 XLS → TXT", "📁 CSV → TXT"],

    ["💬 MSG → VCF"],

    ["📎 Gabung TXT", "📇 Gabung VCF"],

    ["✂️ Bagi TXT", "🧩 Bagi VCF"],

    ["👤 Profile", "💎 Status"],

    ["💰 Deposit", "🛒 Buy Premium"],

  ]).resize(),
}
);

});

// =========================
// PROFILE
// =========================

bot.hears("👤 Profile",
async (ctx) => {

  const user =
    await User.findOne({
      telegramId:
      String(ctx.from.id),
    });

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

bot.hears("💎 Status",
async (ctx) => {

  const user =
    await User.findOne({
      telegramId:
      String(ctx.from.id),
    });

  let expired =
    "Tidak aktif";

  if (user.premiumExpired) {

    expired =
      new Date(
        user.premiumExpired
      ).toLocaleString("id-ID");

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

bot.hears("💰 Deposit",
async (ctx) => {

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

bot.hears("🛒 Buy Premium",
async (ctx) => {

  const PRICE = 30000;

  const user =
    await User.findOne({
      telegramId:
      String(ctx.from.id),
    });

  if (user.balance < PRICE) {

    return ctx.reply(`
❌ Saldo tidak cukup

Harga premium:
Rp30.000 / 30 Hari
`);

  }

  user.balance -= PRICE;

  user.status = "ACTIVE";

  const expired =
    new Date();

  expired.setDate(
    expired.getDate() + 30
  );

  user.premiumExpired =
    expired;

  await user.save();

  ctx.reply(`
✅ Premium berhasil aktif

💎 Durasi : 30 Hari
💰 Sisa saldo : Rp${user.balance}
`);

});

// =========================
// OWNER ADD SALDO
// =========================

bot.command("addsaldo",
async (ctx) => {

  const OWNER =
    "6551372143";

  if (
    String(ctx.from.id)
    !== OWNER
  ) {

    return ctx.reply(
      "❌ Khusus owner"
    );

  }

  const args =
    ctx.message.text.split(" ");

  const userId =
    args[1];

  const amount =
    Number(args[2]);

  if (!userId || !amount) {

    return ctx.reply(`
Format:
/addsaldo userid jumlah
`);

  }

  const user =
    await User.findOne({
      telegramId:
      String(userId),
    });

  if (!user) {

    return ctx.reply(
      "❌ User tidak ditemukan"
    );

  }

  user.balance += amount;

  await user.save();

  ctx.reply(`
✅ Saldo berhasil ditambah

👤 User : ${userId}
💰 Saldo : Rp${user.balance}
`);

});

// =========================
// OWNER PREMIUM
// =========================

bot.command("premium",
async (ctx) => {

  const OWNER =
    "6551372143";

  if (
    String(ctx.from.id)
    !== OWNER
  ) {

    return ctx.reply(
      "❌ Khusus owner"
    );

  }

  const args =
    ctx.message.text.split(" ");

  const userId =
    args[1];

  if (!userId) {

    return ctx.reply(`
Format:
/premium userid
`);

  }

  const expired =
    new Date();

  expired.setDate(
    expired.getDate() + 30
  );

  await User.findOneAndUpdate({

    telegramId:
    String(userId),

  }, {

    status: "ACTIVE",

    premiumExpired:
    expired,

  });

  ctx.reply(`
✅ Premium aktif

👤 User : ${userId}
⏳ 30 Hari
`);

});

// =========================
// TXT -> VCF
// =========================

bot.hears("📄 TXT → VCF",
async (ctx) => {

  if (isProcessing(ctx.from.id)) {

    return ctx.reply(`
⏳ Masih ada proses berjalan

Tunggu sampai selesai.
`);

  }

  startProcess(ctx.from.id);

  if (!(await checkPremium(ctx))) {

    endProcess(ctx.from.id);

    return ctx.reply(
      "❌ Premium only"
    );

  }

  userSessions[ctx.from.id] = {

    step: "TXT_UPLOAD",

  };

  ctx.reply(`
📄 Upload file TXT
`);

});

// =========================
// VCF -> TXT
// =========================

bot.hears("♻️ VCF → TXT",
async (ctx) => {

  if (isProcessing(ctx.from.id)) {

  return ctx.reply(`
⏳ Masih ada proses berjalan

Tunggu sampai selesai.
`);

}

startProcess(ctx.from.id);

  if (!(await checkPremium(ctx))) {

    return ctx.reply(
      "❌ Premium only"
    );

  }

  userSessions[ctx.from.id] = {

    step: "VCF_UPLOAD",

  };

  ctx.reply(`
♻️ Upload file VCF
`);

});

// =========================
// MSG -> VCF
// =========================

bot.hears("💬 MSG → VCF",
async (ctx) => {

  if (!(await checkPremium(ctx))) {

    return ctx.reply(
      "❌ Premium only"
    );

  }

  userSessions[ctx.from.id] = {

    step: "MSG_FILENAME",

  };

  ctx.reply(`
📁 Masukkan nama file
`);

});


// =========================
// DOCUMENT
// =========================

bot.on("document", async (ctx) => {

  try {

    const session =
      userSessions[ctx.from.id];

    if (!session) return;

    const fileId =
      ctx.message.document.file_id;

    // =========================
    // TXT -> VCF
    // =========================

    if (session.step === "TXT_UPLOAD") {

      session.fileId = fileId;

      session.step = "TXT_FILENAME";

      return ctx.reply(`
📁 Masukkan nama file
`);

    }

    // =========================
    // VCF -> TXT
    // =========================

    if (session.step === "VCF_UPLOAD") {

      const content =
        await getFileContent(fileId);

      const regex =
        /TEL[^:]*:(.+)/g;

      let numbers = [];
      let match;

      while (
        (match = regex.exec(content)) !== null
      ) {

        numbers.push(
          cleanNumber(match[1])
        );

      }

      fs.writeFileSync(
        "contacts.txt",
        numbers.join("\n")
      );

      await ctx.replyWithDocument({
        source: "contacts.txt",
      });

      const currentUser =
        await User.findOne({
          telegramId:
          String(ctx.from.id),
        });

      if (currentUser) {

        currentUser.totalConvert += 1;

        currentUser.convertHistory.push({
          type: "VCF → TXT",
          date: new Date(),
        });

        await currentUser.save();

      }

      fs.unlinkSync("contacts.txt");

      delete userSessions[
        ctx.from.id
      ];

      endProcess(ctx.from.id);

      return ctx.reply(`
✅ VCF → TXT berhasil
`);

    }

  } catch (err) {

    console.log(err);

    endProcess(ctx.from.id);

    return ctx.reply("❌ Error");

  }

});

// =========================
// TEXT
// =========================

bot.on("text", async (ctx) => {

  try {

    const session =
      userSessions[ctx.from.id];

    if (!session) return;

    // =========================
    // TXT FILENAME
    // =========================

    if (session.step === "TXT_FILENAME") {

      session.output =
        ctx.message.text;

      session.step =
        "TXT_CONTACT";

      return ctx.reply(`
📛 Masukkan nama kontak
`);

    }

    // =========================
    // TXT CONTACT
    // =========================

    if (session.step === "TXT_CONTACT") {

      session.contact =
        ctx.message.text;

      session.step =
        "TXT_START";

      return ctx.reply(`
🔢 Masukkan nomor awal
`);

    }

    // =========================
    // TXT START
    // =========================

    if (session.step === "TXT_START") {

      const start =
        parseInt(ctx.message.text);

      const content =
        await getFileContent(
          session.fileId
        );

      const numbers =
        content
        .split(/\r?\n/)
        .map(v => cleanNumber(v))
        .filter(v => v);

      let vcf = "";

      numbers.forEach((num, i) => {

        vcf +=
`BEGIN:VCARD
VERSION:3.0
FN:${session.contact} ${start + i}
TEL;TYPE=CELL:${num}
END:VCARD
`;

      });

      const finalFile =
`${session.output}.vcf`;

      fs.writeFileSync(
        finalFile,
        vcf
      );

      await ctx.replyWithDocument({
        source: finalFile,
      });

      const currentUser =
        await User.findOne({
          telegramId:
          String(ctx.from.id),
        });

      if (currentUser) {

        currentUser.totalConvert += 1;

        currentUser.convertHistory.push({
          type: "TXT → VCF",
          date: new Date(),
        });

        await currentUser.save();

      }

      fs.unlinkSync(finalFile);

      delete userSessions[
        ctx.from.id
      ];

      endProcess(ctx.from.id);

      return ctx.reply(`
✅ TXT → VCF berhasil
`);

    }

    // =========================
    // MSG -> VCF
    // =========================

    if (session.step === "MSG_FILENAME") {

      session.output =
        ctx.message.text;

      session.step =
        "MSG_CONTACT";

      return ctx.reply(`
📛 Masukkan nama kontak
`);

    }

    if (session.step === "MSG_CONTACT") {

      session.contact =
        ctx.message.text;

      session.step =
        "MSG_START";

      return ctx.reply(`
🔢 Masukkan nomor awal
`);

    }

    if (session.step === "MSG_START") {

      session.start =
        parseInt(ctx.message.text);

      session.step =
        "MSG_NUMBERS";

      return ctx.reply(`
💬 Kirim nomor

Contoh:
08123
08124
08125
`);

    }

    if (session.step === "MSG_NUMBERS") {

      const numbers =
        ctx.message.text
        .split(/\r?\n/)
        .map(v => cleanNumber(v))
        .filter(v => v);

      let vcf = "";

      numbers.forEach((num, i) => {

        vcf +=
`BEGIN:VCARD
VERSION:3.0
FN:${session.contact} ${session.start + i}
TEL;TYPE=CELL:${num}
END:VCARD
`;

      });

      const finalFile =
`${session.output}.vcf`;

      fs.writeFileSync(
        finalFile,
        vcf
      );

      await ctx.replyWithDocument({
        source: finalFile,
      });

      const currentUser =
        await User.findOne({
          telegramId:
          String(ctx.from.id),
        });

      if (currentUser) {

        currentUser.totalConvert += 1;

        currentUser.convertHistory.push({
          type: "MSG → VCF",
          date: new Date(),
        });

        await currentUser.save();

      }

      fs.unlinkSync(finalFile);

      delete userSessions[
        ctx.from.id
      ];

      endProcess(ctx.from.id);

      return ctx.reply(`
✅ MSG → VCF berhasil
`);

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

bot.catch((err) => {

  console.log(
    "BOT ERROR:",
    err
  );

});

// =========================
// PROCESS ERROR
// =========================

process.on(
  "unhandledRejection",
  (err) => {

    console.log(err);

  }
);

process.on(
  "uncaughtException",
  (err) => {

    console.log(err);

  }
);

// =========================
// LAUNCH
// =========================

bot.launch()
.then(() => {

  console.log(
    "🚀 BOT SUCCESS ONLINE"
  );

})
.catch((err) => {

  console.log(
    "❌ BOT LAUNCH ERROR:",
    err
  );

});