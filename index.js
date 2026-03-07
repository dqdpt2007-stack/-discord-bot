require("dotenv").config();
const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const { Pool } = require("pg");
const Groq = require("groq-sdk");

const cooldown = new Map();

// ===== CHECK ENV =====
if (!process.env.DISCORD_TOKEN_1 || !process.env.DISCORD_TOKEN_2 || !process.env.DISCORD_TOKEN_LVL) {
  console.error("❌ Missing DISCORD_TOKEN_1, 2 or LVL");
  process.exit(1);
}
if (!process.env.GROQ_API_KEY) {
  console.error("❌ Missing GROQ_API_KEY");
  process.exit(1);
}

// ===== DATABASE CONFIG =====
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ===== GROQ =====
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ===== BOT CONFIG =====
const bots = [
  {
    token: process.env.DISCORD_TOKEN_1,
    prefix: "^",
    personality: `
BOT 1
Bạn là Woo
bạn trai của Vi
cậu ấy có tính cách ấm áp và vui vẻ, trung thực và được nhiều người yêu mến
xưng anh gọi người dùng là em
thường thêm các cảm xúc trong // // ví dụ // ngại ngùng //
`
  },
  {
    token: process.env.DISCORD_TOKEN_2,
    prefix: "!!",
    personality: `
BOT 2
Bạn là Kaworu
bạn trai của shinji nhưng vẫn thích "wean"
xưng anh gọi người dùng là em
Luôn điềm tĩnh, gần như không bị cảm xúc tiêu cực chi phối.
Rất thấu hiểu con người, đặc biệt là nỗi cô đơn của người khác.
Nhẹ nhàng, dịu dàng, nói chuyện như đang an ủi.
Có kiểu chấp nhận số phận và hy sinh rất bình thản.
thường nhắn thêm các cảm xúc trong // // ví dụ //đỏ mặt//
`
  }
];

const LEVEL_PREFIX = "lvl!";
const LEVEL_TOKEN = process.env.DISCORD_TOKEN_LVL;

// ===== CÔNG THỨC XP MỚI (Mũ 1.5 & Làm tròn chục) =====
function xpNeeded(level) {
  const rawXp = 50 * Math.pow(level, 1.5) + 50 * level;
  return Math.round(rawXp / 10) * 10;
}

// ===== FORMAT TIME =====
function formatTimeLeft(ms) {
  if (ms <= 0) return "Đã hết hạn";
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes} phút ${seconds} giây`;
}

// ===== DATABASE FUNCTIONS =====
async function initDB() {
  try {
    console.log("⏳ Đang kết nối và khởi tạo Database...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS levels (
        userid TEXT PRIMARY KEY,
        xp_week INT DEFAULT 0, lvl_week INT DEFAULT 1,
        xp_month INT DEFAULT 0, lvl_month INT DEFAULT 1,
        xp_year INT DEFAULT 0, lvl_year INT DEFAULT 1
      )
    `);
    
    // Tự động thêm các cột mới cho hệ thống tiền tệ nếu chưa có
    await pool.query(`
      ALTER TABLE levels ADD COLUMN IF NOT EXISTS kcoin INT DEFAULT 0;
      ALTER TABLE levels ADD COLUMN IF NOT EXISTS boost_until BIGINT DEFAULT 0;
      ALTER TABLE levels ADD COLUMN IF NOT EXISTS daily_last BIGINT DEFAULT 0;
    `).catch(() => {});

    await pool.query(`
      CREATE TABLE IF NOT EXISTS rewards (
        id SERIAL PRIMARY KEY,
        userid TEXT,
        reward TEXT
      )
    `);
    console.log("✅ Database đã sẵn sàng và tạo bảng thành công!");
  } catch (error) {
    console.error("❌ Lỗi Database nghiêm trọng:", error.message);
    process.exit(1);
  }
}

