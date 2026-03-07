require("dotenv").config();
const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const { Pool } = require("pg");
const Groq = require("groq-sdk");

const cooldown = new Map();
const guildPrefixCache = new Map(); // Cache lưu prefix của từng server

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

async function sendLvlNotify(guild, embed) {
  try {
    const res = await pool.query("SELECT lvl_channel FROM guild_settings WHERE guildid=$1", [guild.id]);
    const channelId = res.rows[0]?.lvl_channel;
    if (!channelId) return;

    const channel = guild.channels.cache.get(channelId);
    if (channel) await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error("Lỗi gửi thông báo level:", err);
  }
}

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

const DEFAULT_LEVEL_PREFIX = "lvl!";
const LEVEL_TOKEN = process.env.DISCORD_TOKEN_LVL;

// ===== HELPERS =====
function xpNeeded(level) {
  const rawXp = 50 * Math.pow(level, 1.5) + 50 * level;
  return Math.round(rawXp / 10) * 10;
}

function formatTimeLeft(ms) {
  if (ms <= 0) return "Đã hết hạn";
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes} phút ${seconds} giây`;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Lấy prefix cho server
async function getPrefix(guildId) {
  if (guildPrefixCache.has(guildId)) return guildPrefixCache.get(guildId);
  const res = await pool.query("SELECT prefix FROM guild_settings WHERE guildid=$1", [guildId]);
  const prefix = res.rows[0]?.prefix || DEFAULT_LEVEL_PREFIX;
  guildPrefixCache.set(guildId, prefix);
  return prefix;
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
        xp_year INT DEFAULT 0, lvl_year INT DEFAULT 1,
        kcoin INT DEFAULT 0, boost_until BIGINT DEFAULT 0, daily_last BIGINT DEFAULT 0
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS guild_settings (
        guildid TEXT PRIMARY KEY,
        lvl_channel TEXT,
        prefix TEXT DEFAULT 'lvl!'
      )
    `);

    await pool.query(`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS prefix TEXT DEFAULT 'lvl!';`).catch(() => {});

    await pool.query(`
      CREATE TABLE IF NOT EXISTS inventory (
        id SERIAL PRIMARY KEY,
        userid TEXT,
        item_type TEXT, 
        item_name TEXT,
        quantity INT DEFAULT 1,
        part TEXT,
        set_name TEXT,
        stat_xp INT DEFAULT 0,
        stat_jp_chance INT DEFAULT 0,
        stat_jp_money INT DEFAULT 0,
        stat_gamble INT DEFAULT 0,
        is_equipped BOOLEAN DEFAULT false
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS rewards (
        id SERIAL PRIMARY KEY,
        userid TEXT,
        reward TEXT
      )
    `);
    
    const prefixes = await pool.query("SELECT guildid, prefix FROM guild_settings");
    prefixes.rows.forEach(r => guildPrefixCache.set(r.guildid, r.prefix));

    console.log("✅ Database đã sẵn sàng và tạo bảng thành công!");
  } catch (error) {
    console.error("❌ Lỗi Database:", error.message);
  }
}

async function getLevel(id) {
  const res = await pool.query("SELECT * FROM levels WHERE userid=$1", [id]);
  if (res.rows.length === 0) {
    await pool.query(`INSERT INTO levels (userid) VALUES($1)`, [id]);
    return { xp_week: 0, lvl_week: 1, xp_month: 0, lvl_month: 1, xp_year: 0, lvl_year: 1, kcoin: 0, boost_until: 0, daily_last: 0 };
  }
  return res.rows[0];
}

async function saveLevel(id, data) {
  await pool.query(
    `UPDATE levels SET xp_week=$1, lvl_week=$2, xp_month=$3, lvl_month=$4, xp_year=$5, lvl_year=$6, kcoin=$7, boost_until=$8, daily_last=$9 WHERE userid=$10`,
    [data.xp_week, data.lvl_week, data.xp_month, data.lvl_month, data.xp_year, data.lvl_year, data.kcoin, data.boost_until, data.daily_last, id]
  );
}

