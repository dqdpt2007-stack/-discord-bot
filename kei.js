require("dotenv").config();
const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder } = require("discord.js");
const { Pool } = require("pg");

const fishCooldown = new Map();
const cooldown = new Map();
const guildPrefixCache = new Map();
const voiceTimers = new Map(); // Khai báo Map để quản lý treo voice

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

if (!process.env.DISCORD_TOKEN_LVL || !process.env.DATABASE_URL) {
  console.error("❌ Thiếu Token hoặc Database URL trong .env");
  process.exit(1);
}

const DEFAULT_LEVEL_PREFIX = "lvl!";
const LEVEL_TOKEN = process.env.DISCORD_TOKEN_LVL;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- HELPERS ---
function xpNeeded(level) {
  const rawXp = 50 * Math.pow(level, 1.5) + 50 * level;
  return Math.round(rawXp / 10) * 10;
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

// --- DATABASE INIT ---
async function initDB() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS levels (userid TEXT PRIMARY KEY, xp_week INT DEFAULT 0, lvl_week INT DEFAULT 1, xp_month INT DEFAULT 0, lvl_month INT DEFAULT 1, xp_year INT DEFAULT 0, lvl_year INT DEFAULT 1, kcoin INT DEFAULT 0, boost_until BIGINT DEFAULT 0, daily_last BIGINT DEFAULT 0)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS guild_settings (guildid TEXT PRIMARY KEY, lvl_channel TEXT, prefix TEXT DEFAULT 'lvl!')`);
    await pool.query(`CREATE TABLE IF NOT EXISTS inventory (id SERIAL PRIMARY KEY, userid TEXT, item_type TEXT, item_name TEXT, quantity INT DEFAULT 1, part TEXT, set_name TEXT, stat_xp INT DEFAULT 0, stat_jp_chance INT DEFAULT 0, stat_jp_money INT DEFAULT 0, stat_gamble INT DEFAULT 0, is_equipped BOOLEAN DEFAULT false)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS quests (userid TEXT PRIMARY KEY, active_quests TEXT, progress TEXT, claimed TEXT, all_claimed BOOLEAN DEFAULT false, last_reset BIGINT DEFAULT 0)`);
    console.log("✅ Database Ready!");
  } catch (err) { console.error("❌ DB Init Error:", err); }
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
  await pool.query(`UPDATE levels SET xp_week=$1, lvl_week=$2, xp_month=$3, lvl_month=$4, xp_year=$5, lvl_year=$6, kcoin=$7, boost_until=$8, daily_last=$9 WHERE userid=$10`,
    [data.xp_week, data.lvl_week, data.xp_month, data.lvl_month, data.xp_year, data.lvl_year, data.kcoin, data.boost_until, data.daily_last, id]);
}

// --- QUEST HELPERS ---
async function getQuest(id) {
  const res = await pool.query("SELECT * FROM quests WHERE userid=$1", [id]);
  const now = Date.now();
  const today = new Date().setHours(0,0,0,0);

  if (res.rows.length === 0 || parseInt(res.rows[0].last_reset) < today) {
    const shuffled = [...QUEST_KEYS].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, 5).join(",");
    const initialProgress = {};
    shuffled.slice(0, 5).forEach(k => initialProgress[k] = 0);
    
    const newData = { userid: id, active_quests: selected, progress: JSON.stringify(initialProgress), claimed: "[]", all_claimed: false, last_reset: now };
    await pool.query(`INSERT INTO quests (userid, active_quests, progress, claimed, all_claimed, last_reset) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (userid) DO UPDATE SET active_quests=$2, progress=$3, claimed=$4, all_claimed=$5, last_reset=$6`,
      [id, selected, newData.progress, "[]", false, now]);
    
    return { ...newData, progress: initialProgress, claimed: [] };
  }
  const row = res.rows[0];
  return { ...row, progress: JSON.parse(row.progress), claimed: JSON.parse(row.claimed) };
}

async function saveQuest(id, data) {
  await pool.query(`UPDATE quests SET progress=$1, claimed=$2, all_claimed=$3 WHERE userid=$4`,
    [JSON.stringify(data.progress), JSON.stringify(data.claimed), data.all_claimed, id]);
}

async function updateQuestProgress(id, questKey, amount = 1) {
  const qData = await getQuest(id);
  if (qData.all_claimed) return;
  const activeList = qData.active_quests.split(",");
  if (activeList.includes(questKey)) {
    qData.progress[questKey] = Math.min(BASE_QUESTS[questKey].max, (qData.progress[questKey] || 0) + amount);
    await saveQuest(id, qData);
  }
}

async function getEquipBuffs(id) {
  const res = await pool.query("SELECT SUM(stat_xp) as sxp, SUM(stat_jp_chance) as sjpc, SUM(stat_jp_money) as sjpm, SUM(stat_gamble) as sgam FROM inventory WHERE userid=$1 AND is_equipped=true", [id]);
  const r = res.rows[0];
  return {
    xp: parseInt(r.sxp) || 0,
    jp_chance: parseInt(r.sjpc) || 0,
    jp_money: parseInt(r.sjpm) || 0,
    gamble: parseInt(r.sgam) || 0
  };
}

async function startLevelBot() {
  await initDB();
  const levelBot = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.MessageContent]
  });

  levelBot.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;
    const id = message.author.id;
    const prefix = await getPrefix(message.guild.id);

    // --- CỘNG XP CHAT (FIX: Chuyển lên trước để chat không prefix vẫn được cộng) ---
    if (!message.content.startsWith(prefix)) {
      const data = await getLevel(id);
      const now = Date.now();
      if (!cooldown.has(id) || now - cooldown.get(id) > 15000) {
        cooldown.set(id, now);
        const buffs = await getEquipBuffs(id);
        const isBoosted = now < parseInt(data.boost_until);
        const baseXP = randInt(15, 25);
        const xpAdd = Math.round(baseXP * (isBoosted ? 2 : 1) * (1 + buffs.xp / 100));
        
        data.xp_week += xpAdd;
        data.xp_month += xpAdd;
        data.xp_year += xpAdd;
        data.kcoin += randInt(1, 3);

        const checkLevelUp = (xp, lvl) => {
          let l = lvl, x = xp;
          while (x >= xpNeeded(l)) { x -= xpNeeded(l); l++; }
          return { x, l };
        };

        const week = checkLevelUp(data.xp_week, data.lvl_week);
        data.xp_week = week.x; data.lvl_week = week.l;
        const month = checkLevelUp(data.xp_month, data.lvl_month);
        data.xp_month = month.x; data.lvl_month = month.l;
        const year = checkLevelUp(data.xp_year, data.lvl_year);
        data.xp_year = year.x; data.lvl_year = year.l;

        await saveLevel(id, data);
        await updateQuestProgress(id, "chat");
      }
      return;
    }

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();

    // --- LỆNH MUA (BUY) ---
    if (cmd === "buy") {
      const itemCode = args[0]?.toLowerCase();
      let amount = parseInt(args[1]) || 1;
      if (amount <= 0) return message.reply("❌ Số lượng phải lớn hơn 0.");

      let unitCost = 0, itemName = "", itemType = "chest";
      if (itemCode === "boost") { unitCost = 10000; itemName = "Thuốc Boost"; itemType = "boost"; }
      else if (itemCode === "r1") { unitCost = 1000; itemName = "Rương I"; }
      else if (itemCode === "r2") { unitCost = 5000; itemName = "Rương II"; }
      else if (itemCode === "r3") { unitCost = 20000; itemName = "Rương III"; }
      else if (itemCode === "moi") { unitCost = 10; itemName = "Mồi Câu"; itemType = "consumable"; }
      else return message.reply("❌ Mã vật phẩm không tồn tại (boost, r1, r2, r3, moi).");

      const data = await getLevel(id);
      const totalCost = unitCost * amount;
      if (data.kcoin < totalCost) return message.reply(`❌ Bạn thiếu ${totalCost - data.kcoin} Kcoin.`);

      data.kcoin -= totalCost;
      await saveLevel(id, data);

      if (itemType === "boost") {
        const currentBoost = parseInt(data.boost_until) > Date.now() ? parseInt(data.boost_until) : Date.now();
        data.boost_until = currentBoost + (amount * 3600000);
        await saveLevel(id, data);
      } else {
        // FIX: Kiểm tra và cộng vào túi đồ, nếu chưa có thì INSERT
        const invCheck = await pool.query("SELECT id FROM inventory WHERE userid=$1 AND item_name=$2", [id, itemName]);
        if (invCheck.rows.length > 0) {
          await pool.query("UPDATE inventory SET quantity = quantity + $1 WHERE id=$2", [amount, invCheck.rows[0].id]);
        } else {
          await pool.query("INSERT INTO inventory (userid, item_type, item_name, quantity, is_equipped) VALUES ($1, $2, $3, $4, false)", [id, itemType, itemName, amount]);
        }
      }
      await updateQuestProgress(id, "buy_shop", 1);
      return message.reply(`✅ Bạn đã mua **${amount}x ${itemName}** thành công!`);
    }
// --- LỆNH TÚI ĐỒ (INVENTORY) ---
    if (cmd === "inv" || cmd === "inventory") {
      const invData = await pool.query("SELECT * FROM inventory WHERE userid=$1 ORDER BY item_type ASC, id ASC", [id]);
      if (invData.rows.length === 0) return message.reply("🎒 Túi đồ của bạn đang trống rỗng.");

      const page = parseInt(args[0]) || 1;
      const limit = 10;
      const totalPages = Math.ceil(invData.rows.length / limit);
      if (page < 1 || page > totalPages) return message.reply(`❌ Trang không hợp lệ (1-${totalPages}).`);

      const start = (page - 1) * limit;
      const items = invData.rows.slice(start, start + limit);

      const embed = new EmbedBuilder()
        .setTitle(`🎒 Túi Đồ Của ${message.author.username}`)
        .setColor("#8A2BE2")
        .setThumbnail(message.author.displayAvatarURL());

      let desc = "";
      items.forEach((item, index) => {
        const globalIndex = start + index + 1;
        if (item.item_type === 'chest' || item.item_type === 'consumable') {
          desc += `**[${globalIndex}]** ${item.item_type === 'chest' ? '📦' : '🪱'} **${item.item_name}** (x${item.quantity})\n`;
        } else {
          const eq = item.is_equipped ? "✅ " : "";
          desc += `**[${globalIndex}]** ${eq}**${item.item_name}** [${item.set_name}]\n`;
          desc += `└ *Buff: +${item.stat_xp}% XP, +${item.stat_jp_chance}% JP, +${item.stat_jp_money} KC JP*\n`;
        }
      });

      embed.setDescription(desc || "Trang này không có vật phẩm.");
      embed.setFooter({ text: `Trang ${page}/${totalPages} | Dùng ${prefix}use <stt> hoặc ${prefix}equip <stt>` });
      return message.reply({ embeds: [embed] });
    }

    // --- LỆNH MỞ RƯƠNG (USE) ---
    if (cmd === "use") {
      const index = parseInt(args[0]) - 1;
      const amount = parseInt(args[1]) || 1;
      if (isNaN(index) || index < 0) return message.reply(`❌ Cú pháp: \`${prefix}use <STT> [số lượng]\``);

      const invData = await pool.query("SELECT * FROM inventory WHERE userid=$1 ORDER BY item_type ASC, id ASC", [id]);
      const target = invData.rows[index];

      if (!target || target.item_type !== 'chest') return message.reply("❌ STT này không phải là Rương.");
      if (target.quantity < amount) return message.reply(`❌ Bạn chỉ có ${target.quantity} rương này.`);

      // Trừ rương
      if (target.quantity === amount) await pool.query("DELETE FROM inventory WHERE id=$1", [target.id]);
      else await pool.query("UPDATE inventory SET quantity = quantity - $1 WHERE id=$2", [amount, target.id]);

      let resultText = "";
      for (let i = 0; i < amount; i++) {
        const rand = Math.random() * 100;
        let setName = "Bã mía";
        if (target.item_name === 'Rương I') {
          if (rand > 40 && rand <= 70) setName = 'Đồng';
          else if (rand > 70 && rand <= 95) setName = 'Sắt';
          else if (rand > 95) setName = 'Vàng';
        } else if (target.item_name === 'Rương II') {
          if (rand > 20 && rand <= 55) setName = 'Đồng';
          else if (rand > 55 && rand <= 85) setName = 'Sắt';
          else if (rand > 85 && rand <= 95) setName = 'Vàng';
          else if (rand > 95) setName = 'Kim Cương';
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
        let s_xp = randInt(1, 10), s_jpC = 0, s_jpM = 0, s_gamble = 0;

        if (setName === 'Vàng') { s_xp = randInt(25, 35); s_jpC = randInt(2, 5); }
        else if (setName === 'Kim Cương') { s_xp = randInt(40, 60); s_jpC = randInt(3, 5); s_jpM = randInt(50, 100); }
        else if (setName === 'Phượng Hoàng') { s_xp = randInt(80, 100); s_jpC = randInt(7, 10); s_jpM = randInt(200, 500); s_gamble = randInt(1, 5); }

        await pool.query(
          "INSERT INTO inventory (userid, item_type, item_name, quantity, stat_xp, stat_jp_chance, stat_jp_money, stat_gamble, part, set_name, is_equipped) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false)",
          [id, 'equip', finalName, 1, s_xp, s_jpC, s_jpM, s_gamble, part, setName]
        );
        resultText += `✨ **${finalName}**\n`;
      } // ĐÃ THÊM DẤU ĐÓNG NGOẶC FOR Ở ĐÂY

      await updateQuestProgress(id, 'open_chest', amount);
      return message.reply(`📦 Bạn đã mở **${amount} rương** và nhận được:\n${resultText.length > 1800 ? resultText.slice(0, 1800) + "..." : resultText}`);
    }

    // --- LỆNH MẶC ĐỒ (EQUIP) ---
    if (cmd === "equip") {
      const index = parseInt(args[0]) - 1;
      const invData = await pool.query("SELECT * FROM inventory WHERE userid=$1 ORDER BY item_type ASC, id ASC", [id]);
      const target = invData.rows[index];

      if (!target || target.item_type !== 'equip') return message.reply("❌ STT không hợp lệ hoặc không phải trang bị.");

      if (target.is_equipped) {
        await pool.query("UPDATE inventory SET is_equipped = false WHERE id=$1", [target.id]);
        return message.reply(`🛡️ Bạn đã tháo **${target.item_name}**.`);
      } else {
        // Tháo món cùng loại (ví dụ tháo Mũ cũ để mặc Mũ mới)
        await pool.query("UPDATE inventory SET is_equipped = false WHERE userid=$1 AND part=$2", [id, target.part]);
        await pool.query("UPDATE inventory SET is_equipped = true WHERE id=$1", [target.id]);
        await updateQuestProgress(id, 'equip');
        return message.reply(`⚔️ Bạn đã mặc **${target.item_name}**.`);
      }
    }

    // --- LỆNH CÂU CÁ (FISH) ---
    if (cmd === "fish" || cmd === "câu") {
      const now = Date.now();
      if (fishCooldown.has(id) && now < fishCooldown.get(id)) {
        const remain = Math.ceil((fishCooldown.get(id) - now) / 1000);
        return message.reply(`⏳ Bạn đang thay mồi, vui lòng đợi ${remain}s.`);
      }

      const invMoi = await pool.query("SELECT id, quantity FROM inventory WHERE userid=$1 AND item_name='Mồi Câu'", [id]);
      if (invMoi.rows.length === 0 || invMoi.rows[0].quantity <= 0) return message.reply("❌ Bạn không có mồi câu. Hãy mua tại shop!");

      // Trừ mồi
      if (invMoi.rows[0].quantity === 1) await pool.query("DELETE FROM inventory WHERE id=$1", [invMoi.rows[0].id]);
      else await pool.query("UPDATE inventory SET quantity = quantity - 1 WHERE id=$1", [invMoi.rows[0].id]);

      fishCooldown.set(id, now + 30000); // 30s cooldown

      const win = Math.random() < 0.6;
      if (win) {
        const kc = randInt(20, 100);
        const data = await getLevel(id);
        data.kcoin += kc;
        await saveLevel(id, data);
        await updateQuestProgress(id, 'fish');
        return message.reply(`🎣 Bạn đã câu được một con cá lớn! Nhận ngay **${kc} Kcoin**.`);
      } else {
        return message.reply("🌊 Cá đã đớp mồi nhưng bạn kéo hụt rồi!");
      }
    }