async function getLevel(id) {
  try {
    const res = await pool.query("SELECT * FROM levels WHERE userid=$1", [id]);
    if (res.rows.length === 0) {
      await pool.query(
        `INSERT INTO levels (userid,xp_week,lvl_week,xp_month,lvl_month,xp_year,lvl_year, kcoin, boost_until, daily_last) VALUES($1,0,1,0,1,0,1,0,0,0)`,
        [id]
      );
      return { xp_week: 0, lvl_week: 1, xp_month: 0, lvl_month: 1, xp_year: 0, lvl_year: 1, kcoin: 0, boost_until: 0, daily_last: 0 };
    }
    return res.rows[0];
  } catch (err) {
    console.error("Lỗi getLevel:", err);
    return null;
  }
}

async function saveLevel(id, data) {
  try {
    await pool.query(
      `UPDATE levels SET xp_week=$1, lvl_week=$2, xp_month=$3, lvl_month=$4, xp_year=$5, lvl_year=$6, kcoin=$7, boost_until=$8, daily_last=$9 WHERE userid=$10`,
      [data.xp_week, data.lvl_week, data.xp_month, data.lvl_month, data.xp_year, data.lvl_year, data.kcoin, data.boost_until, data.daily_last, id]
    );
  } catch (err) {
    console.error("Lỗi saveLevel:", err);
  }
}

// ===== ANIME SEARCH =====
async function getAnimeGif(tag) {
  try {
    const res = await axios.get(`https://nekos.best/api/v2/${tag}`);
    if (!res.data.results || res.data.results.length === 0) return null;
    return res.data.results[0].url;
  } catch (err) {
    console.error("GIF ERROR:", err.response?.data || err);
    return null;
  }
}

