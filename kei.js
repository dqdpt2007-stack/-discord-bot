require("dotenv").config();
const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder } = require("discord.js");
const { Pool } = require("pg");

const cooldown = new Map();
const guildPrefixCache = new Map();

// ==========================================
// ===== 1. KIỂM TRA MÔI TRƯỜNG (ENV) =======
// ==========================================
if (!process.env.DISCORD_TOKEN_LVL) {
  console.error("❌ Thiếu DISCORD_TOKEN_LVL trong file .env");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("❌ Thiếu DATABASE_URL trong file .env");
  process.exit(1);
}

const DEFAULT_LEVEL_PREFIX = "lvl!";
const LEVEL_TOKEN = process.env.DISCORD_TOKEN_LVL;

// ==========================================
// ===== 2. CẤU HÌNH DATABASE ===============
// ==========================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ==========================================
// ===== 3. CÁC HÀM HỖ TRỢ (HELPERS) ========
// ==========================================
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

async function getPrefix(guildId) {
  if (guildPrefixCache.has(guildId)) return guildPrefixCache.get(guildId);
  const res = await pool.query("SELECT prefix FROM guild_settings WHERE guildid=$1", [guildId]);
  const prefix = res.rows[0]?.prefix || DEFAULT_LEVEL_PREFIX;
  guildPrefixCache.set(guildId, prefix);
  return prefix;
}

async function sendLvlNotify(guild, embed) {
  try {
    const res = await pool.query("SELECT lvl_channel FROM guild_settings WHERE guildid=$1", [guild.id]);
    const channelId = res.rows[0]?.lvl_channel;
    if (!channelId) return;

    const channel = guild.channels.cache.get(channelId);
    if (channel) await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error(`❌ Lỗi gửi thông báo level tại guild ${guild.id}:`, err);
  }
}