// --- LỆNH CHUYỂN TIỀN (GIVE) ---
    if (cmd === "give") {
      const targetUser = message.mentions.users.first();
      const amount = parseInt(args[1]);
      if (!targetUser || isNaN(amount) || amount <= 0) return message.reply(`❌ Cú pháp: \`${prefix}give @user <số tiền>\``);
      if (targetUser.id === id) return message.reply("❌ Bạn không thể tự chuyển cho chính mình.");

      const senderData = await getLevel(id);
      if (senderData.kcoin < amount) return message.reply("❌ Bạn không đủ Kcoin.");

      const receiverData = await getLevel(targetUser.id);
      senderData.kcoin -= amount;
      receiverData.kcoin += amount;

      await saveLevel(id, senderData);
      await saveLevel(targetUser.id, receiverData);
      await updateQuestProgress(id, 'give');

      return message.reply(`✅ Bạn đã chuyển **${amount} Kcoin** cho ${targetUser.username}.`);
    }

    // --- LỆNH CHUYỂN VẬT PHẨM (GIVEITEM) ---
    if (cmd === "giveitem") {
      const targetUser = message.mentions.users.first();
      const index = parseInt(args[1]) - 1;
      if (!targetUser || isNaN(index)) return message.reply(`❌ Cú pháp: \`${prefix}giveitem @user <STT_Túi_Đồ>\``);

      const invData = await pool.query("SELECT * FROM inventory WHERE userid=$1 ORDER BY item_type ASC, id ASC", [id]);
      const targetItem = invData.rows[index];

      if (!targetItem) return message.reply("❌ STT vật phẩm không hợp lệ.");
      if (targetItem.is_equipped) return message.reply("❌ Hãy tháo trang bị trước khi tặng.");

      // Xử lý chuyển
      await pool.query("UPDATE inventory SET userid=$1, is_equipped=false WHERE id=$2", [targetUser.id, targetItem.id]);
      await updateQuestProgress(id, 'give');
      return message.reply(`🎁 Bạn đã tặng **${targetItem.item_name}** cho ${targetUser.username}.`);
    }

    // --- LỆNH THƯỞNG HẰNG NGÀY (DAILY) ---
    if (cmd === "daily") {
      const data = await getLevel(id);
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000;

      if (now - parseInt(data.daily_last) < oneDay) {
        const wait = oneDay - (now - parseInt(data.daily_last));
        const hours = Math.floor(wait / (1000 * 60 * 60));
        const mins = Math.floor((wait % (1000 * 60 * 60)) / (1000 * 60));
        return message.reply(`⏳ Bạn đã nhận rồi. Hãy quay lại sau **${hours} giờ ${mins} phút**.`);
      }

      const reward = randInt(200, 500);
      data.kcoin += reward;
      data.daily_last = now;
      await saveLevel(id, data);
      await updateQuestProgress(id, 'daily');
      return message.reply(`📅 Bạn đã nhận thưởng hằng ngày: **${reward} Kcoin**.`);
    }

    // --- LỆNH THÔNG TIN (PROFILE) ---
    if (cmd === "p" || cmd === "profile" || cmd === "me") {
      const target = message.mentions.users.first() || message.author;
      const data = await getLevel(target.id);
      const buffs = await getEquipBuffs(target.id);
      const isBoosted = Date.now() < parseInt(data.boost_until);

      const embed = new EmbedBuilder()
        .setTitle(`📊 Hồ Sơ: ${target.username}`)
        .setThumbnail(target.displayAvatarURL())
        .setColor(isBoosted ? "#FF4500" : "#00AE86")
        .addFields(
          { name: "💰 Kcoin", value: `**${data.kcoin.toLocaleString()}**`, inline: true },
          { name: "⚡ Trạng Thái", value: isBoosted ? "🚀 Đang Boost (x2 XP)" : "Bình thường", inline: true },
          { name: "📅 Cấp Tuần", value: `Lvl ${data.lvl_week} (${data.xp_week}/${xpNeeded(data.lvl_week)} XP)`, inline: false },
          { name: "🌙 Cấp Tháng", value: `Lvl ${data.lvl_month}`, inline: true },
          { name: "☀️ Cấp Năm", value: `Lvl ${data.lvl_year}`, inline: true },
          { name: "🛡️ Chỉ số Buff", value: `XP: +${buffs.xp}% | JP: +${buffs.jp_chance}% | JP KC: +${buffs.jp_money}` }
        );
      return message.reply({ embeds: [embed] });
    }

    // --- LỆNH NHIỆM VỤ (QUEST) ---
    if (cmd === "q" || cmd === "quest" || cmd === "nhiemvu") {
      const qData = await getQuest(id);
      const activeList = qData.active_quests.split(",");
      
      const embed = new EmbedBuilder()
        .setTitle(`📜 Nhiệm Vụ Hằng Ngày: ${message.author.username}`)
        .setColor("#F1C40F")
        .setFooter({ text: "Nhiệm vụ sẽ tự động làm mới sau 24h" });

      let desc = "";
      activeList.forEach(key => {
        const quest = BASE_QUESTS[key];
        const progress = qData.progress[key] || 0;
        const isClaimed = qData.claimed.includes(key);
        const status = isClaimed ? "✅ Đã nhận" : (progress >= quest.max ? "🎁 Sẵn sàng" : `⏳ ${progress}/${quest.max}`);
        desc += `**${quest.desc}**\n└ Thưởng: ${quest.rewardKC} KC | ${status}\n\n`;
      });

      if (qData.all_claimed) desc = "🎉 Bạn đã hoàn thành tất cả nhiệm vụ hôm nay!";
      
      embed.setDescription(desc);
      return message.reply({ embeds: [embed] });
    }

    // --- LỆNH NHẬN THƯỞNG NHIỆM VỤ (CLAIM) ---
    if (cmd === "claim") {
      const qData = await getQuest(id);
      if (qData.all_claimed) return message.reply("❌ Bạn đã nhận hết quà hôm nay.");

      const activeList = qData.active_quests.split(",");
      let totalReward = 0;
      let claimedAnything = false;

      for (const key of activeList) {
        if (!qData.claimed.includes(key) && qData.progress[key] >= BASE_QUESTS[key].max) {
          totalReward += BASE_QUESTS[key].rewardKC;
          qData.claimed.push(key);
          claimedAnything = true;
        }
      }

      if (!claimedAnything) return message.reply("❌ Bạn chưa hoàn thành nhiệm vụ nào mới.");

      if (qData.claimed.length === activeList.length) qData.all_claimed = true;

      const userData = await getLevel(id);
      userData.kcoin += totalReward;
      await saveLevel(id, userData);
      await saveQuest(id, qData);

      return message.reply(`✅ Bạn đã nhận **${totalReward} Kcoin** từ các nhiệm vụ đã hoàn thành!`);
    }

    // --- LỆNH XẾP HẠNG (TOP) ---
    if (cmd === "top") {
      const type = args[0] || "week";
      let colXp = "xp_week", colLvl = "lvl_week", title = "Tuần";
      
      if (type === "month") { colXp = "xp_month"; colLvl = "lvl_month"; title = "Tháng"; }
      if (type === "year") { colXp = "xp_year"; colLvl = "lvl_year"; title = "Năm"; }
      if (type === "coin" || type === "money") { colXp = "kcoin"; colLvl = "lvl_week"; title = "Kcoin"; }

      const res = await pool.query(`SELECT * FROM levels ORDER BY ${colLvl} DESC, ${colXp} DESC LIMIT 10`);
      
      const embed = new EmbedBuilder()
        .setTitle(`🏆 Bảng Xếp Hạng: ${title}`)
        .setColor("#FFD700");

      let desc = "";
      for (let i = 0; i < res.rows.length; i++) {
        const row = res.rows[i];
        const user = await levelBot.users.fetch(row.userid).catch(() => ({ username: "Ẩn danh" }));
        const val = (type === "coin" || type === "money") ? `${row.kcoin.toLocaleString()} KC` : `Lvl ${row[colLvl]}`;
        desc += `**#${i + 1}** | ${user.username} - ${val}\n`;
      }

      embed.setDescription(desc || "Chưa có dữ liệu.");
      return message.reply({ embeds: [embed] });
    }