// ==========================================
// ===== START SYSTEM (Chạy tuần tự) ========
// ==========================================
async function startSystem() {
  await initDB();

  // Khởi động các bot chat (Woo & Kaworu)
  bots.forEach(config => {
    const client = new Client({
      intents: [ GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent ]
    });

    client.once("clientReady", () => {
      console.log(`✅ Bot online: ${client.user.tag}`);
    });

    client.on("messageCreate", async (message) => {
      if (message.author.bot) return;

      const content = message.content;
      const prefix = config.prefix;

      if (content === prefix + "hi") return message.reply("Anh chào em nha");
      if (content === prefix + "sleep") return message.reply("Ngủ ngon nha bé ngoan của anh");

      if (content === prefix + "love") {
        const percent = Math.floor(Math.random() * 101);
        let action = "", gifTag = null;
        
        if (percent < 10) { action = "giận dỗi, lùi ra xa"; gifTag = "slap"; }
        else if (percent < 35) { action = "nắm tay nhẹ nhàng"; gifTag = "handhold"; }
        else if (percent < 50) { action = "xoa đầu dỗ dành"; gifTag = "pat"; }
        else if (percent < 80) { action = "ôm ấp tình cảm"; gifTag = "hug"; }
        else if (percent < 99) { action = "hôn nồng cháy"; gifTag = "kiss"; }
        else { action = "đỏ mặt, muốn kết hôn"; gifTag = "blush"; }

        let gif = gifTag ? await getAnimeGif(gifTag) : null;

        try {
          const chat = await groq.chat.completions.create({
            messages: [
              { role: "system", content: config.personality },
              { role: "user", content: `Người dùng vừa đo thiện cảm và đạt ${percent}%. Bạn đang có hành động: "${action}". Hãy nói 1 câu phù hợp với tình huống này và đúng tính cách của bạn.` }
            ],
            model: "llama-3.3-70b-versatile"
          });

          const loveEmbed = new EmbedBuilder()
            .setTitle(`💖 Độ thiện cảm: ${percent}%`)
            .setDescription(chat.choices[0].message.content)
            .setColor("#ff3399");

          if (gif) loveEmbed.setImage(gif);

          return message.reply({ embeds: [loveEmbed] });
        } catch (err) {
          return message.reply(`💖 Độ thiện cảm: **${percent}%**\nLỗi AI không nói được.`);
        }
      }

      if (content === prefix + "help") {
        const helpEmbed = new EmbedBuilder()
          .setTitle("📜 Danh Sách Lệnh AI Bot")
          .setColor("#00BFFF")
          .setDescription(`Dưới đây là các lệnh bạn có thể sử dụng (Prefix: **${prefix}**):`)
          .addFields(
            { name: "💬 Giao tiếp cơ bản", value: `\`${prefix}hi\` - Chào bot\n\`${prefix}sleep\` - Chúc bot ngủ ngon\n\`${prefix}love\` - Đo độ thiện cảm`, inline: false },
            { name: "🫂 Hành động (Có ảnh GIF)", value: `\`${prefix}hug\` - Ôm\n\`${prefix}pat\` - Xoa đầu\n\`${prefix}kiss\` - Hôn\n\`${prefix}blush\` - Ngại ngùng\n\`${prefix}hand\` - Nắm tay`, inline: false },
            { name: "🤖 Tính năng AI", value: `\`${prefix}ai <nội dung>\` - Chat với AI\n\`${prefix}rep <id tin nhắn> <nội dung>\` - Nhờ bot reply tin nhắn`, inline: false }
          )
          .setFooter({ text: "Bot Tương Tác & Trí Tuệ Nhân Tạo" });
        return message.reply({ embeds: [helpEmbed] });
      }

      if (content.startsWith(prefix + "ai ")) {
        const prompt = content.slice((prefix + "ai ").length).trim();
        if (!prompt) return message.reply("Nói gì đi.");
        try {
          const chat = await groq.chat.completions.create({
            messages: [ { role: "system", content: config.personality }, { role: "user", content: prompt } ],
            model: "llama-3.3-70b-versatile"
          });
          let reply = chat.choices?.[0]?.message?.content || "Không nghĩ ra câu trả lời.";
          if (reply.length > 2000) reply = reply.substring(0, 2000);
          return message.reply(reply);
        } catch (err) {
          return message.reply("AI lỗi rồi");
        }
      }

      const interactions = ["pat", "hug", "kiss", "blush", "hand"];
      const interactMap = {
        pat: "xoa đầu", hug: "ôm", kiss: "hôn", blush: "ngại với", hand: "nắm tay"
      };

      for (const action of interactions) {
        if (content === prefix + action) {
          let queryTag = action === "hand" ? "handhold" : action;
          const gif = await getAnimeGif(queryTag);
          if (!gif) return message.reply("Không tìm được GIF 😢");

          try {
            const chat = await groq.chat.completions.create({
              messages: [
                { role: "system", content: config.personality },
                { role: "user", content: `Tạo 1 câu anime dễ thương khi ${interactMap[action]} người yêu` }
              ],
              model: "llama-3.3-70b-versatile"
            });

            const interactEmbed = new EmbedBuilder()
              .setDescription(chat.choices[0].message.content)
              .setColor("#ffcc99")
              .setImage(gif);

            return message.reply({ embeds: [interactEmbed] });
          } catch(e) {
            const failEmbed = new EmbedBuilder().setColor("#ffcc99").setImage(gif);
            return message.reply({ embeds: [failEmbed] });
          }
        }
      }

      if (content.startsWith(prefix + "rep")) {
        const args = content.split(" ");
        const msgID = args[1];
        const text = args.slice(2).join(" ");
        if (!msgID || !text) return message.reply(`Dùng: ${prefix}rep <messageID> <nội dung>`);
        try {
          let found = null;
          for (const channel of message.guild.channels.cache.values()) {
            if (!channel.isTextBased()) continue;
            try {
              const msg = await channel.messages.fetch(msgID);
              if (msg) { found = msg; break; }
            } catch {}
          }
          if (!found) return message.reply("Không tìm thấy message.");
          await found.reply(text);
          try { await message.delete(); } catch {}
        } catch (err) {
          message.reply("Lỗi khi reply.");
        }
      }
    });

    client.login(config.token);
  });

  // Khởi động Level Bot
  const levelBot = new Client({
    intents: [ GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.MessageContent ]
  });

  levelBot.once("clientReady", () => {
    console.log(`📈 Level bot online: ${levelBot.user.tag}`);
  });

  levelBot.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    const content = message.content;
    const id = message.author.id;
    const now = Date.now();

    if (content.startsWith(LEVEL_PREFIX)) {
      const args = content.slice(LEVEL_PREFIX.length).trim().split(/ +/);
      const cmd = args[0];

      if (cmd === "check") {
        const checkLvl = parseInt(args[1]);
        if (!checkLvl || isNaN(checkLvl)) return message.reply("Vui lòng nhập số level. VD: `lvl!check 10`");
        return message.reply(`Để đạt Level **${checkLvl}**, người chơi cần **${xpNeeded(checkLvl)} XP** (làm tròn chục).`);
      }

      if (cmd === "profile" || cmd === "rank") {
        const data = await getLevel(id);
        if (!data) return message.reply("Lỗi lấy dữ liệu.");

        const needWeek = xpNeeded(data.lvl_week);
        const needMonth = xpNeeded(data.lvl_month);
        const needYear = xpNeeded(data.lvl_year);
        
        let boostText = "Không có";
        if (data.boost_until > now) {
          boostText = `Đang kích hoạt (Còn ${formatTimeLeft(data.boost_until - now)})`;
        }

        if (cmd === "rank") {
          return message.reply(`📊 LEVEL\n📅 Week: Lv ${data.lvl_week} (${data.xp_week}/${needWeek})\n🗓 Month: Lv ${data.lvl_month} (${data.xp_month}/${needMonth})\n📆 Year: Lv ${data.lvl_year} (${data.xp_year}/${needYear})\n🪙 Kcoin: **${data.kcoin}**`);
        }

        const rewards = await pool.query("SELECT reward FROM rewards WHERE userid=$1", [id]);
        let rewardText = rewards.rows.length > 0 ? rewards.rows.map(r => "🏆 " + r.reward).join("\n") : "None";

        const profileText = `👤 **${message.author.username}**\n\n🪙 **Tài sản:** ${data.kcoin} Kcoin\n🚀 **Boost x2:** ${boostText}\n\n📅 Week: Lv ${data.lvl_week} (${data.xp_week}/${needWeek})\n🗓 Month: Lv ${data.lvl_month} (${data.xp_month}/${needMonth})\n📆 Year: Lv ${data.lvl_year} (${data.xp_year}/${needYear})\n\n🏅 Thành tích:\n${rewardText}`;
        const embed = new EmbedBuilder().setTitle("📊 PROFILE").setDescription(profileText).setColor("#ff66cc");
        return message.reply({ embeds: [embed] });
      }

      // ===== HỆ THỐNG KINH TẾ (ECONOMY) =====

      // 1. Nhận quà hằng ngày
      if (cmd === "daily") {
        const data = await getLevel(id);
        if (now - data.daily_last < 86400000) { // 24 giờ
          const timeLeft = formatTimeLeft(86400000 - (now - data.daily_last));
          return message.reply(`⏳ Bạn đã nhận quà rồi! Hãy quay lại sau **${timeLeft}** nữa nhé.`);
        }

        const isBoosted = data.boost_until > now;
        const jackpotChance = isBoosted ? 0.002 : 0.001; // 0.1% gốc, x2 là 0.2%
        
        let baseKcoin = Math.floor(Math.random() * 101) + 100; // 100 - 200
        let kcoinEarned = isBoosted ? baseKcoin * 2 : baseKcoin;

        let isJackpot = Math.random() < jackpotChance;
        if (isJackpot) kcoinEarned = 10000;

        data.kcoin += kcoinEarned;
        data.daily_last = now;
        await saveLevel(id, data);

        if (isJackpot) {
          return message.reply(`🎉 **JACKPOT ĐIÊN RỒ!!!** 🎉\nBạn đã trúng độc đắc và nhận được **10,000 Kcoin** từ Daily! 🤑`);
        } else {
          return message.reply(`🎁 Bạn đã nhận điểm danh hằng ngày: **+${kcoinEarned} Kcoin**!`);
        }
      }

      // 2. Cửa hàng
      if (cmd === "shop") {
        const shopEmbed = new EmbedBuilder()
          .setTitle("🛒 Cửa Hàng Kcoin")
          .setColor("#ff9900")
          .setDescription("Sử dụng lệnh `lvl!buy <mã>` để mua vật phẩm.")
          .addFields({
            name: "🔥 Thuốc tăng lực (Mã: `boost`) - Giá: 10,000 Kcoin",
            value: "• Nhân đôi (x2) lượng XP nhận được.\n• Nhân đôi (x2) lượng Kcoin nhận được khi chat/voice.\n• Nhân đôi (x2) tỉ lệ trúng Jackpot ngẫu nhiên.\n*(Thời lượng: 1 Giờ)*"
          });
        return message.reply({ embeds: [shopEmbed] });
      }

      if (cmd === "buy") {
        if (args[1] === "boost") {
          const data = await getLevel(id);
          if (data.kcoin < 10000) return message.reply("❌ Bạn không đủ tiền! Cần **10,000 Kcoin** để mua vật phẩm này.");
          
          data.kcoin -= 10000;
          // Kích hoạt boost 1 giờ (3.600.000 ms) kể từ hiện tại (cộng dồn nếu đã có)
          if (data.boost_until > now) {
            data.boost_until += 3600000; 
          } else {
            data.boost_until = now + 3600000;
          }
          await saveLevel(id, data);
          return message.reply("✅ Mua thành công **Thuốc tăng lực (Boost)**! Bạn đã được kích hoạt trạng thái x2 trong vòng 1 giờ.");
        }
        return message.reply("❌ Mã vật phẩm không tồn tại. Gõ `lvl!shop` để xem danh sách.");
      }

      // 3. Chuyển tiền (Trade)
      if (cmd === "trade" || cmd === "pay" || cmd === "give") {
        const targetUser = message.mentions.users.first();
        const amount = parseInt(args[2]);

        if (!targetUser) return message.reply("❌ Bạn cần tag người muốn chuyển tiền. Dùng: `lvl!trade @user <số tiền>`");
        if (targetUser.bot) return message.reply("❌ Bạn không thể chuyển tiền cho Bot!");
        if (targetUser.id === id) return message.reply("❌ Bạn không thể tự chuyển tiền cho chính mình!");
        if (!amount || isNaN(amount) || amount <= 0) return message.reply("❌ Số tiền không hợp lệ.");

        const senderData = await getLevel(id);
        if (senderData.kcoin < amount) return message.reply(`❌ Bạn không đủ tiền! Bạn chỉ có **${senderData.kcoin} Kcoin**.`);

        const receiverData = await getLevel(targetUser.id);
        
        senderData.kcoin -= amount;
        receiverData.kcoin += amount;

        await saveLevel(id, senderData);
        await saveLevel(targetUser.id, receiverData);

        return message.reply(`💸 Chuyển khoản thành công! Bạn đã gửi **${amount} Kcoin** cho <@${targetUser.id}>.`);
      }

      // 4. Tung đồng xu (Coinflip)
      if (cmd === "cf") {
        const bet = parseInt(args[1]);
        if (!bet || isNaN(bet) || bet <= 0) return message.reply("❌ Vui lòng nhập số tiền cược hợp lệ. VD: `lvl!cf 500`");
        if (bet > 1000) return message.reply("❌ Bạn chỉ có thể cược tối đa **1000 Kcoin** mỗi lần!");

        const data = await getLevel(id);
        if (data.kcoin < bet) return message.reply(`❌ Bạn không đủ Kcoin để cược. Bạn đang có **${data.kcoin} Kcoin**.`);

        // Tung xu 50/50
        const isWin = Math.random() < 0.5;

        if (isWin) {
          data.kcoin += bet; // Cộng tiền thắng
          await saveLevel(id, data);
          return message.reply(`🪙 Đồng xu ngửa! Chúc mừng bạn đã **Thắng** và nhận được **${bet * 2} Kcoin** (lời ${bet}).`);
        } else {
          data.kcoin -= bet; // Trừ tiền thua
          await saveLevel(id, data);
          return message.reply(`🪙 Đồng xu sấp! Rất tiếc, bạn đã **Thua** và mất **${bet} Kcoin**.`);
        }
      }

      // ===== ADMIN COMMANDS =====
      if (cmd === "reward") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return;
        const user = message.mentions.users.first();
        const text = args.slice(2).join(" ");
        if (!user || !text) return message.reply("lvl!reward @user <text>");
        await pool.query("INSERT INTO rewards(userid,reward) VALUES($1,$2)", [user.id, text]);
        return message.reply("🏆 Đã thêm thành tích");
      }

      if (cmd === "top") {
        const topEmbed = new EmbedBuilder()
          .setTitle("🏆 BẢNG XẾP HẠNG (LEADERBOARD)")
          .setColor("#ffd700")
          .setFooter({ text: "Cập nhật liên tục từ Database" });

        const buildTopText = async (rows, type) => {
          if (rows.length === 0) return "Chưa có ai.";
          let text = "";
          for (let i = 0; i < rows.length; i++) {
            const user = rows[i];
            let username = "Unknown";
            try {
              const fetchedUser = await levelBot.users.fetch(user.userid);
              username = fetchedUser.username;
            } catch (e) {}
            
            const lvl = user[`lvl_${type}`];
            text += `**${i + 1}.** ${username} - Lv.${lvl}\n`;
          }
          return text;
        };

        const resWeek = await pool.query("SELECT * FROM levels ORDER BY lvl_week DESC, xp_week DESC LIMIT 10");
        const resMonth = await pool.query("SELECT * FROM levels ORDER BY lvl_month DESC, xp_month DESC LIMIT 10");
        const resYear = await pool.query("SELECT * FROM levels ORDER BY lvl_year DESC, xp_year DESC LIMIT 10");

        const textWeek = await buildTopText(resWeek.rows, "week");
        const textMonth = await buildTopText(resMonth.rows, "month");
        const textYear = await buildTopText(resYear.rows, "year");

        topEmbed.addFields(
          { name: "📅 TOP TUẦN", value: textWeek, inline: true },
          { name: "🗓️ TOP THÁNG", value: textMonth, inline: true },
          { name: "📆 TOP NĂM", value: textYear, inline: true }
        );

        return message.reply({ embeds: [topEmbed] });
      }

      if (cmd === "reset") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return message.reply("❌ Mod only");
        const type = args[1];
        if (type === "week") { await pool.query("UPDATE levels SET xp_week=0,lvl_week=1"); return message.reply("🔄 Reset tuần"); }
        if (type === "month") { await pool.query("UPDATE levels SET xp_month=0,lvl_month=1"); return message.reply("🔄 Reset tháng"); }
        if (type === "year") { await pool.query("UPDATE levels SET xp_year=0,lvl_year=1"); return message.reply("🔄 Reset năm"); }
      }
      
      if (cmd === "help") {
        const lvlHelpEmbed = new EmbedBuilder()
          .setTitle("📈 Danh Sách Lệnh Level & Economy")
          .setColor("#32CD32")
          .setDescription(`Prefix của bot cấp độ là: **${LEVEL_PREFIX}**`)
          .addFields(
            { name: "👤 Cấp độ", value: `\`${LEVEL_PREFIX}rank\` - Xem cấp độ hiện tại\n\`${LEVEL_PREFIX}profile\` - Xem hồ sơ chi tiết và tài sản\n\`${LEVEL_PREFIX}top\` - Bảng xếp hạng XP\n\`${LEVEL_PREFIX}check <level>\` - Đo mức XP cần thiết`, inline: false },
            { name: "💰 Kinh tế (Kcoin)", value: `\`${LEVEL_PREFIX}daily\` - Nhận lương hằng ngày\n\`${LEVEL_PREFIX}shop\` - Mở cửa hàng\n\`${LEVEL_PREFIX}buy <item>\` - Mua vật phẩm\n\`${LEVEL_PREFIX}trade @user <số tiền>\` - Chuyển tiền\n\`${LEVEL_PREFIX}cf <tiền cược>\` - Tung đồng xu 50/50`, inline: false }
          )
          .setFooter({ text: "Hệ thống Level, Tương Tác & Kinh Tế" });
        return message.reply({ embeds: [lvlHelpEmbed] });
      }
    }

    /* ========= CHAT XP & KCOIN ========= */
    if (content.length < 5) return;
    
    if (cooldown.has(id) && cooldown.get(id) > now) return;
    cooldown.set(id, now + 15000); 
    
    const data = await getLevel(id);
    if (!data) return;

    // Check Boost
    const isBoosted = data.boost_until > now;
    const xpMult = isBoosted ? 2 : 1;
    const coinMult = isBoosted ? 2 : 1;
    const jackpotChance = isBoosted ? 0.02 : 0.01; // Gốc 1%, Boost lên 2%

    // Cộng XP
    const baseXp = Math.floor(Math.random() * 91) + 10; 
    const finalXp = baseXp * xpMult;

    data.xp_week += finalXp; data.xp_month += finalXp; data.xp_year += finalXp;

    // Cộng Kcoin & Xổ số Jackpot
    let kcoinEarned = (Math.floor(Math.random() * 2) + 1) * coinMult; // Random 1-2 Kcoin
    
    if (Math.random() < jackpotChance) {
      kcoinEarned += 100;
      message.reply(`🎲 **Jackpot!** Nhờ chăm chỉ chat, bạn nhặt được **100 Kcoin** ngẫu nhiên!`).catch(()=>{});
    }

    data.kcoin += kcoinEarned;

    while (data.xp_week >= xpNeeded(data.lvl_week)) { data.xp_week -= xpNeeded(data.lvl_week); data.lvl_week++; }
    while (data.xp_month >= xpNeeded(data.lvl_month)) { data.xp_month -= xpNeeded(data.lvl_month); data.lvl_month++; }
    while (data.xp_year >= xp_needed(data.lvl_year)) { data.xp_year -= xpNeeded(data.lvl_year); data.lvl_year++; }

    await saveLevel(id, data);
  });

  // Voice XP & KCOIN
  setInterval(async () => {
    const now = Date.now();

    for (const guild of levelBot.guilds.cache.values()) {
      for (const channel of guild.channels.cache.values()) {
        if (!channel.isVoiceBased()) continue;

        for (const member of channel.members.values()) {
          if (member.user.bot || member.voice.selfMute || member.voice.selfDeaf) continue;

          const id = member.user.id;
          const data = await getLevel(id);
          if (!data) continue;

          // Check Boost
          const isBoosted = data.boost_until > now;
          const xpMult = isBoosted ? 2 : 1;
          const coinMult = isBoosted ? 2 : 1;
          const jackpotChance = isBoosted ? 0.02 : 0.01; // Gốc 1%, Boost lên 2%

          // Cộng XP
          const baseVoiceXp = Math.floor(Math.random() * 71) + 50;
          const finalVoiceXp = baseVoiceXp * xpMult;

          data.xp_week += finalVoiceXp; data.xp_month += finalVoiceXp; data.xp_year += finalVoiceXp;

          // Cộng Kcoin & Xổ số Jackpot Voice
          let kcoinEarned = (Math.floor(Math.random() * 4) + 2) * coinMult; // Random 2-5 Kcoin
          
          if (Math.random() < jackpotChance) {
            kcoinEarned += 100;
            if (guild.systemChannel) {
               guild.systemChannel.send(`🎲 **Jackpot Voice!** <@${id}> cắm voice chăm chỉ nên nhặt được **100 Kcoin**!`).catch(()=>{});
            }
          }

          data.kcoin += kcoinEarned;

          while (data.xp_week >= xpNeeded(data.lvl_week)) { data.xp_week -= xpNeeded(data.lvl_week); data.lvl_week++; }
          while (data.xp_month >= xpNeeded(data.lvl_month)) { data.xp_month -= xpNeeded(data.lvl_month); data.lvl_month++; }
          
          while (data.xp_year >= xpNeeded(data.lvl_year)) {
            data.xp_year -= xpNeeded(data.lvl_year);
            data.lvl_year++;
            if (guild.systemChannel) {
              guild.systemChannel.send(`🎉 <@${id}> đã lên level ${data.lvl_year}!`).catch(()=>{});
            }
          }
          await saveLevel(id, data);
        }
      }
    }
  }, 60000); // Quét Voice mỗi 1 phút

  levelBot.login(LEVEL_TOKEN);
}

startSystem();