// ==========================================
// ===== 4. DATABASE FUNCTIONS ==============
// ==========================================
async function initDB() {
  try {
    console.log("⏳ Đang kết nối và khởi tạo Database...");
    
    // Bảng Levels
    await pool.query(`
      CREATE TABLE IF NOT EXISTS levels (
        userid TEXT PRIMARY KEY,
        xp_week INT DEFAULT 0, lvl_week INT DEFAULT 1,
        xp_month INT DEFAULT 0, lvl_month INT DEFAULT 1,
        xp_year INT DEFAULT 0, lvl_year INT DEFAULT 1,
        kcoin INT DEFAULT 0, boost_until BIGINT DEFAULT 0, daily_last BIGINT DEFAULT 0
      )
    `);
    
    // Bảng Cài đặt Server
    await pool.query(`
      CREATE TABLE IF NOT EXISTS guild_settings (
        guildid TEXT PRIMARY KEY,
        lvl_channel TEXT,
        prefix TEXT DEFAULT 'lvl!'
      )
    `);

    // Fix thiếu cột prefix nếu database cũ đã có
    await pool.query(`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS prefix TEXT DEFAULT 'lvl!';`).catch(() => {});

    // Bảng Túi đồ (Inventory)
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

    // Bảng Phần thưởng
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rewards (
        id SERIAL PRIMARY KEY,
        userid TEXT,
        reward TEXT
      )
    `);
    
    // Bảng Nhiệm vụ (Quests)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quests (
        userid TEXT PRIMARY KEY,
        chat_count INT DEFAULT 0,
        voice_mins INT DEFAULT 0,
        chat_claimed BOOLEAN DEFAULT false,
        voice_claimed BOOLEAN DEFAULT false,
        last_reset BIGINT DEFAULT 0
      )
    `);

    // Load prefix vào cache
    const prefixes = await pool.query("SELECT guildid, prefix FROM guild_settings");
    prefixes.rows.forEach(r => guildPrefixCache.set(r.guildid, r.prefix));

    console.log("✅ Database đã sẵn sàng và tạo bảng thành công!");
  } catch (error) {
    console.error("❌ Lỗi khởi tạo Database:", error.message);
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

// Hàm lấy & cập nhật nhiệm vụ (Reset sau 24h)
async function getQuest(id) {
  const now = Date.now();
  let res = await pool.query("SELECT * FROM quests WHERE userid=$1", [id]);
  
  if (res.rows.length === 0) {
    await pool.query("INSERT INTO quests (userid, last_reset) VALUES ($1, $2)", [id, now]);
    return { chat_count: 0, voice_mins: 0, chat_claimed: false, voice_claimed: false, last_reset: now };
  }

  let questData = res.rows[0];
  // Reset nhiệm vụ nếu đã qua 24h (86400000 ms)
  if (now - questData.last_reset > 86400000) {
    questData = { chat_count: 0, voice_mins: 0, chat_claimed: false, voice_claimed: false, last_reset: now };
    await saveQuest(id, questData);
  }
  return questData;
}

async function saveQuest(id, data) {
  await pool.query(
    `UPDATE quests SET chat_count=$1, voice_mins=$2, chat_claimed=$3, voice_claimed=$4, last_reset=$5 WHERE userid=$6`,
    [data.chat_count, data.voice_mins, data.chat_claimed, data.voice_claimed, data.last_reset, id]
  );
}

// ==========================================
// ===== 5. BẮT ĐẦU BOT LEVEL ===============
// ==========================================
async function startLevelBot() {
  await initDB();

  const levelBot = new Client({
    intents: [ 
      GatewayIntentBits.Guilds, 
      GatewayIntentBits.GuildMessages, 
      GatewayIntentBits.GuildVoiceStates, 
      GatewayIntentBits.MessageContent 
    ]
  });

  levelBot.once("ready", () => console.log(`📈 Level bot online: ${levelBot.user.tag}`));

  // ==========================================
  // ===== XỬ LÝ TIN NHẮN CHAT (COMMAND & XP) =
  // ==========================================
  levelBot.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;

    const id = message.author.id;
    const now = Date.now();
    const content = message.content.trim();

    // Bỏ qua lệnh của AI bot khác để tránh xung đột
    if (content.startsWith("^") || content.startsWith("!!")) return;

    const prefix = await getPrefix(message.guild.id);

    // ----------------------------------------
    // PHẦN A: XỬ LÝ LỆNH (COMMANDS)
    // ----------------------------------------
    if (content.startsWith(prefix)) {
      const args = content.slice(prefix.length).trim().split(/ +/);
      const cmd = args.shift().toLowerCase();

      // --- Lệnh Help ---
      if (cmd === "help") {
        const helpEmbed = new EmbedBuilder()
          .setTitle("📚 Danh Sách Lệnh Level Bot")
          .setColor("#5865F2")
          .setDescription(`Prefix hiện tại của server là: **${prefix}**`)
          .addFields(
            { name: "🏆 Cày Cấp & Tiền", value: `\`${prefix}profile\` - Xem hồ sơ\n\`${prefix}cash\` - Xem tiền\n\`${prefix}top\` - Bảng xếp hạng\n\`${prefix}daily\` - Nhận thưởng mỗi 24h\n\`${prefix}cf <tiền>\` - Chơi tung đồng xu\n\`${prefix}quest\` - Xem và nhận thưởng nhiệm vụ hằng ngày` },
            { name: "🛍️ Shop & Gacha", value: `\`${prefix}shop\` - Xem cửa hàng\n\`${prefix}buy <mã>\` - Mua vật phẩm\n\`${prefix}inv\` - Xem túi đồ\n\`${prefix}use <stt> [SL]\` - Mở rương gacha\n\`${prefix}equip <stt>\` - Mặc/tháo đồ\n\`${prefix}giveitem @user <stt>\` - Tặng đồ\n\`${prefix}give @user <tiền>\` - Chuyển Kcoin` },
            { name: "⚙️ Cài đặt", value: `\`${prefix}prefix <ký tự mới>\` - Đổi prefix\n\`${prefix}setchannel\` - Đặt kênh báo level` }
          )
          .setFooter({ text: "Tip: Chat hoặc treo Voice đều được nhận ngẫu nhiên XP & Kcoin nhé!" });
        return message.reply({ embeds: [helpEmbed] });
      }

      // --- Lệnh Đổi Prefix ---
      if (cmd === "prefix") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return message.reply("❌ Bạn cần quyền Quản lý Server (Manage Guild) để đổi prefix.");
        }
        const newPrefix = args[0];
        if (!newPrefix) return message.reply(`Prefix hiện tại: **${prefix}**. Để đổi: \`${prefix}prefix <ký_tự_mới>\``);
        
        await pool.query(
          "INSERT INTO guild_settings (guildid, prefix) VALUES ($1, $2) ON CONFLICT (guildid) DO UPDATE SET prefix = $2",
          [message.guild.id, newPrefix]
        );
        guildPrefixCache.set(message.guild.id, newPrefix);
        return message.reply(`✅ Đã đổi prefix của server thành: **${newPrefix}**`);
      }

      // --- Lệnh Setup Channel ---
      if (cmd === "channel" || cmd === "setchannel") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return message.reply("❌ Bạn cần quyền Manage Guild.");
        }
        const channel = message.mentions.channels.first() || message.channel;
        await pool.query("INSERT INTO guild_settings (guildid, lvl_channel) VALUES ($1, $2) ON CONFLICT (guildid) DO UPDATE SET lvl_channel = $2", [message.guild.id, channel.id]);
        return message.reply(`✅ Đã đặt kênh thông báo lên level tại: ${channel}`);
      }
