require("dotenv").config();
const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder } = require("discord.js");
const { Pool } = require("pg");
const fishCooldown = new Map();
const cooldown = new Map();
const guildPrefixCache = new Map();
// ==========================================
// ===== DANH SÁCH 10 NHIỆM VỤ GỐC ==========
// ==========================================
const BASE_QUESTS = {
  "chat": { desc: "💬 Chat 50 tin nhắn", max: 50, rewardKC: 500 },
  "voice": { desc: "🎙️ Treo Voice 30 phút", max: 30, rewardKC: 500 },
  "fish": { desc: "🎣 Câu cá 5 lần", max: 5, rewardKC: 300 },
  "cf": { desc: "🪙 Chơi tung đồng xu 3 lần", max: 3, rewardKC: 200 },
  "cf_win": { desc: "🏆 Thắng tung đồng xu 2 lần", max: 2, rewardKC: 400 },
  "open_chest": { desc: "📦 Mở rương 3 lần", max: 3, rewardKC: 300 },
  "buy_shop": { desc: "🛒 Mua đồ trong Shop 2 lần", max: 2, rewardKC: 200 },
  "give": { desc: "🎁 Chuyển tiền hoặc đồ 1 lần", max: 1, rewardKC: 100 },
  "daily": { desc: "📅 Nhận thưởng Daily 1 lần", max: 1, rewardKC: 100 },
  "equip": { desc: "⚔️ Mặc/Tháo trang bị 1 lần", max: 1, rewardKC: 100 }
};
const QUEST_KEYS = Object.keys(BASE_QUESTS);
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
    
    // --- BẮT ĐẦU ĐOẠN FIX LỖI "CATCH" ---
    // Phải bọc lệnh kiểm tra bảng quests vào một khối try riêng biệt!
    try {
      await pool.query("SELECT active_quests FROM quests LIMIT 1");
    } catch (e) {
      // Nếu bảng chưa có hoặc sai cấu trúc, thì drop và tạo lại
      await pool.query("DROP TABLE IF EXISTS quests");
      await pool.query(`
        CREATE TABLE quests (
          userid TEXT PRIMARY KEY,
          active_quests TEXT,
          progress TEXT,
          claimed TEXT,
          all_claimed BOOLEAN DEFAULT false,
          last_reset BIGINT DEFAULT 0
        )
      `);
    }
    // --- KẾT THÚC ĐOẠN FIX LỖI ---

    // Load prefix vào cache (Khôi phục lại từ code cũ của bạn)
    const prefixes = await pool.query("SELECT guildid, prefix FROM guild_settings");
    prefixes.rows.forEach(r => guildPrefixCache.set(r.guildid, r.prefix));

    console.log("✅ Database đã sẵn sàng và tạo bảng thành công!");

  } catch (error) { // Bắt lỗi tổng nếu cả cái Database sập
    console.error("❌ Lỗi khởi tạo Database:", error.message);
  }
}
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
  try {
    let res = await pool.query("SELECT * FROM quests WHERE userid=$1", [id]);
    let needReset = false;
    let questData;

    if (res.rows.length === 0) {
      needReset = true;
    } else {
      questData = res.rows[0];
      if (now - parseInt(questData.last_reset) > 86400000) needReset = true;
    }

    // Nếu qua ngày mới hoặc user mới -> Random 3 nhiệm vụ
    if (needReset) {
      let shuffled = QUEST_KEYS.sort(() => 0.5 - Math.random());
      let active = shuffled.slice(0, 3);
      let progress = { [active[0]]: 0, [active[1]]: 0, [active[2]]: 0 };
      let claimed = { [active[0]]: false, [active[1]]: false, [active[2]]: false };
      
      questData = {
        userid: id,
        active_quests: JSON.stringify(active),
        progress: JSON.stringify(progress),
        claimed: JSON.stringify(claimed),
        all_claimed: false,
        last_reset: now
      };

      if (res.rows.length === 0) {
        await pool.query(
          "INSERT INTO quests (userid, active_quests, progress, claimed, all_claimed, last_reset) VALUES ($1, $2, $3, $4, $5, $6)",
          [id, questData.active_quests, questData.progress, questData.claimed, false, now]
        );
      } else {
        await saveQuest(id, questData);
      }
    }
    
    // Parse chuỗi JSON thành Object để dễ dùng
    return {
      ...questData,
      active_quests: typeof questData.active_quests === 'string' ? JSON.parse(questData.active_quests) : questData.active_quests,
      progress: typeof questData.progress === 'string' ? JSON.parse(questData.progress) : questData.progress,
      claimed: typeof questData.claimed === 'string' ? JSON.parse(questData.claimed) : questData.claimed
    };
  } catch (err) {
    console.error("Lỗi getQuest:", err);
    return null;
  }
}
async function saveQuest(id, data) {
  await pool.query(
    `UPDATE quests SET active_quests=$1, progress=$2, claimed=$3, all_claimed=$4, last_reset=$5 WHERE userid=$6`,
    [
      JSON.stringify(data.active_quests),
      JSON.stringify(data.progress),
      JSON.stringify(data.claimed),
      data.all_claimed,
      data.last_reset,
      id
    ]
  );
}