async function getEquipBuffs(userid) {
  const res = await pool.query("SELECT * FROM inventory WHERE userid=$1 AND is_equipped=true", [userid]);
  let buffs = { xp: 0, jpChance: 0, jpMoney: 0, gamble: 0 };
  res.rows.forEach(item => {
    buffs.xp += item.stat_xp;
    buffs.jpChance += item.stat_jp_chance;
    buffs.jpMoney += item.stat_jp_money;
    buffs.gamble += item.stat_gamble;
  });
  return buffs;
}

async function getAnimeGif(tag) {
  try {
    const res = await axios.get(`https://nekos.best/api/v2/${tag}`);
    return res.data.results?.[0]?.url || null;
  } catch (err) { return null; }
}

// ==========================================
// ===== BẮT ĐẦU HỆ THỐNG ===================
// ==========================================
async function startSystem() {
  await initDB();

  // 1. KHỞI ĐỘNG CÁC BOT AI
  bots.forEach(config => {
    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
    });

    client.once("ready", (c) => console.log(`✅ AI Bot online: ${c.user.tag}`));

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
      const interactMap = { pat: "xoa đầu", hug: "ôm", kiss: "hôn", blush: "ngại với", hand: "nắm tay" };

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

  // 2. KHỞI ĐỘNG LEVEL BOT
  const levelBot = new Client({
    intents: [ GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.MessageContent ]
  });

  levelBot.once("ready", () => console.log(`📈 Level bot online: ${levelBot.user.tag}`));

  levelBot.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;

    const id = message.author.id;
    const now = Date.now();
    const content = message.content.trim();

    if (content.startsWith("^") || content.startsWith("!!")) return;

    const prefix = await getPrefix(message.guild.id);

    // --- PHẦN A: XỬ LÝ LỆNH LEVEL ---
    if (content.startsWith(prefix)) {
      const args = content.slice(prefix.length).trim().split(/ +/);
      const cmd = args.shift().toLowerCase();

      if (cmd === "help") {
        const helpEmbed = new EmbedBuilder()
          .setTitle("📚 Danh Sách Lệnh Level Bot")
          .setColor("#5865F2")
          .setDescription(`Prefix hiện tại của server là: **${prefix}**`)
          .addFields(
            { name: "🏆 Cày Cấp & Tiền", value: `\`${prefix}profile\` - Xem hồ sơ & hạng\n\`${prefix}cash\` - Xem tiền\n\`${prefix}top\` - Bảng xếp hạng\n\`${prefix}daily\` - Nhận thưởng mỗi 24h\n\`${prefix}cf <tiền>\` - Chơi tung đồng xu (50/50)` },
            { name: "🛍️ Shop & Gacha", value: `\`${prefix}shop\` - Xem cửa hàng\n\`${prefix}buy <mã>\` - Mua vật phẩm\n\`${prefix}inv\` - Xem túi đồ\n\`${prefix}use <stt> [SL]\` - Mở rương gacha\n\`${prefix}equip <stt>\` - Mặc/tháo đồ\n\`${prefix}giveitem @user <stt>\` - Tặng đồ\n\`${prefix}pay @user <tiền>\` - Chuyển Kcoin` },
            { name: "⚙️ Cài đặt", value: `\`${prefix}prefix <ký tự mới>\` - Đổi prefix\n\`${prefix}setchannel\` - Đặt kênh báo level` }
          )
          .setFooter({ text: "Tip: Chat hoặc treo Voice đều được nhận ngẫu nhiên XP & Kcoin nhé!" });
        return message.reply({ embeds: [helpEmbed] });
      }

      if (cmd === "prefix") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return message.reply("❌ Cần quyền Quản lý Server.");
        const newPrefix = args[0];
        if (!newPrefix) return message.reply(`Prefix hiện tại: **${prefix}**. Để đổi: \`${prefix}prefix <ký_tự_mới>\``);
        
        await pool.query(
          "INSERT INTO guild_settings (guildid, prefix) VALUES ($1, $2) ON CONFLICT (guildid) DO UPDATE SET prefix = $2",
          [message.guild.id, newPrefix]
        );
        guildPrefixCache.set(message.guild.id, newPrefix);
        return message.reply(`✅ Đã đổi prefix thành: **${newPrefix}**`);
      }

      if (cmd === "channel" || cmd === "setchannel") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return message.reply("❌ Cần quyền Manage Guild.");
        const channel = message.mentions.channels.first() || message.channel;
        await pool.query("INSERT INTO guild_settings (guildid, lvl_channel) VALUES ($1, $2) ON CONFLICT (guildid) DO UPDATE SET lvl_channel = $2", [message.guild.id, channel.id]);
        return message.reply(`✅ Đã đặt kênh thông báo tại: ${channel}`);
      }

      if (cmd === "shop") {
        const shopEmbed = new EmbedBuilder()
          .setTitle("🛒 Cửa Hàng Kcoin & Gacha")
          .setColor("#ff9900")
          .setDescription(`Dùng lệnh \`${prefix}buy <mã>\` để mua vật phẩm.`)
          .addFields(
            { name: "🔥 Thuốc Boost (Mã: `boost`) - 10,000 KC", value: "Nhân đôi X2 XP & Kcoin trong 1 giờ." },
            { name: "📦 Rương I (Mã: `r1`) - 1,000 KC", value: "Tỷ lệ: Bã mía 40%, Đồng 30%, Sắt 25%, Vàng 5%" },
            { name: "🧰 Rương II (Mã: `r2`) - 5,000 KC", value: "Tỷ lệ: Bã mía 20%, Đồng 35%, Sắt 30%, Vàng 10%, Kim Cương 5%" },
            { name: "💎 Rương III (Mã: `r3`) - 20,000 KC", value: "Tỷ lệ: Đồng 40%, Sắt 30%, Vàng 20%, Kim Cương 9.9%, Phượng Hoàng 0.1%" }
          );
        return message.reply({ embeds: [shopEmbed] });
      }

      if (cmd === "buy") {
        const data = await getLevel(id);
        const itemCode = args[0]?.toLowerCase();
        let cost = 0, itemName = "";

        if (itemCode === "boost") cost = 10000;
        else if (itemCode === "r1") { cost = 1000; itemName = "Rương I"; }
        else if (itemCode === "r2") { cost = 5000; itemName = "Rương II"; }
        else if (itemCode === "r3") { cost = 20000; itemName = "Rương III"; }
        else return message.reply(`❌ Mã vật phẩm sai. Gõ \`${prefix}shop\` để xem.`);

        if (data.kcoin < cost) return message.reply(`❌ Bạn không đủ tiền! Cần **${cost.toLocaleString()} Kcoin**.`);
        data.kcoin -= cost;
        await saveLevel(id, data);

        if (itemCode === "boost") {
          data.boost_until = Math.max(data.boost_until, now) + 3600000;
          await saveLevel(id, data);
          return message.reply("✅ Đã kích hoạt Boost x2 trong 1 giờ!");
        } else {
          const invCheck = await pool.query("SELECT * FROM inventory WHERE userid=$1 AND item_name=$2", [id, itemName]);
          if (invCheck.rows.length > 0) {
            await pool.query("UPDATE inventory SET quantity = quantity + 1 WHERE id=$1", [invCheck.rows[0].id]);
          } else {
            await pool.query("INSERT INTO inventory (userid, item_type, item_name, quantity) VALUES ($1, 'chest', $2, 1)", [id, itemName]);
          }
          return message.reply(`📦 Bạn đã mua thành công **${itemName}**. Dùng \`${prefix}inv\` để kiểm tra!`);
        }
      }

      if (cmd === "inv" || cmd === "inventory") {
        const invData = await pool.query("SELECT * FROM inventory WHERE userid=$1 ORDER BY item_type ASC, id ASC", [id]);
        if (invData.rows.length === 0) return message.reply("🎒 Túi đồ của bạn trống rỗng.");

        const page = parseInt(args[0]) || 1;
        const limit = 10;
        const totalPages = Math.ceil(invData.rows.length / limit);
        if (page < 1 || page > totalPages) return message.reply(`❌ Trang không hợp lệ. Tổng số trang: ${totalPages}`);

        const start = (page - 1) * limit;
        const items = invData.rows.slice(start, start + limit);

        const embed = new EmbedBuilder().setTitle(`🎒 Túi Đồ Của ${message.author.username}`).setColor("#8A2BE2");
        let desc = "";

        items.forEach((item, index) => {
          const globalIndex = start + index + 1; 
          if (item.item_type === 'chest') {
            desc += `**[${globalIndex}]** 📦 ${item.item_name} (x${item.quantity})\n`;
          } else {
            const equipIcon = item.is_equipped ? "✅ " : "";
            desc += `**[${globalIndex}]** ${equipIcon}**${item.item_name}** [${item.set_name} - ${item.part}]\n`;
            desc += `└ *Buff: +${item.stat_xp}% XP, +${item.stat_jp_chance}% Tỉ lệ JP, +${item.stat_jp_money} Tiền JP, +${item.stat_gamble}% Cờ bạc*\n`;
          }
        });

        embed.setDescription(desc).setFooter({ text: `Trang ${page}/${totalPages} • Dùng ${prefix}use <stt> hoặc ${prefix}equip <stt>` });
        return message.reply({ embeds: [embed] });
      }

      if (cmd === "use") {
        const index = parseInt(args[0]) - 1;
        const amount = parseInt(args[1]) || 1;
        if (isNaN(index) || index < 0) return message.reply(`❌ Dùng: \`${prefix}use <STT_Trong_Túi> [số_lượng]\``);

        const invData = await pool.query("SELECT * FROM inventory WHERE userid=$1 ORDER BY item_type ASC, id ASC", [id]);
        const targetItem = invData.rows[index];

        if (!targetItem || targetItem.item_type !== 'chest') return message.reply("❌ Vật phẩm không tồn tại hoặc không phải là Rương.");
        if (targetItem.quantity < amount) return message.reply(`❌ Bạn chỉ có ${targetItem.quantity} rương này.`);

        let openedText = "";
        for (let i = 0; i < amount; i++) {
          const rand = Math.random() * 100;
          let setName = "";
          
          if (targetItem.item_name === 'Rương I') {
            if (rand <= 40) setName = 'Bã mía';
            else if (rand <= 70) setName = 'Đồng';
            else if (rand <= 95) setName = 'Sắt';
            else setName = 'Vàng';
          } else if (targetItem.item_name === 'Rương II') {
            if (rand <= 20) setName = 'Bã mía';
            else if (rand <= 55) setName = 'Đồng';
            else if (rand <= 85) setName = 'Sắt';
            else if (rand <= 95) setName = 'Vàng';
            else setName = 'Kim Cương';
          } else { 
            if (rand <= 40) setName = 'Đồng';
            else if (rand <= 70) setName = 'Sắt';
            else if (rand <= 90) setName = 'Vàng';
            else if (rand <= 99.9) setName = 'Kim Cương';
            else setName = 'Phượng Hoàng';
          }

          const parts = ['Mũ', 'Giáp', 'Quần', 'Giày', 'Găng tay'];
          const part = parts[Math.floor(Math.random() * parts.length)];
          const finalName = `${part} ${setName}`;

          let s_xp=0, s_jpC=0, s_jpM=0, s_gamble=0;
          if (setName === 'Bã mía') s_xp = randInt(1, 5);
          if (setName === 'Đồng') s_xp = randInt(10, 15);
          if (setName === 'Sắt') s_xp = randInt(20, 30);
          if (setName === 'Vàng') { s_xp = randInt(25, 35); s_jpC = randInt(2, 5); }
          if (setName === 'Kim Cương') { s_xp = randInt(40, 60); s_jpC = randInt(3, 5); s_jpM = randInt(50, 100); }
          if (setName === 'Phượng Hoàng') { s_xp = randInt(80, 100); s_jpC = randInt(7, 10); s_jpM = randInt(200, 500); s_gamble = randInt(1, 5); }

          await pool.query(
            "INSERT INTO inventory (userid, item_type, item_name, part, set_name, stat_xp, stat_jp_chance, stat_jp_money, stat_gamble) VALUES ($1, 'equip', $2, $3, $4, $5, $6, $7, $8)",
            [id, finalName, part, setName, s_xp, s_jpC, s_jpM, s_gamble]
          );
          openedText += `✨ **${finalName}** (+${s_xp}% XP)\n`;
        }

        if (targetItem.quantity === amount) {
          await pool.query("DELETE FROM inventory WHERE id=$1", [targetItem.id]);
        } else {
          await pool.query("UPDATE inventory SET quantity = quantity - $1 WHERE id=$2", [amount, targetItem.id]);
        }

        return message.reply(`🎉 Bạn đã mở **${amount} ${targetItem.item_name}** và nhận được:\n${openedText}`);
      }

      if (cmd === "equip") {
        const index = parseInt(args[0]) - 1;
        if (isNaN(index) || index < 0) return message.reply(`❌ Dùng: \`${prefix}equip <STT_Trong_Túi>\``);

        const invData = await pool.query("SELECT * FROM inventory WHERE userid=$1 ORDER BY item_type ASC, id ASC", [id]);
        const targetItem = invData.rows[index];

        if (!targetItem || targetItem.item_type !== 'equip') return message.reply("❌ Vật phẩm không phải trang bị.");
        
        if (targetItem.is_equipped) {
          await pool.query("UPDATE inventory SET is_equipped=false WHERE id=$1", [targetItem.id]);
          return message.reply(`Đã tháo **${targetItem.item_name}**.`);
        }

        await pool.query("UPDATE inventory SET is_equipped=false WHERE userid=$1 AND part=$2", [id, targetItem.part]);
        await pool.query("UPDATE inventory SET is_equipped=true WHERE id=$1", [targetItem.id]);
        return message.reply(`⚔️ Đã trang bị **${targetItem.item_name}**!`);
      }

      if (cmd === "giveitem") { 
        const targetUser = message.mentions.users.first();
        const index = parseInt(args[1]) - 1;
        
        if (!targetUser || targetUser.bot) return message.reply(`❌ Dùng: \`${prefix}giveitem @user <STT>\``);
        if (isNaN(index) || index < 0) return message.reply("❌ Nhập đúng số thứ tự món đồ.");

        const invData = await pool.query("SELECT * FROM inventory WHERE userid=$1 ORDER BY item_type ASC, id ASC", [id]);
        const targetItem = invData.rows[index];

        if (!targetItem) return message.reply("❌ Không tìm thấy vật phẩm.");
        if (targetItem.is_equipped) return message.reply("❌ Hãy tháo trang bị ra trước khi cho.");

        if (targetItem.item_type === 'chest') {
          if (targetItem.quantity === 1) await pool.query("UPDATE inventory SET userid=$1 WHERE id=$2", [targetUser.id, targetItem.id]);
          else {
            await pool.query("UPDATE inventory SET quantity = quantity - 1 WHERE id=$1", [targetItem.id]);
            const check = await pool.query("SELECT * FROM inventory WHERE userid=$1 AND item_name=$2", [targetUser.id, targetItem.item_name]);
            if (check.rows.length > 0) await pool.query("UPDATE inventory SET quantity = quantity + 1 WHERE id=$1", [check.rows[0].id]);
            else await pool.query("INSERT INTO inventory (userid, item_type, item_name, quantity) VALUES ($1, 'chest', $2, 1)", [targetUser.id, targetItem.item_name]);
          }
        } else {
          await pool.query("UPDATE inventory SET userid=$1 WHERE id=$2", [targetUser.id, targetItem.id]);
        }
        return message.reply(`🎁 Bạn đã tặng **${targetItem.item_name}** cho <@${targetUser.id}>.`);
      }

      // ==========================================
      // LỆNH MỚI: CASH (Kiểm tra tiền)
      // ==========================================
      if (cmd === "cash" || cmd === "bal" || cmd === "balance" || cmd === "money") {
        const data = await getLevel(id);
        const embed = new EmbedBuilder()
          .setColor("#FFD700")
          .setDescription(`💰 **${message.author.username}**, bạn đang có **${data.kcoin.toLocaleString()} Kcoin** trong ví.`);
        return message.reply({ embeds: [embed] });
      }

      // ==========================================
      // LỆNH ĐƯỢC GỘP: PROFILE / RANK
      // ==========================================
      if (cmd === "rank" || cmd === "profile" || cmd === "info") {
        const data = await getLevel(id);
        const buffs = await getEquipBuffs(id);
        const isBoosted = data.boost_until > now;
        
        const remainWeek = xpNeeded(data.lvl_week) - data.xp_week;
        const remainMonth = xpNeeded(data.lvl_month) - data.xp_month;
        const remainYear = xpNeeded(data.lvl_year) - data.xp_year;

        const progress = Math.min(Math.floor((data.xp_year / xpNeeded(data.lvl_year)) * 10), 10);
        const progressBar = "▰".repeat(progress) + "▱".repeat(10 - progress);

        // Hiển thị Buff nếu có
        let buffText = "Không có";
        if (buffs.xp > 0 || buffs.gamble > 0 || buffs.jpChance > 0) {
          buffText = `+${buffs.xp}% XP | +${buffs.gamble}% Cờ bạc | +${buffs.jpChance}% Tỉ lệ JP`;
        }

        const rankEmbed = new EmbedBuilder()
          .setColor(isBoosted ? "#F1C40F" : "#5865F2") 
          .setTitle(`👤 HỒ SƠ CỦA ${message.author.username.toUpperCase()}`)
          .setThumbnail(message.author.displayAvatarURL({ dynamic: true, size: 256 }))
          .addFields(
            { name: "💰 Tài sản", value: `**${data.kcoin.toLocaleString()} Kcoin**`, inline: true },
            { name: "✨ Buff trang bị", value: `\`${buffText}\``, inline: true },
            { name: "🚀 Boost Cấp Số Nhân", value: isBoosted ? `Đang bật (Còn ${formatTimeLeft(data.boost_until - now)})` : "Không có", inline: false },
            { name: "📅 Cấp Tuần", value: `**Lv.${data.lvl_week}** (${data.xp_week.toLocaleString()}/${xpNeeded(data.lvl_week).toLocaleString()} XP)`, inline: true },
            { name: "🗓️ Cấp Tháng", value: `**Lv.${data.lvl_month}** (${data.xp_month.toLocaleString()}/${xpNeeded(data.lvl_month).toLocaleString()} XP)`, inline: true },
            { name: "📆 Cấp Năm (Chính)", value: `**Lv.${data.lvl_year}**\n\`[${progressBar}]\` (${Math.round((data.xp_year / xpNeeded(data.lvl_year)) * 100)}%)\n*Cần thêm: ${remainYear.toLocaleString()} XP*`, inline: false }
          );
        return message.reply({ embeds: [rankEmbed] });
      }

      if (cmd === "daily") {
        const data = await getLevel(id);
        if (now - data.daily_last < 86400000) return message.reply(`⏳ Đã nhận rồi, quay lại sau **${formatTimeLeft(86400000 - (now - data.daily_last))}**`);
        
        const isBoosted = data.boost_until > now;
        let baseKcoin = Math.floor(Math.random() * 101) + 100;
        let kcoinEarned = isBoosted ? baseKcoin * 2 : baseKcoin;
        
        let isJackpot = Math.random() < (isBoosted ? 0.002 : 0.001);
        if (isJackpot) kcoinEarned = 10000;

        data.kcoin += kcoinEarned;
        data.daily_last = now;
        await saveLevel(id, data);

        return message.reply(isJackpot ? `🎉 **JACKPOT ĐIÊN RỒ!!!** Bạn trúng **10,000 Kcoin**!` : `🎁 Điểm danh hằng ngày: **+${kcoinEarned} Kcoin**!`);
      }

      if (cmd === "cf" || cmd === "coinflip") {
        const bet = parseInt(args[0]);
        if (!bet || bet <= 0 || bet > 1000) return message.reply(`❌ Cược từ 1 - 1000 Kcoin. Dùng: \`${prefix}cf <tiền>\``);

        const data = await getLevel(id);
        if (data.kcoin < bet) return message.reply(`❌ Ví bạn chỉ có **${data.kcoin.toLocaleString()} Kcoin**.`);

        const buffs = await getEquipBuffs(id);
        const winMultiplier = 1 + (buffs.gamble / 100); 

        const isWin = Math.random() < 0.5;
        if (isWin) {
          const winAmount = Math.floor(bet * winMultiplier);
          data.kcoin += winAmount;
          await saveLevel(id, data);
          return message.reply(`🪙 Ngửa! Thắng **${(winAmount + bet).toLocaleString()} Kcoin** (Lời ${winAmount} - Tính cả buff ${buffs.gamble}%).`);
        } else {
          data.kcoin -= bet;
          await saveLevel(id, data);
          return message.reply(`🪙 Sấp! Thua **${bet.toLocaleString()} Kcoin**.`);
        }
      }

      if (cmd === "give") {
        const targetUser = message.mentions.users.first();
        const amount = parseInt(args[1]);
        
        // Đã sửa lại thông báo lỗi thành ${prefix}give thay vì pay
        if (!targetUser || !amount || amount <= 0 || targetUser.bot || targetUser.id === id) {
            return message.reply(`❌ Dùng: \`${prefix}give @user <số_tiền>\``);
        }

        const senderData = await getLevel(id);
        if (senderData.kcoin < amount) return message.reply("❌ Không đủ tiền!");

        const receiverData = await getLevel(targetUser.id);
        senderData.kcoin -= amount;
        receiverData.kcoin += amount;

        await saveLevel(id, senderData);
        await saveLevel(targetUser.id, receiverData);
        return message.reply(`💸 Chuyển thành công **${amount.toLocaleString()} Kcoin** cho <@${targetUser.id}>.`);
      }

      if (cmd === "top" || cmd === "lb") {
        const topEmbed = new EmbedBuilder().setTitle("🏆 BẢNG XẾP HẠNG").setColor("#ffd700");
        const buildTopText = async (rows, type) => {
          if (rows.length === 0) return "Chưa có ai.";
          let text = "";
          for (let i = 0; i < rows.length; i++) {
            let uname = "Unknown";
            try { uname = (await levelBot.users.fetch(rows[i].userid)).username; } catch {}
            if (type === "coin") text += `**${i + 1}.** ${uname} - **${rows[i].kcoin.toLocaleString()}** KC\n`;
            else text += `**${i + 1}.** ${uname} - Lv.${rows[i][`lvl_${type}`]}\n`;
          }
          return text;
        };

        const resWeek = await pool.query("SELECT * FROM levels ORDER BY lvl_week DESC, xp_week DESC LIMIT 10");
        const resMonth = await pool.query("SELECT * FROM levels ORDER BY lvl_month DESC, xp_month DESC LIMIT 10");
        const resYear = await pool.query("SELECT * FROM levels ORDER BY lvl_year DESC, xp_year DESC LIMIT 10");
        const resCoin = await pool.query("SELECT * FROM levels ORDER BY kcoin DESC LIMIT 10");

        topEmbed.addFields(
          { name: "📅 TOP TUẦN", value: await buildTopText(resWeek.rows, "week"), inline: true },
          { name: "🗓️ TOP THÁNG", value: await buildTopText(resMonth.rows, "month"), inline: true },
          { name: "📆 TOP NĂM", value: await buildTopText(resYear.rows, "year"), inline: true },
          { name: "💰 ĐẠI GIA KCOIN", value: await buildTopText(resCoin.rows, "coin"), inline: false }
        );
        return message.reply({ embeds: [topEmbed] });
      }

      return; // Dừng xử lý nếu đã dính vào block lệnh
    }

    // --- PHẦN B: CỘNG XP KHI CHAT TỰ ĐỘNG (Phần code bạn bị đứt đã được nối liền) ---
    if (content.length < 5) return;
    if (cooldown.has(id) && cooldown.get(id) > now) return; 
    
    cooldown.set(id, now + 15000); // 15s cooldown
    
    const data = await getLevel(id);
    const buffs = await getEquipBuffs(id); 
    const isBoosted = data.boost_until > now;

    const baseMult = isBoosted ? 2 : 1;
    const xpMultiplier = baseMult * (1 + (buffs.xp / 100));

    const finalXp = Math.floor((Math.floor(Math.random() * 91) + 10) * xpMultiplier);
    data.xp_week += finalXp; 
    data.xp_month += finalXp; 
    data.xp_year += finalXp;

    let leveledUp = false;
    let rankMsg = "";

    if (data.xp_week >= xpNeeded(data.lvl_week)) {
      data.xp_week -= xpNeeded(data.lvl_week);
      data.lvl_week++;
      leveledUp = true;
      rankMsg += `\n**Tuần:** Cấp ${data.lvl_week}`;
    }

    if (data.xp_month >= xpNeeded(data.lvl_month)) {
      data.xp_month -= xpNeeded(data.lvl_month);
      data.lvl_month++;
      leveledUp = true;
      rankMsg += `\n**Tháng:** Cấp ${data.lvl_month}`;
    }

    if (data.xp_year >= xpNeeded(data.lvl_year)) {
      data.xp_year -= xpNeeded(data.lvl_year);
      data.lvl_year++;
      leveledUp = true;
      rankMsg += `\n**Năm:** Cấp ${data.lvl_year}`;
    }

    const baseKcoinDrop = Math.floor(Math.random() * 20) + 1; 
    let kcoinMultiplier = baseMult; 
    let finalKcoinDrop = Math.floor(baseKcoinDrop * kcoinMultiplier);
    
    const jpChance = 0.001 * (1 + (buffs.jpChance / 100));
    if (Math.random() < jpChance) {
      const jpReward = 5000 + buffs.jpMoney; 
      finalKcoinDrop += jpReward;
      
      const jpEmbed = new EmbedBuilder()
        .setTitle("🎰 JACKPOT BẤT NGỜ!")
        .setDescription(`Chúc mừng <@${id}> đã trúng mánh khi đang chat và nhận được **${jpReward.toLocaleString()} Kcoin**!`)
        .setColor("#FFD700");
      await sendLvlNotify(message.guild, jpEmbed);
    }

    data.kcoin += finalKcoinDrop;

    await saveLevel(id, data);

    if (leveledUp) {
      const upEmbed = new EmbedBuilder()
        .setTitle("🎉 LÊN CẤP!")
        .setDescription(`Chúc mừng <@${id}> đã thăng cấp!${rankMsg}`)
        .setColor("#00FF00")
        .setThumbnail(message.author.displayAvatarURL({ dynamic: true }));
      await sendLvlNotify(message.guild, upEmbed);
    }
  });

  // --- PHẦN C: CỘNG XP KHI TREO VOICE ---
  const voiceTimers = new Map();

  levelBot.on("voiceStateUpdate", (oldState, newState) => {
    const userId = newState.id;

    if (!oldState.channelId && newState.channelId && !newState.selfDeaf && !newState.serverDeaf) {
      if (voiceTimers.has(userId)) clearInterval(voiceTimers.get(userId));
      
      const timer = setInterval(async () => {
        try {
          const data = await getLevel(userId);
          const buffs = await getEquipBuffs(userId);
          const isBoosted = data.boost_until > Date.now();
          
          const baseMult = isBoosted ? 2 : 1;
          const xpMultiplier = baseMult * (1 + (buffs.xp / 100));
          
          const voiceXp = Math.floor((Math.floor(Math.random() * 51) + 50) * xpMultiplier);
          
          data.xp_week += voiceXp;
          data.xp_month += voiceXp;
          data.xp_year += voiceXp;
          
          data.kcoin += Math.floor(10 * baseMult);

          await saveLevel(userId, data);
        } catch (err) {
          console.error("Lỗi cộng XP Voice:", err);
        }
      }, 300000);

      voiceTimers.set(userId, timer);
    }

    if ((oldState.channelId && !newState.channelId) || newState.selfDeaf || newState.serverDeaf) {
      if (voiceTimers.has(userId)) {
        clearInterval(voiceTimers.get(userId));
        voiceTimers.delete(userId);
      }
    }
  });

  levelBot.login(LEVEL_TOKEN);
}

startSystem();