// ==========================================
    // --- LỆNH CÂU CÁ (k!fish) ---
    // ==========================================
    if (cmd === "fish")) {
      const now = Date.now();
      
      // Kiểm tra hồi chiêu (15 giây)
      if (fishCooldown.has(id)) {
        const expirationTime = fishCooldown.get(id) + 15000;
        if (now < expirationTime) {
          const timeLeft = ((expirationTime - now) / 1000).toFixed(1);
          return message.reply(`🎣 Cá chưa cắn mồi đâu! Thử lại sau **${timeLeft}s** nữa nhé.`);
        }
      }
      fishCooldown.set(id, now); // Lưu thời gian quăng cần

      const roll = Math.random() * 100;
      let rewardText = "";
      let kcoinReward = 0;
      let isBoost = false;

      // 60% Câu trúng Rác (Giá bèo nhèo)
      if (roll < 60) {
        const trashes = [
          { name: "🥾 Chiếc giày rách", min: 1, max: 10 },
          { name: "🌿 Cụm rong biển", min: 2, max: 8 },
          { name: "🦴 Bộ xương cá", min: 1, max: 5 },
          { name: "🧴 Chai nhựa rỗng", min: 2, max: 10 }
        ];
        const item = trashes[Math.floor(Math.random() * trashes.length)];
        kcoinReward = Math.floor(Math.random() * (item.max - item.min + 1)) + item.min;
        rewardText = `**${item.name}** và bán ve chai được **${kcoinReward} Kcoin** 🗑️`;
      } 
      // 25% Câu trúng Cá Thường
      else if (roll < 85) {
        const commons = [
          { name: "🐟 Cá Rô Đồng", min: 30, max: 80 },
          { name: "🐠 Cá Chép", min: 50, max: 120 },
          { name: "🐡 Cá Nóc", min: 80, max: 150 }
        ];
        const item = commons[Math.floor(Math.random() * commons.length)];
        kcoinReward = Math.floor(Math.random() * (item.max - item.min + 1)) + item.min;
        rewardText = `**${item.name}** và bán được **${kcoinReward} Kcoin**! 💵`;
      }
      // 5% Câu trúng Cá Hiếm
      else if (roll < 90) {
        const rares = [
          { name: "🦈 Cá Mập Con", min: 300, max: 600 },
          { name: "🐬 Cá Heo Xanh", min: 400, max: 800 }
        ];
        const item = rares[Math.floor(Math.random() * rares.length)];
        kcoinReward = Math.floor(Math.random() * (item.max - item.min + 1)) + item.min;
        rewardText = `**${item.name}** (Siêu Hiếm) và bán được tận **${kcoinReward} Kcoin**! ✨`;
      }
      // 5% Câu trúng Rương (Mở ra tiền)
      else if (roll < 95) {
        const chests = [
          { name: "📦 Rương Cũ Kỹ", min: 1000, max: 2000 },
          { name: "💎 Rương Bạc", min: 2000, max: 4000 }
        ];
        const item = chests[Math.floor(Math.random() * chests.length)];
        kcoinReward = Math.floor(Math.random() * (item.max - item.min + 1)) + item.min;
        rewardText = `**${item.name}**! Mở ra nhận được **${kcoinReward} Kcoin**! 🎉`;
      }
      // 5% Câu trúng Nước Tăng Lực (Boost XP)
      else {
        isBoost = true;
        rewardText = `**🧪 Nước Tăng Lực Bò Húc**! Cả người bừng sức mạnh, bạn được **Boost x2 XP** trong 10 phút! ⚡`;
      }

      // Xử lý lưu Database
      const data = await getLevel(id);
      
      if (isBoost) {
        const tenMins = 10 * 60 * 1000;
        // Đảm bảo nếu đang có boost từ trước thì cộng dồn thời gian
        data.boost_until = Math.max(Date.now(), data.boost_until || 0) + tenMins; 
      } else {
        data.kcoin += kcoinReward;
      }

      await saveLevel(id, data);

      return message.reply(`🎣 Bạn quăng cần xuống nước...\n💦 Kéo lên! Bạn đã câu được ${rewardText}`);
    }

      // --- Lệnh Xem Shop ---
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

      // --- Lệnh Mua (Buy) ---
      if (cmd === "buy") {
        const data = await getLevel(id);
        const itemCode = args[0]?.toLowerCase();
        let cost = 0, itemName = "";

        if (itemCode === "boost") { cost = 10000; itemName = "Thuốc Boost"; }
        else if (itemCode === "r1") { cost = 1000; itemName = "Rương I"; }
        else if (itemCode === "r2") { cost = 5000; itemName = "Rương II"; }
        else if (itemCode === "r3") { cost = 20000; itemName = "Rương III"; }
        else return message.reply(`❌ Mã vật phẩm sai. Gõ \`${prefix}shop\` để xem.`);

        if (data.kcoin < cost) return message.reply(`❌ Bạn không đủ tiền! Cần **${cost.toLocaleString()} Kcoin**.`);
        
        data.kcoin -= cost;
        await saveLevel(id, data);

        if (itemCode === "boost") {
          data.boost_until = Math.max(data.boost_until, now) + 3600000; // Cộng 1 giờ
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

      // --- Lệnh Túi đồ (Inventory) ---
      if (cmd === "inv" || cmd === "inventory") {
        const invData = await pool.query("SELECT * FROM inventory WHERE userid=$1 ORDER BY item_type ASC, id ASC", [id]);
        if (invData.rows.length === 0) return message.reply("🎒 Túi đồ của bạn trống rỗng.");

        const page = parseInt(args[0]) || 1;
        const limit = 10;
        const totalPages = Math.ceil(invData.rows.length / limit);
        if (page < 1 || page > totalPages) return message.reply(`❌ Trang không hợp lệ. Tổng số trang: ${totalPages}`);

        const start = (page - 1) * limit;
        const items = invData.rows.slice(start, start + limit);

        const embed = new EmbedBuilder()
            .setTitle(`🎒 Túi Đồ Của ${message.author.username}`)
            .setColor("#8A2BE2");
        
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

      // --- Lệnh Mở Rương (Use) ---
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
            // Rương III
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

        // Trừ rương khỏi túi
        if (targetItem.quantity === amount) {
          await pool.query("DELETE FROM inventory WHERE id=$1", [targetItem.id]);
        } else {
          await pool.query("UPDATE inventory SET quantity = quantity - $1 WHERE id=$2", [amount, targetItem.id]);
        }

        return message.reply(`🎉 Bạn đã mở **${amount} ${targetItem.item_name}** và nhận được:\n${openedText}`);
      }

      // --- Lệnh Trang bị (Equip) ---
      if (cmd === "equip") {
        const index = parseInt(args[0]) - 1;
        if (isNaN(index) || index < 0) return message.reply(`❌ Dùng: \`${prefix}equip <STT_Trong_Túi>\``);

        const invData = await pool.query("SELECT * FROM inventory WHERE userid=$1 ORDER BY item_type ASC, id ASC", [id]);
        const targetItem = invData.rows[index];

        if (!targetItem || targetItem.item_type !== 'equip') return message.reply("❌ Vật phẩm không phải trang bị.");
        
        if (targetItem.is_equipped) {
          await pool.query("UPDATE inventory SET is_equipped=false WHERE id=$1", [targetItem.id]);
          return message.reply(`Đã tháo **${targetItem.item_name}** ra khỏi người.`);
        }

        // Tháo trang bị cũ cùng slot
        await pool.query("UPDATE inventory SET is_equipped=false WHERE userid=$1 AND part=$2", [id, targetItem.part]);
        // Mặc trang bị mới
        await pool.query("UPDATE inventory SET is_equipped=true WHERE id=$1", [targetItem.id]);
        return message.reply(`⚔️ Đã trang bị thành công **${targetItem.item_name}**!`);
      }

      // --- Lệnh Tặng đồ (Give Item) ---
      if (cmd === "giveitem") { 
        const targetUser = message.mentions.users.first();
        const index = parseInt(args[1]) - 1;
        
        if (!targetUser || targetUser.bot) return message.reply(`❌ Dùng: \`${prefix}giveitem @user <STT>\``);
        if (isNaN(index) || index < 0) return message.reply("❌ Nhập đúng số thứ tự món đồ cần tặng.");

        const invData = await pool.query("SELECT * FROM inventory WHERE userid=$1 ORDER BY item_type ASC, id ASC", [id]);
        const targetItem = invData.rows[index];

        if (!targetItem) return message.reply("❌ Không tìm thấy vật phẩm trong túi của bạn.");
        if (targetItem.is_equipped) return message.reply("❌ Hãy tháo trang bị ra trước khi đem đi cho người khác.");

        if (targetItem.item_type === 'chest') {
          if (targetItem.quantity === 1) {
              await pool.query("UPDATE inventory SET userid=$1 WHERE id=$2", [targetUser.id, targetItem.id]);
          } else {
            await pool.query("UPDATE inventory SET quantity = quantity - 1 WHERE id=$1", [targetItem.id]);
            const check = await pool.query("SELECT * FROM inventory WHERE userid=$1 AND item_name=$2", [targetUser.id, targetItem.item_name]);
            if (check.rows.length > 0) {
                await pool.query("UPDATE inventory SET quantity = quantity + 1 WHERE id=$1", [check.rows[0].id]);
            } else {
                await pool.query("INSERT INTO inventory (userid, item_type, item_name, quantity) VALUES ($1, 'chest', $2, 1)", [targetUser.id, targetItem.item_name]);
            }
          }
        } else {
          // Là trang bị
          await pool.query("UPDATE inventory SET userid=$1 WHERE id=$2", [targetUser.id, targetItem.id]);
        }
        return message.reply(`🎁 Bạn đã tặng **${targetItem.item_name}** cho <@${targetUser.id}> thành công!`);
      }

      // --- Lệnh Xem Tiền (Cash) ---
      if (cmd === "cash" || cmd === "bal" || cmd === "balance" || cmd === "money") {
        const data = await getLevel(id);
        const embed = new EmbedBuilder()
          .setColor("#FFD700")
          .setDescription(`💰 **${message.author.username}**, bạn đang có **${data.kcoin.toLocaleString()} Kcoin** trong ví.`);
        return message.reply({ embeds: [embed] });
      }

      // --- Lệnh Xem Hồ Sơ (Profile / Rank) ---
      // --- Lệnh Xem Hồ Sơ (Profile / Rank) ---
      if ( cmd === "profile") {
        const data = await getLevel(id);
        const buffs = await getEquipBuffs(id);
        const isBoosted = data.boost_until > now;
        
        // Lấy danh sách phần thưởng/danh hiệu từ Database
        const rewardRes = await pool.query("SELECT reward FROM rewards WHERE userid=$1", [id]);
        let rewardText = "Chưa có danh hiệu/phần thưởng nào";
        if (rewardRes.rows.length > 0) {
          rewardText = rewardRes.rows.map(r => `🏅 ${r.reward}`).join("\n");
        }

        const remainYear = xpNeeded(data.lvl_year) - data.xp_year;
        const progress = Math.min(Math.floor((data.xp_year / xpNeeded(data.lvl_year)) * 10), 10);
        const progressBar = "▰".repeat(progress) + "▱".repeat(10 - progress);

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
            { name: "🏆 Danh Hiệu & Phần Thưởng", value: rewardText, inline: false },
            { name: "📅 Cấp Tuần", value: `**Lv.${data.lvl_week}** (${data.xp_week.toLocaleString()}/${xpNeeded(data.lvl_week).toLocaleString()} XP)`, inline: true },
            { name: "🗓️ Cấp Tháng", value: `**Lv.${data.lvl_month}** (${data.xp_month.toLocaleString()}/${xpNeeded(data.lvl_month).toLocaleString()} XP)`, inline: true },
            { name: "📆 Cấp Năm (Chính)", value: `**Lv.${data.lvl_year}**\n\`[${progressBar}]\` (${Math.round((data.xp_year / xpNeeded(data.lvl_year)) * 100)}%)\n*Cần thêm: ${remainYear.toLocaleString()} XP*`, inline: false }
          );
        return message.reply({ embeds: [rankEmbed] });
      }
if (cmd === "addreward") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return message.reply("❌ Bạn cần quyền Quản lý Server (Manage Guild) để trao phần thưởng.");
        }
        
        const targetUser = message.mentions.users.first();
        // Lấy toàn bộ chữ phía sau mention làm tên phần thưởng
        const rewardName = args.slice(1).join(" "); 
        
        if (!targetUser || !rewardName) {
            return message.reply(`❌ Dùng sai cú pháp. Mẫu: \`${prefix}addreward @user <Tên phần thưởng>\``);
        }
        
        await pool.query("INSERT INTO rewards (userid, reward) VALUES ($1, $2)", [targetUser.id, rewardName]);
        return message.reply(`✅ Tuyệt vời! Bạn đã trao danh hiệu **"${rewardName}"** cho <@${targetUser.id}>. Bảo họ check \`${prefix}profile\` đi nào!`);
      }

      // --- Lệnh Xóa Phần Thưởng (Admin Only) ---
      if (cmd === "delreward") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return message.reply("❌ Bạn cần quyền Quản lý Server.");
        }
        const targetUser = message.mentions.users.first();
        if (!targetUser) return message.reply(`❌ Dùng sai cú pháp. Mẫu: \`${prefix}delreward @user\` (Lệnh này sẽ xoá TOÀN BỘ danh hiệu của user đó).`);

        await pool.query("DELETE FROM rewards WHERE userid=$1", [targetUser.id]);
        return message.reply(`🗑️ Đã thu hồi toàn bộ danh hiệu của <@${targetUser.id}>.`);
      }

      // --- Lệnh Nhiệm Vụ (Quest) ---
      if (cmd === "quest" ) {
        const qData = await getQuest(id);
        const uData = await getLevel(id);
        let replyMsg = "";

        // Kiểm tra và nhận thưởng Chat
        if (qData.chat_count >= 50 && !qData.chat_claimed) {
            uData.kcoin += 1000;
            qData.chat_claimed = true;
            replyMsg += "✅ Bạn đã hoàn thành **Chat 50 tin nhắn** và nhận được **1,000 Kcoin**!\n";
        }
        
        // Kiểm tra và nhận thưởng Voice
        if (qData.voice_mins >= 30 && !qData.voice_claimed) {
            const invCheck = await pool.query("SELECT * FROM inventory WHERE userid=$1 AND item_name='Rương I'", [id]);
            if (invCheck.rows.length > 0) {
              await pool.query("UPDATE inventory SET quantity = quantity + 1 WHERE id=$1", [invCheck.rows[0].id]);
            } else {
              await pool.query("INSERT INTO inventory (userid, item_type, item_name, quantity) VALUES ($1, 'chest', 'Rương I', 1)");
            }
            qData.voice_claimed = true;
            replyMsg += "✅ Bạn đã hoàn thành **Treo Voice 30 phút** và nhận được **1x 📦 Rương I**!\n";
        }

        if (replyMsg !== "") {
            await saveLevel(id, uData);
            await saveQuest(id, qData);
            return message.reply(`🎉 **CHÚC MỪNG!**\n${replyMsg}`);
        }

        // Hiển thị tiến độ nếu chưa nhận thưởng
        const chatProg = Math.min(qData.chat_count, 50);
        const voiceProg = Math.min(qData.voice_mins, 30);
        
        const qEmbed = new EmbedBuilder()
          .setTitle("📜 Bảng Nhiệm Vụ Hằng Ngày")
          .setColor("#3498DB")
          .setDescription("Hoàn thành nhiệm vụ để nhận phần thưởng hấp dẫn! (Reset sau 24h)")
          .addFields(
            { name: "💬 Chat 50 lần", value: `Tiến độ: **${chatProg}/50** ${qData.chat_claimed ? "✅ (Đã nhận)" : "🎁 *Thưởng: 1,000 Kcoin*"}` },
            { name: "🎙️ Voice 30 phút", value: `Tiến độ: **${voiceProg}/30** ${qData.voice_claimed ? "✅ (Đã nhận)" : "🎁 *Thưởng: 1x Rương I*"}` }
          )
          .setFooter({ text: `Gõ ${prefix}quest để nhận thưởng khi đầy thanh tiến độ!` });

        return message.reply({ embeds: [qEmbed] });
      }

      // --- Lệnh Nhận Thưởng Ngày (Daily) ---
      if (cmd === "daily") {
        const data = await getLevel(id);
        if (now - data.daily_last < 86400000) {
            return message.reply(`⏳ Bạn đã nhận rồi, vui lòng quay lại sau **${formatTimeLeft(86400000 - (now - data.daily_last))}** nữa.`);
        }
        
        const isBoosted = data.boost_until > now;
        let baseKcoin = Math.floor(Math.random() * 101) + 100;
        let kcoinEarned = isBoosted ? baseKcoin * 2 : baseKcoin;
        let replyMsg = "";

        const roll = Math.random(); 
        
        if (roll < 0.00001) { // 0.001%
            kcoinEarned = 10000;
            replyMsg = `🎉 **JACKPOT ĐIÊN RỒ (0.001%)!!!** Bạn trúng ngay **10,000 Kcoin**!`;
        } else if (roll < 0.01) { // 1%
            kcoinEarned = 500;
            replyMsg = `✨ **MAY MẮN (1%)!** Bạn vừa nhận được **500 Kcoin**!`;
        } else {
            replyMsg = `🎁 Điểm danh hằng ngày thành công: **+${kcoinEarned} Kcoin**!`;
        }

        data.kcoin += kcoinEarned;
        data.daily_last = now;
        await saveLevel(id, data);

        return message.reply(replyMsg);
      }

      // --- Lệnh Chơi Cờ Bạc (Coinflip) ---
      if (cmd === "cf" || cmd === "coinflip") {
        const bet = parseInt(args[0]);
        if (!bet || bet <= 0 || bet > 5000) return message.reply(`❌ Cược không hợp lệ. Chỉ nhận từ 1 - 5000 Kcoin. Dùng: \`${prefix}cf <tiền>\``);

        const data = await getLevel(id);
        if (data.kcoin < bet) return message.reply(`❌ Ví bạn không đủ tiền. Bạn chỉ có **${data.kcoin.toLocaleString()} Kcoin**.`);

        const buffs = await getEquipBuffs(id);
        const winMultiplier = 1 + (buffs.gamble / 100); 

        const isWin = Math.random() < 0.5;
        if (isWin) {
          const winAmount = Math.floor(bet * winMultiplier);
          data.kcoin += winAmount;
          await saveLevel(id, data);
          return message.reply(`🪙 Ngửa! Bạn thắng **${(winAmount + bet).toLocaleString()} Kcoin** (Tiền lời: ${winAmount} - Tính cả buff ${buffs.gamble}%).`);
        } else {
          data.kcoin -= bet;
          await saveLevel(id, data);
          return message.reply(`🪙 Sấp! Bạn đã thua mất **${bet.toLocaleString()} Kcoin**.`);
        }
      }

      // --- Lệnh Chuyển Tiền (Give) ---
      if (cmd === "give") {
        const targetUser = message.mentions.users.first();
        const amount = parseInt(args[1]);
        
        if (!targetUser || !amount || amount <= 0 || targetUser.bot || targetUser.id === id) {
            return message.reply(`❌ Dùng lệnh sai. Cú pháp: \`${prefix}give @user <số_tiền>\``);
        }

        const senderData = await getLevel(id);
        if (senderData.kcoin < amount) return message.reply("❌ Bạn không có đủ tiền để chuyển!");

        const receiverData = await getLevel(targetUser.id);
        senderData.kcoin -= amount;
        receiverData.kcoin += amount;

        await saveLevel(id, senderData);
        await saveLevel(targetUser.id, receiverData);
        return message.reply(`💸 Bạn đã chuyển thành công **${amount.toLocaleString()} Kcoin** cho <@${targetUser.id}>.`);
      }

      // --- Lệnh Bảng Xếp Hạng (Leaderboard) ---
      if (cmd === "top" || cmd === "lb") {
        const topEmbed = new EmbedBuilder().setTitle("🏆 BẢNG XẾP HẠNG SERVER").setColor("#ffd700");
        
        const buildTopText = async (rows, type) => {
          if (rows.length === 0) return "Chưa có dữ liệu.";
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

      return; // Xong phần Command, dừng lại không tính đoạn chat lệnh vào XP
    }

    // ----------------------------------------
    // PHẦN B: TỰ ĐỘNG CỘNG XP KHI CHAT TỰ NHIÊN
    // ----------------------------------------
    if (content.length < 5) return; // Tin nhắn quá ngắn không tính XP
    if (cooldown.has(id) && cooldown.get(id) > now) return; 
    
    cooldown.set(id, now + 15000); // 15s cooldown (Chống Spam)
    
    const data = await getLevel(id);
    const buffs = await getEquipBuffs(id); 
    const isBoosted = data.boost_until > now;

    const baseMult = isBoosted ? 2 : 1;
    const xpMultiplier = baseMult * (1 + (buffs.xp / 100));

    // Random từ 10 - 100 XP
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
      rankMsg += `\n**Tuần:** Lên Cấp ${data.lvl_week}`;
    }

    if (data.xp_month >= xpNeeded(data.lvl_month)) {
      data.xp_month -= xpNeeded(data.lvl_month);
      data.lvl_month++;
      leveledUp = true;
      rankMsg += `\n**Tháng:** Lên Cấp ${data.lvl_month}`;
    }

    if (data.xp_year >= xpNeeded(data.lvl_year)) {
      data.xp_year -= xpNeeded(data.lvl_year);
      data.lvl_year++;
      leveledUp = true;
      rankMsg += `\n**Năm:** Lên Cấp ${data.lvl_year}`;
    }

    // --- Quest: Tích luỹ số lần chat ---
    const qData = await getQuest(id);
    if (!qData.chat_claimed && qData.chat_count < 50) {
      qData.chat_count++;
      await saveQuest(id, qData);
    }

    // --- Tiền Kcoin rớt ra & Logic Jackpot ---
    const baseKcoinDrop = Math.floor(Math.random() * 20) + 1; 
    let finalKcoinDrop = Math.floor(baseKcoinDrop * baseMult);
    
    const jpMultiplier = 1 + (buffs.jpChance / 100); 
    const roll = Math.random();

    let jpReward = 0;
    let jpTitle = "";

    if (roll < 0.00001 * jpMultiplier) { // 0.001%
      jpReward = 10000 + buffs.jpMoney; 
      jpTitle = "🎰 JACKPOT ĐIÊN RỒ (0.001%)!";
    } else if (roll < 0.01 * jpMultiplier) { // 1%
      jpReward = 500;
      jpTitle = "✨ MAY MẮN RỚT TIỀN (1%)!";
    }

    if (jpReward > 0) {
      finalKcoinDrop += jpReward;
      const jpEmbed = new EmbedBuilder()
        .setTitle(jpTitle)
        .setDescription(`Chúc mừng <@${id}> đang chat thì nhặt được **${jpReward.toLocaleString()} Kcoin**!`)
        .setColor(jpReward >= 10000 ? "#FFD700" : "#00FF00");
      await sendLvlNotify(message.guild, jpEmbed);
    }

    data.kcoin += finalKcoinDrop;
    await saveLevel(id, data);

    // Gửi thông báo nếu lên cấp
    if (leveledUp) {
      const upEmbed = new EmbedBuilder()
        .setTitle("🎉 LÊN CẤP!")
        .setDescription(`Chúc mừng <@${id}> đã thăng cấp!${rankMsg}`)
        .setColor("#00FF00")
        .setThumbnail(message.author.displayAvatarURL({ dynamic: true }));
      await sendLvlNotify(message.guild, upEmbed);
    }
  });

  // ==========================================
  // ==========================================
  // ===== PHẦN C: CỘNG XP KHI TREO VOICE =====
  // ==========================================
  const voiceTimers = new Map();

  // 1. TẠO HÀM DÙNG CHUNG ĐỂ CỘNG XP VOICE
  function startVoiceTimer(userId, guild) {
    // Nếu đang có bộ đếm cũ thì xoá đi để tránh bị nhân đôi thời gian
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

        // --- Quest: Tích luỹ thời gian Voice (Mỗi phút) ---
        const qData = await getQuest(userId);
        if (!qData.voice_claimed && qData.voice_mins < 30) {
          qData.voice_mins++;
          await saveQuest(userId, qData);
        }

        // --- Tiền rớt Voice & Logic Jackpot ---
        let finalKcoinDrop = Math.floor(10 * baseMult);
        
        const jpMultiplier = 1 + (buffs.jpChance / 100);
        const roll = Math.random();

        let jpReward = 0;
        let jpTitle = "";

        if (roll < 0.00001 * jpMultiplier) { // 0.001%
          jpReward = 10000 + buffs.jpMoney; 
          jpTitle = "🎰 JACKPOT TỪ VOICE (0.001%)!";
        } else if (roll < 0.01 * jpMultiplier) { // 1%
          jpReward = 500;
          jpTitle = "✨ LỘC TRỜI CHO (1%)!";
        }

        if (jpReward > 0) {
          finalKcoinDrop += jpReward;
          const jpEmbed = new EmbedBuilder()
            .setTitle(jpTitle)
            .setDescription(`Chúc mừng <@${userId}> đang rôm rả trong Voice thì rớt trúng **${jpReward.toLocaleString()} Kcoin**!`)
            .setColor(jpReward >= 10000 ? "#FFD700" : "#00FF00");
          await sendLvlNotify(guild, jpEmbed);
        }

        data.kcoin += finalKcoinDrop;

        let leveledUp = false;
        let rankMsg = "";

        if (data.xp_week >= xpNeeded(data.lvl_week)) {
          data.xp_week -= xpNeeded(data.lvl_week);
          data.lvl_week++;
          leveledUp = true;
          rankMsg += `\n**Tuần:** Lên Cấp ${data.lvl_week}`;
        }

        if (data.xp_month >= xpNeeded(data.lvl_month)) {
          data.xp_month -= xpNeeded(data.lvl_month);
          data.lvl_month++;
          leveledUp = true;
          rankMsg += `\n**Tháng:** Lên Cấp ${data.lvl_month}`;
        }

        if (data.xp_year >= xpNeeded(data.lvl_year)) {
          data.xp_year -= xpNeeded(data.lvl_year);
          data.lvl_year++;
          leveledUp = true;
          rankMsg += `\n**Năm:** Lên Cấp ${data.lvl_year}`;
        }

        await saveLevel(userId, data);

        if (leveledUp) {
          const upEmbed = new EmbedBuilder()
            .setTitle("🎉 LÊN CẤP TỪ VOICE!")
            .setDescription(`Chúc mừng <@${userId}> đã thăng cấp khi đang đàm đạo!${rankMsg}`)
            .setColor("#00FF00");
          await sendLvlNotify(guild, upEmbed);
        }
      } catch (err) {
        console.error(`Lỗi tính XP Voice cho ${userId}:`, err);
      }
    }, 60000);

    // Chỗ này hồi nãy bạn bị lỡ tay xoá mất đoạn đuôi nè:
    voiceTimers.set(userId, timer);
  } // <--- Kết thúc hàm startVoiceTimer

  // 2. TỰ ĐỘNG QUÉT VOICE KHI BOT VỪA RESTART
  levelBot.once("ready", () => {
    let restoredCount = 0;
    // Lặp qua tất cả server bot tham gia
    levelBot.guilds.cache.forEach(guild => {
      // Lặp qua tất cả các thành viên đang ở trong Voice
      guild.voiceStates.cache.forEach(voiceState => {
        if (voiceState.member?.user?.bot) return;

        // Check xem họ có đang bật mic đàng hoàng không
        const isValid = voiceState.channelId 
          && !voiceState.selfDeaf && !voiceState.serverDeaf 
          && !voiceState.selfMute && !voiceState.serverMute;

        if (isValid) {
          startVoiceTimer(voiceState.id, guild);
          restoredCount++;
        }
      });
    });
    if (restoredCount > 0) {
      console.log(`🔄 Đã quét và tự động khôi phục cày Voice cho ${restoredCount} người dùng!`);
    }
  });

  // 3. XỬ LÝ KHI CÓ NGƯỜI VÀO/RA/TẮT MIC (HOẠT ĐỘNG BÌNH THƯỜNG)
  levelBot.on("voiceStateUpdate", (oldState, newState) => {
    const userId = newState.id;
    if (newState.member?.user?.bot) return;

    const isValidNow = newState.channelId 
      && !newState.selfDeaf && !newState.serverDeaf 
      && !newState.selfMute && !newState.serverMute;

    const wasValidBefore = oldState.channelId 
      && !oldState.selfDeaf && !oldState.serverDeaf 
      && !oldState.selfMute && !oldState.serverMute;

    // KỊCH BẢN 1: Bắt đầu tính giờ (nhảy vào kênh hoặc vừa bật lại mic)
    if (isValidNow && !wasValidBefore) {
      startVoiceTimer(userId, newState.guild);
    } 
    // KỊCH BẢN 2: Dừng tính giờ (out kênh, tắt mic, hoặc điếc)
    else if (!isValidNow && wasValidBefore) {
      if (voiceTimers.has(userId)) {
        clearInterval(voiceTimers.get(userId));
        voiceTimers.delete(userId);
      }
    }
  });

  // Khởi động bot
  levelBot.login(LEVEL_TOKEN);
} // <--- Ngoặc đóng siêu quan trọng của hàm startLevelBot

// Bắt đầu chạy hệ thống
startLevelBot();