// Hàm mới: Dùng để cộng tiến độ nhiệm vụ ở bất kỳ đâu
async function updateQuestProgress(id, questKey, amount = 1) {
  const qData = await getQuest(id);
  if (!qData || qData.all_claimed) return; // Nếu lỗi hoặc đã xong hết thì bỏ qua
  
  if (qData.active_quests.includes(questKey)) {
    if (qData.progress[questKey] < BASE_QUESTS[questKey].max) {
      qData.progress[questKey] += amount;
      // Chốt chặn không cho vượt quá max
      if (qData.progress[questKey] > BASE_QUESTS[questKey].max) {
        qData.progress[questKey] = BASE_QUESTS[questKey].max;
      }
      await saveQuest(id, qData);
    }
  }
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
            { name: "🏆 Cày Cấp & Tiền", value: `\`${prefix}profile\` - Xem hồ sơ\n\`${prefix}cash\` - Xem tiền\n\`${prefix}top\` - Bảng xếp hạng\n\`${prefix}fish\` - Câu cá\n\`${prefix}daily\` - Nhận thưởng mỗi 24h\n\`${prefix}cf <tiền>\` - Chơi tung đồng xu\n\`${prefix}quest\` - Xem và nhận thưởng nhiệm vụ hằng ngày` },
            { name: "🛍️ Shop & Gacha", value: `\`${prefix}shop\` - Xem cửa hàng\n\`${prefix}buy <mã>\` - Mua vật phẩm\n\`${prefix}inv\` - Xem túi đồ\n\`${prefix}use <stt> [SL]\` - Mở rương gacha\n\`${prefix}equip <stt>\` - Mặc/tháo đồ\n\`${prefix}giveitem @user <stt>\` - Tặng đồ\n\`${prefix}give @user <tiền>\` - Chuyển Kcoin` },
            { name: "⚙️ Cài đặt", value: `\`${prefix}prefix <ký tự mới>\` - Đổi prefix\n\`${prefix}setchannel\` - Đặt kênh báo level` }
          )
          .setFooter({ text: "Tip: Chat hoặc treo Voice đều được nhận ngẫu nhiên XP & Kcoin nhé!" });
        return message.reply({ embeds: [helpEmbed] });
      }