// --- LỆNH TUNG ĐỒNG XU (CF) ---
    if (cmd === "cf" || cmd === "coinflip") {
      const sides = ["ngửa", "sấp"];
      const choice = args[0]?.toLowerCase();
      const bet = parseInt(args[1]);

      if (!sides.includes(choice) || isNaN(bet) || bet <= 0) 
        return message.reply(`❌ Cú pháp: \`${prefix}cf <sấp/ngửa> <số tiền>\``);

      const data = await getLevel(id);
      if (data.kcoin < bet) return message.reply("❌ Bạn không đủ Kcoin để đặt cược.");

      const result = sides[Math.floor(Math.random() * sides.length)];
      const win = choice === result;

      await updateQuestProgress(id, 'cf', 1);

      if (win) {
        data.kcoin += bet;
        await updateQuestProgress(id, 'cf_win', 1);
        await saveLevel(id, data);
        return message.reply(`🪙 Kết quả là **${result}**. Chúc mừng! Bạn thắng **${bet} Kcoin**.`);
      } else {
        data.kcoin -= bet;
        await saveLevel(id, data);
        return message.reply(`🪙 Kết quả là **${result}**. Rất tiếc! Bạn đã mất **${bet} Kcoin**.`);
      }
    }

    // --- LỆNH ADMIN: SET PREFIX ---
    if (cmd === "setprefix") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) 
        return message.reply("❌ Bạn cần quyền Administrator.");
      const newPrefix = args[0];
      if (!newPrefix) return message.reply("❌ Vui lòng nhập prefix mới.");

      await pool.query("INSERT INTO guild_settings (guildid, prefix) VALUES($1, $2) ON CONFLICT (guildid) DO UPDATE SET prefix=$2", [message.guild.id, newPrefix]);
      guildPrefixCache.set(message.guild.id, newPrefix);
      return message.reply(`✅ Đã đổi prefix thành: \`${newPrefix}\``);
    }

    // --- LỆNH ADMIN: SET CHANNEL LEVEL UP ---
    if (cmd === "setchannel") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) 
        return message.reply("❌ Bạn cần quyền Administrator.");
      const channel = message.mentions.channels.first() || message.channel;

      await pool.query("INSERT INTO guild_settings (guildid, lvl_channel) VALUES($1, $2) ON CONFLICT (guildid) DO UPDATE SET lvl_channel=$2", [message.guild.id, channel.id]);
      return message.reply(`✅ Đã đặt kênh thông báo level up tại: <#${channel.id}>`);
    }
  }); // KẾT THÚC MESSAGE CREATE

  // ==========================================
  // ===== HÀM THÔNG BÁO LEVEL UP =============
  // ==========================================
  async function sendLvlNotify(guild, embed) {
    const res = await pool.query("SELECT lvl_channel FROM guild_settings WHERE guildid=$1", [guild.id]);
    const channelId = res.rows[0]?.lvl_channel;
    const channel = channelId ? guild.channels.cache.get(channelId) : null;
    if (channel) channel.send({ embeds: [embed] }).catch(() => {});
  }

  // ==========================================
  // ===== HỆ THỐNG VOICE TIMER (FIXED) =======
  // ==========================================
  async function startVoiceTimer(userId, guild) {
    if (voiceTimers.has(userId)) return;

    const timer = setInterval(async () => {
      try {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member || !member.voice.channel || member.voice.selfMute || member.voice.selfDeaf) {
          clearInterval(timer);
          voiceTimers.delete(userId);
          return;
        }

        const data = await getLevel(userId);
        const buffs = await getEquipBuffs(userId);
        const isBoosted = Date.now() < parseInt(data.boost_until);
        
        const baseXP = randInt(20, 40);
        const xpAdd = Math.round(baseXP * (isBoosted ? 2 : 1) * (1 + buffs.xp / 100));

        data.xp_week += xpAdd;
        data.xp_month += xpAdd;
        data.xp_year += xpAdd;

        // Xử lý lên cấp tuần
        let leveledUp = false;
        while (data.xp_week >= xpNeeded(data.lvl_week)) {
          data.xp_week -= xpNeeded(data.lvl_week);
          data.lvl_week++;
          leveledUp = true;
        }
        // Xử lý lên cấp tháng/năm
        while (data.xp_month >= xpNeeded(data.lvl_month)) {
          data.xp_month -= xpNeeded(data.lvl_month);
          data.lvl_month++;
        }
        while (data.xp_year >= xpNeeded(data.lvl_year)) {
          data.xp_year -= xpNeeded(data.lvl_year);
          data.lvl_year++;
        }

        if (leveledUp) {
          const embed = new EmbedBuilder()
            .setTitle("🎉 LEVEL UP (VOICE)!")
            .setColor("#00FF00")
            .setDescription(`Chúc mừng <@${userId}> đã đạt **Cấp Tuần ${data.lvl_week}**!`);
          await sendLvlNotify(guild, embed);
        }

        await saveLevel(userId, data);
        await updateQuestProgress(userId, 'voice', 1);

      } catch (err) { console.error("❌ Lỗi Voice Timer:", err); }
    }, 60000); // Cộng mỗi 1 phút

    voiceTimers.set(userId, timer);
  }

  // 1. TỰ ĐỘNG KHÔI PHỤC KHI RESTART BOT
  levelBot.on("ready", async () => {
    console.log(`📈 Bot Level Online: ${levelBot.user.tag}`);
    let restoredCount = 0;
    levelBot.guilds.cache.forEach(guild => {
      guild.voiceStates.cache.forEach(vs => {
        if (!vs.member.user.bot && vs.channelId && !vs.selfMute && !vs.selfDeaf) {
          startVoiceTimer(vs.id, guild);
          restoredCount++;
        }
      });
    });
    if (restoredCount > 0) console.log(`🔄 Khôi phục cày Voice cho ${restoredCount} người.`);
  });

  // 2. XỬ LÝ KHI THAY ĐỔI TRẠNG THÁI VOICE (FIX CRASH)
  levelBot.on("voiceStateUpdate", async (oldState, newState) => {
    try {
      if (!newState.member || newState.member.user.bot) return;
      const userId = newState.member.id;

      const isValid = newState.channelId && !newState.selfMute && !newState.selfDeaf;
      const wasValid = oldState.channelId && !oldState.selfMute && !oldState.selfDeaf;

      if (isValid && !wasValid) {
        await startVoiceTimer(userId, newState.guild);
      } else if (!isValid && wasValid) {
        if (voiceTimers.has(userId)) {
          clearInterval(voiceTimers.get(userId));
          voiceTimers.delete(userId);
        }
      }
    } catch (e) { console.error("❌ Lỗi Voice Update:", e); }
  });

  levelBot.login(LEVEL_TOKEN);
}

startLevelBot();