// --- LỆNH CÂU CÁ (k!fish) ---
     if (cmd === "fish") {
        if (typeof fishCooldown === 'undefined') {
           return message.reply("⚠️ Lỗi: Chưa khai báo `fishCooldown` ở đầu file!");
        }

        if (fishCooldown.has(id)) {
          const expirationTime = fishCooldown.get(id) + 15000;
          if (now < expirationTime) {
            const timeLeft = ((expirationTime - now) / 1000).toFixed(1);
            return message.reply(`🎣 Cá chưa cắn mồi đâu! Thử lại sau **${timeLeft}s** nhé.`);
          }
        }

        // --- 1. KIỂM TRA MỒI CÂU TRONG TÚI ĐỒ ---
        const baitCheck = await pool.query("SELECT * FROM inventory WHERE userid=$1 AND item_name='Mồi Câu'", [id]);
        if (baitCheck.rows.length === 0 || baitCheck.rows[0].quantity < 1) {
            return message.reply("❌ Bạn không có **Mồi Câu**! Hãy ra chợ mua bằng lệnh `buy mồi câu` (Giá 10 KCoin/cái) nhé.");
        }

        // Trừ 1 Mồi Câu từ database
        await pool.query("UPDATE inventory SET quantity = quantity - 1 WHERE userid=$1 AND item_name='Mồi Câu'", [id]);

        // Đặt Cooldown sau khi đã chắc chắn có mồi và bắt đầu câu
        fishCooldown.set(id, now);

        // --- 2. ROLL TỈ LỆ (ĐÃ NERF ĐỒ NGON) ---
        const roll = Math.random() * 100;
        let rewardText = "";
        let kcoinReward = 0;
        let isBoost = false;

        // Tỉ lệ mới: 70% Rác | 24% Cá Thường | 4.5% Cá Hiếm | 1% Rương | 0.5% Boost
        if (roll < 70) { 
          const trashes = ["🥾 Chiếc giày rách", "🌿 Cụm rong biển", "🦴 Bộ xương cá", "🧴 Chai nhựa rỗng"];
          const item = trashes[Math.floor(Math.random() * trashes.length)];
          kcoinReward = Math.floor(Math.random() * 10) + 1; // 1-10 Kcoin (Lỗ vốn mua mồi)
          rewardText = `**${item}** và bán ve chai được **${kcoinReward} Kcoin** 🗑️`;
        } else if (roll < 94) { 
          const commons = ["🐟 Cá Rô Đồng", "🐠 Cá Chép", "🐡 Cá Nóc"];
          const item = commons[Math.floor(Math.random() * commons.length)];
          kcoinReward = Math.floor(Math.random() * 80) + 20; // 20-100 Kcoin (Có lời)
          rewardText = `**${item}** và bán được **${kcoinReward} Kcoin**! 💵`;
        } else if (roll < 98.5) { 
          const rares = ["🦈 Cá Mập Con", "🐬 Cá Heo Xanh", "🐢 Rùa Biển Trôi Dạt"];
          const item = rares[Math.floor(Math.random() * rares.length)];
          kcoinReward = Math.floor(Math.random() * 300) + 200; // 200-500 Kcoin
          rewardText = `**${item}** (Hiếm) và bán được tận **${kcoinReward} Kcoin**! ✨`;
        } else if (roll < 99.5) { 
          kcoinReward = Math.floor(Math.random() * 800) + 500; // 500-1300 Kcoin
          rewardText = `**📦 Rương Cũ Kỹ** dưới đáy biển! Mở ra nhận được **${kcoinReward.toLocaleString()} Kcoin**! 🎉`;
        } else { 
          isBoost = true;
          rewardText = `**🧪 Nước Tăng Lực** nổi trên mặt nước! Bạn được **Boost x2 XP** trong 10 phút! ⚡`;
        }

        const data = await getLevel(id);
        if (isBoost) {
          data.boost_until = Math.max(Date.now(), data.boost_until || 0) + 600000; // Cộng dồn 10 phút
        } else {
          data.kcoin += kcoinReward;
        }
	await updateQuestProgress(id, 'fish');
        await saveLevel(id, data);
        
        return message.reply(`🎣 Bạn móc 1 con mồi vào cần và quăng xuống nước...\n💦 Kéo lên! Bạn đã câu được ${rewardText}`);
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
   
      // --- Lệnh Xem Shop ---
      // --- Lệnh Xem Shop ---
      if (cmd === "shop") {
        const shopEmbed = new EmbedBuilder()
          .setTitle("🛒 Cửa Hàng Kcoin & Gacha")
          .setColor("#ff9900")
          .setDescription(`Dùng lệnh \`${prefix}buy <mã> [số_lượng]\` để mua vật phẩm.\n*Ví dụ: \`${prefix}buy r1 5\` (Mua 5 Rương I cùng lúc)*`)
          .addFields(
            { name: "🪱 Mồi Câu (Mã: `moi`) - 10 KC", value: "Bắt buộc phải có để dùng lệnh câu cá (`fish`)." },
            { name: "🔥 Thuốc Boost (Mã: `boost`) - 10,000 KC", value: "Nhân đôi X2 XP & Kcoin trong 1 giờ." },
            { name: "📦 Rương I (Mã: `r1`) - 1,000 KC", value: "Tỷ lệ: Bã mía 40%, Đồng 30%, Sắt 25%, Vàng 5%" },
            { name: "🧰 Rương II (Mã: `r2`) - 5,000 KC", value: "Tỷ lệ: Bã mía 20%, Đồng 35%, Sắt 30%, Vàng 10%, Kim Cương 5%" },
            { name: "💎 Rương III (Mã: `r3`) - 20,000 KC", value: "Tỷ lệ: Đồng 40%, Sắt 30%, Vàng 20%, Kim Cương 9.9%, Phượng Hoàng 0.1%" }
          )
          .setFooter({ text: "Mua càng nhiều càng ngonnn" });
        return message.reply({ embeds: [shopEmbed] });
      }

      // --- Lệnh Mua (Buy) ---
      // --- Lệnh Mua (Buy) ---
      if (cmd === "buy") {
        const itemCode = args[0]?.toLowerCase();
        
        // Lấy số lượng từ chữ thứ 2. Nếu người dùng không nhập số, mặc định là 1
        let amount = parseInt(args[1]);
        if (isNaN(amount)) amount = 1;
        
        // Chặn nhập số âm hoặc số 0, và giới hạn tối đa để tránh lỗi lag game
        if (amount <= 0) return message.reply("❌ Số lượng mua phải lớn hơn 0.");
        if (amount > 10000) return message.reply("❌ Đại gia từ từ thôi! Mỗi lần chỉ được mua tối đa 10,000 vật phẩm.");

        let unitCost = 0, itemName = "", itemType = "chest";

        // Phân loại vật phẩm dựa trên mã
        if (itemCode === "boost") { unitCost = 10000; itemName = "Thuốc Boost"; itemType = "boost"; }
        else if (itemCode === "r1") { unitCost = 1000; itemName = "Rương I"; }
        else if (itemCode === "r2") { unitCost = 5000; itemName = "Rương II"; }
        else if (itemCode === "r3") { unitCost = 20000; itemName = "Rương III"; }
        else if (itemCode === "moi" || itemCode === "mồi") { unitCost = 10; itemName = "Mồi Câu"; itemType = "consumable"; }
        else return message.reply(`❌ Mã vật phẩm sai. Gõ \`${prefix}shop\` để xem.`);

        const totalCost = unitCost * amount;
        const data = await getLevel(id);

        if (data.kcoin < totalCost) {
            return message.reply(`❌ Bạn không đủ tiền! Cần **${totalCost.toLocaleString()} Kcoin** để mua **${amount}x ${itemName}**. (Bạn đang có: ${data.kcoin.toLocaleString()})`);
        }
        
        // Trừ tiền
        data.kcoin -= totalCost;

        // Xử lý riêng nếu mua Thuốc Boost (Cộng dồn thời gian)
        if (itemType === "boost") {
          const boostDuration = 3600000 * amount; // 1 giờ (3,600,000 ms) x số lượng mua
          data.boost_until = Math.max(data.boost_until, now) + boostDuration;
          await saveLevel(id, data);
          return message.reply(`✅ Đại gia đã vung **${totalCost.toLocaleString()} Kcoin** mua **${amount} Thuốc Boost**! X2 XP & Kcoin kéo dài thêm **${amount} giờ**.`);
        } 
        
        // Xử lý cho Rương và Mồi Câu (Cộng dồn vào Inventory)
// Xử lý cho Rương và Mồi Câu (Cộng dồn vào Inventory)
        else {
          await saveLevel(id, data);
          
          const invCheck = await pool.query("SELECT id FROM inventory WHERE userid=$1 AND item_name=$2", [id, itemName]);
          if (invCheck.rows.length > 0) {
            // Đã có vật phẩm này -> Cập nhật cộng thêm số lượng
            await pool.query("UPDATE inventory SET quantity = quantity + $1 WHERE id=$2", [amount, invCheck.rows[0].id]);
          } else {
            // Chưa có vật phẩm -> Dùng lệnh INSERT để tạo mới
            await pool.query(
              "INSERT INTO inventory (userid, item_type, item_name, quantity) VALUES ($1, $2, $3, $4)", 
              [id, itemType, itemName, amount]
            );
          }

          // Cập nhật nhiệm vụ hàng ngày cho việc mua đồ (Nhớ thêm dòng này nè)
          await updateQuestProgress(id, 'buy_shop');

          // Thông báo cho người dùng biết mua thành công
          return message.reply(`🛍️ Chúc mừng! Bạn đã mua thành công **${amount}x ${itemName}** với giá **${totalCost.toLocaleString()} Kcoin**.`);
        }
      } // <--- Kết thúc lệnh buy

      // --- Lệnh Túi đồ (Inventory) ---
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
          
          // 1. Nếu là RƯƠNG
          if (item.item_type === 'chest') {
            desc += `**[${globalIndex}]** 📦 ${item.item_name} (x${item.quantity})\n`;
          } 
          // 2. Nếu là ĐỒ TIÊU HAO (Mồi câu) -> Thêm hiển thị số lượng
          else if (item.item_type === 'consumable') {
            desc += `**[${globalIndex}]** 🪱 ${item.item_name} (x${item.quantity})\n`;
          } 
          // 3. Nếu là TRANG BỊ
          else {
            const equipIcon = item.is_equipped ? "✅ " : "";
            desc += `**[${globalIndex}]** ${equipIcon}**${item.item_name}** [${item.set_name} - ${item.part}]\n`;
            desc += `└ *Buff: +${item.stat_xp}% XP, +${item.stat_jp_chance}% Tỉ lệ JP, +${item.stat_jp_money} Tiền JP, +${item.stat_gamble}% Cờ bạc*\n`;
          }
        });

        embed.setDescription(desc).setFooter({ text: `Trang ${page}/${totalPages} • Dùng ${prefix}use <stt> hoặc ${prefix}equip <stt>` });
        return message.reply({ embeds: [embed] });
      }

      // --- Lệnh Mở Rương (Use) ---
      // --- Lệnh Mở Rương (Use) ---
      if (cmd === "use") {
        const index = parseInt(args[0]) - 1;
        const amount = parseInt(args[1]) || 1;
        if (isNaN(index) || index < 0) return message.reply(`❌ Dùng: \`${prefix}use <STT_Trong_Túi> [số_lượng]\``);

        const invData = await pool.query("SELECT * FROM inventory WHERE userid=$1 ORDER BY item_type ASC, id ASC", [id]);
        const targetItem = invData.rows[index];

        if (!targetItem || targetItem.item_type !== 'chest') return message.reply("❌ Vật phẩm không tồn tại hoặc không phải là Rương.");
        if (targetItem.quantity < amount) return message.reply(`❌ Bạn chỉ có ${targetItem.quantity} rương này.`);

        // 1. Trừ rương khỏi túi TRƯỚC (để tránh lỗi phát sinh giữa chừng)
        if (targetItem.quantity === amount) {
          await pool.query("DELETE FROM inventory WHERE id=$1", [targetItem.id]);
        } else {
          await pool.query("UPDATE inventory SET quantity = quantity - $1 WHERE id=$2", [amount, targetItem.id]);
        }

        let openedText = "";

        // 2. Vòng lặp mở nhiều rương
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

          // LƯU Ý: TRANG BỊ KHÔNG CỘNG DỒN. Luôn luôn Insert dòng mới.
          // Tùy vào bảng inventory của bạn có những cột nào, hãy chỉnh lại đoạn [s_xp, s_jpC...] cho khớp với cấu trúc SQL của bạn nhé.
          await pool.query(
            "INSERT INTO inventory (userid, item_type, item_name, quantity, stat_xp, stat_jpc, stat_jpm, stat_gamble) VALUES ($1, 'equip', $2, 1, $3, $4, $5, $6)",
            [id, finalName, s_xp, s_jpC, s_jpM, s_gamble]
          );

          openedText += `🔹 **${finalName}** (XP: +${s_xp}% | JP Chance: +${s_jpC}%)\n`;
        } // <--- ĐÓNG NGOẶC VÒNG LẶP FOR Ở ĐÂY

        // 3. Cập nhật Quest "Mở rương" 1 LẦN DUY NHẤT ở ngoài vòng lặp
        await updateQuestProgress(id, 'open_chest', amount);

        // 4. Thông báo kết quả
        return message.reply(`🎉 Bạn đã mở **${amount}x ${targetItem.item_name}** và nhận được:\n${openedText}`);
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
	await updateQuestProgress(id, 'equip');
        return message.reply(`⚔️ Đã trang bị thành công **${targetItem.item_name}**!`);
      }

      // --- Lệnh Tặng đồ (Give Item) ---
     // --- Lệnh Tặng Đồ (Giveitem) ---
      if (cmd === "giveitem") { 
        const targetUser = message.mentions.users.first();
        const index = parseInt(args[1]) - 1;
        
        if (!targetUser || targetUser.bot) return message.reply(`❌ Dùng: \`${prefix}giveitem @user <STT>\``);
        if (isNaN(index) || index < 0) return message.reply("❌ Nhập đúng số thứ tự món đồ cần tặng.");

        // Lấy danh sách túi đồ của người gửi
        const invData = await pool.query("SELECT * FROM inventory WHERE userid=$1 ORDER BY item_type ASC, id ASC", [id]);
        const targetItem = invData.rows[index];

        if (!targetItem) return message.reply("❌ Không tìm thấy vật phẩm trong túi của bạn.");
        if (targetItem.is_equipped) return message.reply("❌ Hãy tháo trang bị ra trước khi đem đi cho người khác.");

        // PHÂN LOẠI 1: Nếu món đồ là Trang Bị (Mũ, Giáp, Quần...) -> KHÔNG STACK, chỉ đổi ID chủ sở hữu sang người nhận
        if (targetItem.item_type === 'equip') {
            await pool.query("UPDATE inventory SET userid=$1 WHERE id=$2", [targetUser.id, targetItem.id]);
        } 
        // PHÂN LOẠI 2: Nếu là đồ tiêu hao (Rương, Mồi, Khoáng sản...) -> DÙNG LOGIC STACK
        else {
            // 1. Trừ của người gửi (Nếu chỉ còn 1 cái thì xóa luôn dòng đó, nếu > 1 thì trừ đi 1)
            if (targetItem.quantity === 1) {
                await pool.query("DELETE FROM inventory WHERE id=$1", [targetItem.id]);
            } else {
                await pool.query("UPDATE inventory SET quantity = quantity - 1 WHERE id=$1", [targetItem.id]);
            }

            // 2. Kiểm tra và cộng dồn cho người nhận
            const receiverInv = await pool.query(
                "SELECT * FROM inventory WHERE userid=$1 AND item_name=$2",
                [targetUser.id, targetItem.item_name]
            );

            if (receiverInv.rows.length > 0) {
                // Đã có -> Cộng dồn số lượng thêm 1
                await pool.query("UPDATE inventory SET quantity = quantity + 1 WHERE id=$1", [receiverInv.rows[0].id]);
            } else {
                // Chưa có -> Tạo ô đồ mới cho người nhận
                await pool.query(
                    "INSERT INTO inventory (userid, item_type, item_name, quantity) VALUES ($1, $2, $3, $4)",
                    [targetUser.id, targetItem.item_type, targetItem.item_name, 1]
                );
            }
        }

        // Cập nhật Quest "Chuyển tiền hoặc đồ 1 lần" cho người gửi
        await updateQuestProgress(id, 'give');

        return message.reply(`🎁 Bạn đã chuyển thành công **1x ${targetItem.item_name}** cho <@${targetUser.id}>.`);
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

// --- SỬA ĐOẠN NÀY ---
if (cmd === "quest") {
  const qData = await getQuest(id);
  const uData = await getLevel(id);
  let replyMsg = "";
  let completedCount = 0;
  let updated = false;

  // 1. Kiểm tra và trao thưởng cho từng nhiệm vụ lẻ
  for (const key of qData.active_quests) {
    const qInfo = BASE_QUESTS[key];
    const currentProg = qData.progress[key];
    const isClaimed = qData.claimed[key];

    if (currentProg >= qInfo.max) {
      if (!isClaimed) {
        uData.kcoin += qInfo.rewardKC;
        qData.claimed[key] = true;
        replyMsg += `✅ Hoàn thành **${qInfo.desc}** -> Nhận **${qInfo.rewardKC} Kcoin**\n`;
        updated = true;
        completedCount++;
      } else {
        completedCount++;
      }
    }
  }

  // 2. Nếu xong cả 3 và chưa nhận Rương II
  if (completedCount === 3 && !qData.all_claimed) {
    const invCheck = await pool.query("SELECT * FROM inventory WHERE userid=$1 AND item_name='Rương II'", [id]);
    if (invCheck.rows.length > 0) {
      await pool.query("UPDATE inventory SET quantity = quantity + 1 WHERE id=$1", [invCheck.rows[0].id]);
    } else {
      await pool.query("INSERT INTO inventory (userid, item_type, item_name, quantity) VALUES ($1, 'chest', 'Rương II', 1)", [id]);
    }
    
    qData.all_claimed = true;
    updated = true;
    replyMsg += `\n🎉 **BINGO!** Bạn đã hoàn thành 3 nhiệm vụ ngày và nhận được **1x 🧰 Rương II**!\n`;
  }

  if (updated) {
    await saveLevel(id, uData);
    await saveQuest(id, qData);
    await message.reply(replyMsg);
  }

  // 3. Hiển thị Bảng nhiệm vụ (Embed)
  const qEmbed = new EmbedBuilder()
    .setTitle("📜 Bảng Nhiệm Vụ Hằng Ngày")
    .setColor("#00FF00")
    .setDescription("Hoàn thành cả 3 nhiệm vụ ngẫu nhiên dưới đây để nhận phần thưởng đặc biệt: **1x 🧰 Rương II**");

  for (let i = 0; i < qData.active_quests.length; i++) {
    const key = qData.active_quests[i];
    const qInfo = BASE_QUESTS[key];
    const prog = qData.progress[key];
    const isClaimed = qData.claimed[key];
    
    const statusIcon = isClaimed ? "✅ Đã nhận" : (prog >= qInfo.max ? "🎁 Gõ lệnh lại để nhận" : "⏳ Chưa xong");
    qEmbed.addFields({
      name: `Nhiệm vụ ${i + 1}: ${qInfo.desc}`,
      value: `Tiến độ: **${prog}/${qInfo.max}** - [${statusIcon}]`
    });
  }

  return message.channel.send({ embeds: [qEmbed] });
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
	await updateQuestProgress(id, 'daily');
        return message.reply(replyMsg);
	
      }

    // --- Lệnh Chơi Cờ Bạc (Coinflip) ---
      if (cmd === "cf" || cmd === "coinflip") {
        const bet = parseInt(args[0]);
        if (!bet || bet <= 0 || bet > 5000) return message.reply(`❌ Cược không hợp lệ. Chỉ nhận từ 1 - 5000 Kcoin. Dùng: \`${prefix}cf <tiền>\``);

        const data = await getLevel(id);
        if (data.kcoin < bet) return message.reply(`❌ Ví bạn không đủ tiền. Bạn chỉ có **${data.kcoin.toLocaleString()} Kcoin**.`);

        // 1. TRỪ TIỀN NGAY LẬP TỨC để chống bug spam
        data.kcoin -= bet;

        const buffs = await getEquipBuffs(id);
        const winMultiplier = 1 + (buffs.gamble / 100); 

        const isWin = Math.random() < 0.5;
        
        if (isWin) {
          // 2. Thắng: Trả lại tiền gốc (bet) + Tiền lời (profit)
          const profit = Math.floor(bet * winMultiplier);
          const totalReturn = bet + profit; 
          
          data.kcoin += totalReturn; 
          await saveLevel(id, data);
          await updateQuestProgress(id, 'cf_win');
          return message.reply(`🪙 **NGỬA!** Bạn thắng **${totalReturn.toLocaleString()} Kcoin**\n*(Gồm ${bet.toLocaleString()} gốc + ${profit.toLocaleString()} lời nhờ buff +${buffs.gamble}% cờ bạc)*`);
        } else {
          // 3. Thua: Đã trừ tiền ở bước 1 rồi, chỉ cần lưu vào Database
          await saveLevel(id, data);
          return message.reply(`🪙 **SẤP!** Bạn đã thua mất **${bet.toLocaleString()} Kcoin**. Đừng nản chí, ngã ở đâu gấp đôi ở đó!`);
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
	await updateQuestProgress(id, 'give');
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
updateQuestProgress(userId, 'chat');
    
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
        updateQuestProgress(userId, 'voice');

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