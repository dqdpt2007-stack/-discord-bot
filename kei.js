require("dotenv").config();
const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder } = require("discord.js");
const { Pool } = require("pg");

// ===== CHECK ENV =====
if (!process.env.DISCORD_TOKEN_LVL) {
  console.error("❌ Missing DISCORD_TOKEN_LVL");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL");
  process.exit(1);
}

// ===== DATABASE CONFIG =====
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const DEFAULT_LEVEL_PREFIX = "k!";
const LEVEL_TOKEN = process.env.DISCORD_TOKEN_LVL;
const guildPrefixCache = new Map();
const xpCooldown = new Set(); // Chống spam XP

// ===== HELPERS =====
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

// ===== DATABASE INIT =====
async function initDB() {
  try {
    console.log("⏳ Đang kết nối và khởi tạo Database...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS levels (
        userid TEXT PRIMARY KEY,
        xp INT DEFAULT 0, lvl INT DEFAULT 1,
        kcoin INT DEFAULT 0, daily_last BIGINT DEFAULT 0
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS guild_settings (
        guildid TEXT PRIMARY KEY,
        lvl_channel TEXT,
        prefix TEXT DEFAULT 'k!'
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS inventory (
        id SERIAL PRIMARY KEY,
        userid TEXT,
        item_type TEXT, 
        item_category TEXT DEFAULT 'armor', 
        item_name TEXT,
        quantity INT DEFAULT 1,
        part TEXT,
        set_name TEXT,
        attributes JSONB DEFAULT '{}'::jsonb,
        is_equipped BOOLEAN DEFAULT false
      )
    `);

    const prefixes = await pool.query("SELECT guildid, prefix FROM guild_settings");
    prefixes.rows.forEach(r => guildPrefixCache.set(r.guildid, r.prefix));
    console.log("✅ Database đã sẵn sàng!");
  } catch (error) {
    console.error("❌ Lỗi Database:", error.message);
  }
}

async function getLevel(id) {
  const res = await pool.query("SELECT * FROM levels WHERE userid=$1", [id]);
  if (res.rows.length === 0) {
    await pool.query(`INSERT INTO levels (userid) VALUES($1)`, [id]);
    return { xp: 0, lvl: 1, kcoin: 0, daily_last: 0 };
  }
  return res.rows[0];
}

async function saveLevel(id, data) {
  await pool.query(
    `UPDATE levels SET xp=$1, lvl=$2, kcoin=$3, daily_last=$4 WHERE userid=$5`,
    [data.xp, data.lvl, data.kcoin, data.daily_last, id]
  );
}

// ===== HỆ THỐNG TRANG BỊ & CHỈ SỐ =====
const ARMOR_BUFF_POOL = ['fireRes', 'iceRes', 'poisonRes', 'bleedRes', 'stunRes', 'dodgeChance', 'dmgReduction', 'speed', 'hpPct', 'armorPct'];
const WEAPON_BUFF_POOL = ['poisonChance', 'iceChance', 'fireChance', 'atkPct', 'lifesteal', 'critChance', 'critDamage'];

function getRandomArmorBuffs() {
  let shuffled = ARMOR_BUFF_POOL.sort(() => 0.5 - Math.random());
  let selected = shuffled.slice(0, 3); // Lấy ngẫu nhiên 3 dòng buff
  let buffs = {};
  selected.forEach(b => {
    // Giảm tỉ lệ % xuống để khi cộng dồn 5 món không bị phá game
    if (['fireRes', 'iceRes', 'poisonRes', 'bleedRes', 'stunRes'].includes(b)) buffs[b] = randInt(1, 10); // Kháng max ~50%
    else if (b === 'dodgeChance') buffs[b] = randInt(1, 3); // Né max ~15% từ giáp
    else if (b === 'dmgReduction') buffs[b] = randInt(1, 2); // Giảm ST max ~10%
    else if (b === 'speed') buffs[b] = randInt(1, 5);
    else if (b === 'hpPct' || b === 'armorPct') buffs[b] = randInt(1, 4); 
  });
  return buffs;
}

function getRandomWeaponBuffs() {
  let shuffled = WEAPON_BUFF_POOL.sort(() => 0.5 - Math.random());
  let selected = shuffled.slice(0, 2);
  let buffs = {};
  selected.forEach(b => {
    if (['poisonChance', 'iceChance', 'fireChance'].includes(b)) buffs[b] = randInt(5, 20); // Gây hiệu ứng max 20%
    else if (b === 'atkPct') buffs[b] = randInt(1, 10);
    else if (b === 'critChance') buffs[b] = randInt(1, 5); // Chí mạng cộng dồn
    else if (b === 'lifesteal') buffs[b] = randInt(1, 3);
    else if (b === 'critDamage') buffs[b] = randInt(5, 20);
  });
  return buffs;
}
function generateArmorAttributes(setName) {
  let hp = 0, armor = 0, weight = 0;
  // Cân bằng lại HP (Full 5 món sẽ x5 lên)
  if (setName === 'Da') { hp = randInt(5, 10); armor = randInt(1, 2); weight = 0; }
  else if (setName === 'Đồng') { hp = randInt(15, 25); armor = randInt(3, 5); weight = randInt(1, 3); }
  else if (setName === 'Sắt') { hp = randInt(30, 50); armor = randInt(6, 10); weight = randInt(3, 5); }
  else if (setName === 'Vàng') { hp = randInt(50, 80); armor = randInt(4, 8); weight = randInt(2, 4); } // Vàng giáp yếu hơn Sắt nhưng máu trâu hơn
  else if (setName === 'Kim Cương') { hp = randInt(70, 100); armor = randInt(10, 15); weight = randInt(4, 6); }
  else if (setName === 'Phượng Hoàng') { hp = randInt(100, 150); armor = randInt(15, 25); weight = randInt(0, 2); }
  
  return { type: 'armor', hp, armor, weight, buffs: getRandomArmorBuffs() };
}

function generateWeaponAttributes(setName, type) {
  let dmg = 0;
  // Sát thương dao động scale đều với lượng máu của đối thủ ở tier tương ứng
  const limits = {
    'Dao': [[3,5], [10,15], [20,30], [35,50], [60,85], [100,130]], // Đánh nhanh, dmg vừa
    'Kiếm': [[4,7], [12,20], [25,40], [45,65], [75,100], [120,160]], // Cân bằng
    'Trường Kiếm': [[6,10], [18,28], [35,55], [60,90], [100,140], [150,220]], // Sát thương to, tốc chậm
    'Cung': [[4,6], [10,18], [22,35], [40,60], [70,95], [110,150]] // Bắn từ xa
  };
  const rarities = ['Gỗ', 'Đồng', 'Sắt', 'Vàng', 'Kim Cương', 'Phượng Hoàng'];
  let tier = rarities.indexOf(setName);
  if (tier !== -1 && limits[type]) dmg = randInt(limits[type][tier][0], limits[type][tier][1]);
  else dmg = 1;
  return { type: 'weapon', dmg, weaponType: type, buffs: getRandomWeaponBuffs() };
}
async function getPlayerCombatStats(userid) {
  const res = await pool.query("SELECT * FROM inventory WHERE userid=$1 AND is_equipped=true", [userid]);
  let stats = { className: 'Tân Thủ', weaponType: 'Tay Không', baseHp: 100, baseSpd: 20, baseAtk: 1, armorHp: 0, armorDef: 0, weight: 0, isGreatsword: false, classPassive: '' };
  let b = { fireRes: 0, iceRes: 0, poisonRes: 0, bleedRes: 0, stunRes: 0, dodgeChance: 0, dmgReduction: 0, speed: 0, hpPct: 0, armorPct: 0, poisonChance: 0, iceChance: 0, fireChance: 0, atkPct: 0, lifesteal: 0, critChance: 0, critDamage: 0 };

  res.rows.forEach(item => {
    let attr = item.attributes;
    if (item.item_category === 'weapon') {
      stats.baseAtk = attr.dmg || 1;
      stats.weaponType = attr.weaponType;
      if (attr.weaponType === 'Dao') { stats.className = 'Sát Thủ'; stats.baseHp = 100; stats.baseSpd = 40; stats.classPassive = '20% Gây chảy máu'; }
      if (attr.weaponType === 'Kiếm') { stats.className = 'Kiếm Khách'; stats.baseHp = 150; stats.baseSpd = 30; stats.classPassive = '20% Crit damage'; }
      if (attr.weaponType === 'Trường Kiếm') { stats.className = 'Chiến Binh'; stats.baseHp = 200; stats.baseSpd = 20; stats.isGreatsword = true; stats.classPassive = '50% Gây choáng (Đánh sau cùng)'; }
      if (attr.weaponType === 'Cung') { stats.className = 'Cung Thủ'; stats.baseHp = 80; stats.baseSpd = 50; stats.classPassive = '20% Né tránh'; }
    } else {
      stats.armorHp += attr.hp || 0;
      stats.armorDef += attr.armor || 0;
      stats.weight += attr.weight || 0;
    }
    if (attr.buffs) {
      for (const [key, val] of Object.entries(attr.buffs)) { if (b[key] !== undefined) b[key] += val; }
    }
  });

  let finalHp = Math.floor((stats.baseHp + stats.armorHp) * (1 + b.hpPct / 100));
  let finalAtk = Math.floor(stats.baseAtk * (1 + b.atkPct / 100));
  let finalArmor = Math.floor(stats.armorDef * (1 + b.armorPct / 100));
  let finalSpd = stats.baseSpd - stats.weight + b.speed;
  if (finalSpd < 1) finalSpd = 1;

  return { className: stats.className, weaponType: stats.weaponType, passive: stats.classPassive, isGreatsword: stats.isGreatsword, maxHp: finalHp, atk: finalAtk, armor: finalArmor, speed: finalSpd, buffs: b };
}

// ==========================================
// ===== BẮT ĐẦU BOT DISCORD & LỆNH =========
// ==========================================
async function startBot() {
  await initDB();

  const bot = new Client({
    intents: [ GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent ]
  });

  bot.once("ready", () => console.log(`⚔️ RPG Bot online: ${bot.user.tag}`));

  bot.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;

    // Các biến bắt buộc phải có để hoạt động
    const id = message.author.id;
    const now = Date.now();
    const content = message.content.trim();
    const prefix = await getPrefix(message.guild.id);

    // --- HỆ THỐNG XP CHAT ---
    if (!content.startsWith(prefix)) {
      if (!xpCooldown.has(id)) {
        let userData = await getLevel(id);
        userData.xp += randInt(15, 25);
        let nxtLvl = xpNeeded(userData.lvl);
        
        if (userData.xp >= nxtLvl) {
          userData.lvl++;
          
          // Gửi vào kênh báo Level riêng biệt (nếu có set)
          const guildData = await pool.query("SELECT lvl_channel FROM guild_settings WHERE guildid=$1", [message.guild.id]);
          const lvlChannelId = guildData.rows[0]?.lvl_channel;
          const channelToSend = message.guild.channels.cache.get(lvlChannelId) || message.channel;
          channelToSend.send(`🎉 Chúc mừng ${message.author}, bạn đã thăng lên **Cấp ${userData.lvl}**!`);
        }
        await saveLevel(id, userData);
        
        xpCooldown.add(id);
        setTimeout(() => xpCooldown.delete(id), 60000); // Cooldown 1 phút để chống spam
      }
      return;
    }

    // --- XỬ LÝ LỆNH ---
    const args = content.slice(prefix.length).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();

    // ==========================
    // LỆNH TIỀN TỆ & CÁ NHÂN
    // ==========================
    if (cmd === "profile" || cmd === "cash") {
      const data = await getLevel(id);
      const stats = await getPlayerCombatStats(id);
      const embed = new EmbedBuilder()
        .setTitle(`Hồ sơ của ${message.author.username}`)
        .setColor("#F1C40F")
        .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: "Cấp độ", value: `Lv. ${data.lvl} (${data.xp}/${xpNeeded(data.lvl)} XP)`, inline: true },
          { name: "Tài sản", value: `💰 **${data.kcoin.toLocaleString()}** Kcoin`, inline: true },
          { name: "Class", value: `🎭 ${stats.className}`, inline: true }
        );
      return message.reply({ embeds: [embed] });
    }

    if (cmd === "give" || cmd === "pay") {
      const target = message.mentions.users.first();
      const amount = parseInt(args[1]);
      if (!target || isNaN(amount) || amount <= 0) return message.reply(`❌ Cú pháp: \`${prefix}give @user <số_tiền>\``);
      if (target.bot || target.id === id) return message.reply(`❌ Không thể chuyển tiền cho bot hoặc bản thân!`);

      const senderData = await getLevel(id);
      if (senderData.kcoin < amount) return message.reply(`❌ Tiền túi không đủ!`);

      senderData.kcoin -= amount;
      const receiverData = await getLevel(target.id);
      receiverData.kcoin += amount;

      await saveLevel(id, senderData);
      await saveLevel(target.id, receiverData);
      return message.reply(`💸 Bạn đã "ting ting" thành công **${amount.toLocaleString()} Kcoin** cho ${target.username}!`);
    }

    if (cmd === "cf" || cmd === "coinflip") {
      const data = await getLevel(id);
      const bet = parseInt(args[0]);
      if (isNaN(bet) || bet <= 0) return message.reply(`❌ Cược số tiền đàng hoàng coi. VD: \`${prefix}cf 100\``);
      if (data.kcoin < bet) return message.reply(`❌ Bạn không đủ tiền! Tiền hiện có: **${data.kcoin.toLocaleString()} Kcoin**.`);

      const win = Math.random() >= 0.5;
      if (win) {
        data.kcoin += bet;
        await saveLevel(id, data);
        return message.reply(`🪙 Đồng xu **NGỬA**! Bạn thắng và ăn trọn **${bet.toLocaleString()} Kcoin**!`);
      } else {
        data.kcoin -= bet;
        await saveLevel(id, data);
        return message.reply(`🪙 Đồng xu **SẤP**! Bạn đã mất trắng **${bet.toLocaleString()} Kcoin**. Còn cái nịt!`);
      }
    }

    if (cmd === "daily") {
      const data = await getLevel(id);
      const cdTime = 24 * 60 * 60 * 1000; // 24 giờ
      if (now - data.daily_last < cdTime) {
        const timeLeft = new Date(cdTime - (now - data.daily_last)).toISOString().substr(11, 8);
        return message.reply(`⏳ Đợi **${timeLeft}** nữa để nhận thưởng tiếp nhé!`);
      }
      const reward = randInt(2000, 5000); // Tặng 2000-5000 Kcoin
      data.kcoin += reward;
      data.daily_last = now;
      await saveLevel(id, data);
      return message.reply(`🎁 Bạn đã nhận điểm danh hằng ngày: **+${reward.toLocaleString()} Kcoin**!`);
    }

    // ==========================
    // LỆNH QUẢN TRỊ SERVER
    // ==========================
    if (cmd === "prefix") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return message.reply("❌ Bạn cần quyền Quản lý Server để đổi prefix!");
      const newPrefix = args[0];
      if (!newPrefix) return message.reply(`❌ Cú pháp: \`${prefix}prefix <ký_tự_mới>\``);
      
      await pool.query("INSERT INTO guild_settings (guildid, prefix) VALUES ($1, $2) ON CONFLICT (guildid) DO UPDATE SET prefix = $2", [message.guild.id, newPrefix]);
      guildPrefixCache.set(message.guild.id, newPrefix);
      return message.reply(`✅ Đã đổi prefix của server thành: **${newPrefix}**`);
    }

    if (cmd === "setchannel") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return message.reply("❌ Bạn cần quyền Quản lý Server!");
      
      await pool.query("INSERT INTO guild_settings (guildid, lvl_channel) VALUES ($1, $2) ON CONFLICT (guildid) DO UPDATE SET lvl_channel = $2", [message.guild.id, message.channel.id]);
      return message.reply(`✅ Kênh này đã được chọn làm kênh thông báo thăng cấp!`);
    }

    // ==========================
    // LỆNH LEADERBOARD (BẢNG XẾP HẠNG)
    // ==========================
    if (cmd === "top" || cmd === "leaderboard" || cmd === "lb") {
      const res = await pool.query("SELECT userid, lvl, xp FROM levels ORDER BY lvl DESC, xp DESC LIMIT 10");
      if (res.rows.length === 0) return message.reply("Chưa có ai cày cuốc trong server này cả!");

      const embed = new EmbedBuilder()
        .setTitle("🏆 BẢNG XẾP HẠNG CẤP ĐỘ")
        .setColor("#FFD700")
        .setThumbnail(message.guild.iconURL({ dynamic: true }));

      let desc = "";
      for (let i = 0; i < res.rows.length; i++) {
        const row = res.rows[i];
        let name = "Kẻ Vô Danh";
        try {
          const member = await message.guild.members.fetch(row.userid);
          if (member) name = member.user.username;
        } catch (e) { /* Bỏ qua lỗi */ }
        
        let medal = "🏅";
        if (i === 0) medal = "🥇";
        else if (i === 1) medal = "🥈";
        else if (i === 2) medal = "🥉";

        desc += `**${medal} #${i + 1} | ${name}**\n↳ Cấp: **${row.lvl}** - XP: **${row.xp.toLocaleString()}**\n\n`;
      }
      embed.setDescription(desc);
      return message.reply({ embeds: [embed] });
    }

    // ==========================
    // LỆNH INFO & STATS
    // ==========================
    if (cmd === "info" || cmd === "class") {
      const stats = await getPlayerCombatStats(id);
      const embed = new EmbedBuilder()
        .setTitle(`🎭 THÔNG TIN CLASS: ${stats.className.toUpperCase()}`)
        .setColor("#9B59B6")
        .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
        .setDescription(`*Đổi vũ khí sẽ tự động chuyển đổi Class nhân vật của bạn.*`)
        .addFields(
          { name: "🗡️ Vũ khí hiện tại", value: stats.weaponType, inline: true },
          { name: "🌟 Kỹ năng Nội tại", value: stats.passive || "Không có", inline: true }
        );
      return message.reply({ embeds: [embed] });
    }

    if (cmd === "stats") {
      const stats = await getPlayerCombatStats(id);
      const b = stats.buffs;
      
      let extraBuffs = [];
      if (b.dodgeChance > 0) extraBuffs.push(`+${b.dodgeChance}% Né`);
      if (b.dmgReduction > 0) extraBuffs.push(`-${b.dmgReduction}% ST nhận vào`);
      if (b.lifesteal > 0) extraBuffs.push(`+${b.lifesteal}% Hút máu`);
      if (b.critChance > 0) extraBuffs.push(`+${b.critChance}% Tỉ lệ Chí mạng`);
      if (b.critDamage > 0) extraBuffs.push(`+${b.critDamage}% ST Chí mạng`);

      const embed = new EmbedBuilder()
        .setTitle(`📊 CHỈ SỐ CHIẾN ĐẤU: ${message.author.username}`)
        .setColor("#E67E22")
        .addFields(
          { name: "🔰 Chỉ số cơ bản", value: `❤️ HP: **${stats.maxHp}**\n⚔️ ATK: **${stats.atk}**\n🛡️ Giáp: **${stats.armor}**\n💨 Tốc độ: **${stats.speed}**` },
          { name: "🧬 Kháng hiệu ứng", value: `🔥 Lửa: ${b.fireRes}%\n❄️ Băng: ${b.iceRes}%\n☠️ Độc: ${b.poisonRes}%\n🩸 Chảy máu: ${b.bleedRes}%\n💫 Choáng: ${b.stunRes}%` },
          { name: "✨ Thuộc tính đặc biệt", value: extraBuffs.length > 0 ? extraBuffs.join(" | ") : "Không có" }
        );
      return message.reply({ embeds: [embed] });
    }

    // ==========================
    // LỆNH SHOP & MUA ĐỒ
    // ==========================
    if (cmd === "shop") {
      const embed = new EmbedBuilder()
        .setTitle("🛒 CỬA HÀNG TRANG BỊ")
        .setColor("#2ECC71")
        .setDescription(`Dùng \`${prefix}buy <mã>\` để mua vật phẩm.`)
        .addFields(
          { name: "🛡️ Rương Giáp I (`r1`) - 1,000 KC", value: "Tỉ lệ: Da 40%, Đồng 30%, Sắt 25%, Vàng 5%" },
          { name: "🛡️ Rương Giáp II (`r2`) - 5,000 KC", value: "Tỉ lệ: Da 20%, Đồng 35%, Sắt 30%, Vàng 10%, Kim Cương 5%" },
          { name: "🛡️ Rương Giáp III (`r3`) - 20,000 KC", value: "Tỉ lệ: Đồng 40%, Sắt 30%, Vàng 20%, Kim Cương 9.9%, Phượng Hoàng 0.1%" },
          { name: "⚔️ Rương Vũ Khí I (`vk1`) - 1,000 KC", value: "Tỉ lệ: Gỗ 40%, Đồng 30%, Sắt 25%, Vàng 5%" },
          { name: "⚔️ Rương Vũ Khí II (`vk2`) - 5,000 KC", value: "Tỉ lệ: Gỗ 20%, Đồng 35%, Sắt 30%, Vàng 10%, Kim Cương 5%" },
          { name: "⚔️ Rương Vũ Khí III (`vk3`) - 20,000 KC", value: "Tỉ lệ: Đồng 40%, Sắt 30%, Vàng 20%, Kim Cương 9.9%, Phượng Hoàng 0.1%" }
        );
      return message.reply({ embeds: [embed] });
    }

    if (cmd === "buy") {
      const data = await getLevel(id);
      const itemCode = args[0]?.toLowerCase();
      let cost = 0, itemName = "", category = "";

      if (itemCode === "r1") { cost = 1000; itemName = "Rương Giáp I"; category = "chest_armor"; }
      else if (itemCode === "r2") { cost = 5000; itemName = "Rương Giáp II"; category = "chest_armor"; }
      else if (itemCode === "r3") { cost = 20000; itemName = "Rương Giáp III"; category = "chest_armor"; }
      else if (itemCode === "vk1") { cost = 1000; itemName = "Rương Vũ Khí I"; category = "chest_weapon"; }
      else if (itemCode === "vk2") { cost = 5000; itemName = "Rương Vũ Khí II"; category = "chest_weapon"; }
      else if (itemCode === "vk3") { cost = 20000; itemName = "Rương Vũ Khí III"; category = "chest_weapon"; }
      else return message.reply(`❌ Mã vật phẩm sai. Vui lòng check \`${prefix}shop\`.`);

      if (data.kcoin < cost) return message.reply(`❌ Bạn cần **${cost.toLocaleString()} Kcoin** để mua rương này.`);
      data.kcoin -= cost;
      await saveLevel(id, data);

      const check = await pool.query("SELECT id FROM inventory WHERE userid=$1 AND item_name=$2", [id, itemName]);
      if (check.rows.length > 0) {
        await pool.query("UPDATE inventory SET quantity = quantity + 1 WHERE id=$1", [check.rows[0].id]);
      } else {
        await pool.query("INSERT INTO inventory (userid, item_type, item_category, item_name, quantity) VALUES ($1, 'chest', $2, $3, 1)", [id, category, itemName]);
      }
      return message.reply(`📦 Đã mua thành công **${itemName}**! Dùng \`${prefix}inv\` để kiểm tra và \`${prefix}use\` để mở.`);
    }

    // ==========================
    // LỆNH MỞ RƯƠNG (GACHA)
    // ==========================
    if (cmd === "use") {
      const index = parseInt(args[0]) - 1;
      if (isNaN(index) || index < 0) return message.reply(`❌ Dùng: \`${prefix}use <STT_Trong_Túi>\``);

      const inv = await pool.query("SELECT * FROM inventory WHERE userid=$1 ORDER BY item_type ASC, id ASC", [id]);
      const target = inv.rows[index];

      if (!target || target.item_type !== 'chest') return message.reply("❌ Vật phẩm không phải Rương.");

      const rand = Math.random() * 100;
      let rarity = "";

      if (target.item_name.includes('I')) {
        if (rand <= 40) rarity = target.item_category === 'chest_armor' ? 'Da' : 'Gỗ';
        else if (rand <= 70) rarity = 'Đồng'; else if (rand <= 95) rarity = 'Sắt'; else rarity = 'Vàng';
      } else if (target.item_name.includes('II')) {
        if (rand <= 20) rarity = target.item_category === 'chest_armor' ? 'Da' : 'Gỗ';
        else if (rand <= 55) rarity = 'Đồng'; else if (rand <= 85) rarity = 'Sắt'; else if (rand <= 95) rarity = 'Vàng'; else rarity = 'Kim Cương';
      } else {
        if (rand <= 40) rarity = 'Đồng'; else if (rand <= 70) rarity = 'Sắt'; else if (rand <= 90) rarity = 'Vàng'; else if (rand <= 99.9) rarity = 'Kim Cương'; else rarity = 'Phượng Hoàng';
      }

      let itemType = target.item_category === 'chest_armor' ? 'armor' : 'weapon';
      let finalName = "", part = "", attributes = {};

      if (itemType === 'armor') {
        const parts = ['Mũ', 'Giáp', 'Quần', 'Giày', 'Găng tay'];
        part = parts[Math.floor(Math.random() * parts.length)];
        finalName = `${part} ${rarity}`;
        attributes = generateArmorAttributes(rarity);
      } else {
        const wTypes = ['Dao', 'Kiếm', 'Trường Kiếm', 'Cung'];
        part = 'Vũ Khí';
        let wType = wTypes[Math.floor(Math.random() * wTypes.length)];
        finalName = `${wType} ${rarity}`;
        attributes = generateWeaponAttributes(rarity, wType);
      }

      await pool.query(
        "INSERT INTO inventory (userid, item_type, item_category, item_name, part, set_name, attributes) VALUES ($1, 'equip', $2, $3, $4, $5, $6)",
        [id, itemType, finalName, part, rarity, JSON.stringify(attributes)]
      );

      if (target.quantity <= 1) await pool.query("DELETE FROM inventory WHERE id=$1", [target.id]);
      else await pool.query("UPDATE inventory SET quantity = quantity - 1 WHERE id=$1", [target.id]);

      return message.reply(`🎉 Bạn mở **${target.item_name}** rớt ra: **${finalName}**!\n*(Dùng \`${prefix}inv\` để xem và \`${prefix}equip\` để trang bị)*`);
    }

    // ==========================
    // LỆNH TÚI ĐỒ & MẶC ĐỒ
    // ==========================
    if (cmd === "inv" || cmd === "inventory") {
      const invData = await pool.query("SELECT * FROM inventory WHERE userid=$1 ORDER BY item_type ASC, id ASC", [id]);
      if (invData.rows.length === 0) return message.reply("🎒 Túi đồ của bạn hiện đang mốc meo trống rỗng.");

      const page = parseInt(args[0]) || 1;
      const limit = 10;
      const total = Math.ceil(invData.rows.length / limit);
      if (page < 1 || page > total) return;

      const start = (page - 1) * limit;
      const items = invData.rows.slice(start, start + limit);

      const embed = new EmbedBuilder().setTitle(`🎒 TÚI ĐỒ: ${message.author.username}`).setColor("#3498DB");
      let desc = "";

      items.forEach((item, index) => {
        const globalIdx = start + index + 1; 
        if (item.item_type === 'chest') {
          desc += `**[${globalIdx}]** 📦 ${item.item_name} (x${item.quantity})\n`;
        } else {
          const eq = item.is_equipped ? "✅ " : "";
          desc += `**[${globalIdx}]** ${eq}**${item.item_name}** [Vị trí: ${item.part}]\n`;
        }
      });

      embed.setDescription(desc).setFooter({ text: `Trang ${page}/${total} • Dùng ${prefix}equip <stt> để mặc/tháo` });
      return message.reply({ embeds: [embed] });
    }

    if (cmd === "equip") {
      const index = parseInt(args[0]) - 1;
      if (isNaN(index) || index < 0) return message.reply(`❌ Cú pháp: \`${prefix}equip <STT>\``);

      const inv = await pool.query("SELECT * FROM inventory WHERE userid=$1 ORDER BY item_type ASC, id ASC", [id]);
      const target = inv.rows[index];

      if (!target || target.item_type !== 'equip') return message.reply("❌ Vật phẩm không hợp lệ để trang bị.");
      
      if (target.is_equipped) {
        await pool.query("UPDATE inventory SET is_equipped=false WHERE id=$1", [target.id]);
        return message.reply(`Tạch! Bạn đã tháo **${target.item_name}** xuống.`);
      }

      await pool.query("UPDATE inventory SET is_equipped=false WHERE userid=$1 AND part=$2", [id, target.part]);
      await pool.query("UPDATE inventory SET is_equipped=true WHERE id=$1", [target.id]);
      return message.reply(`⚔️ Ngầu đét! Đã trang bị thành công **${target.item_name}**!`);
    }

    if (cmd === "giveitem") {
      const target = message.mentions.users.first();
      const itemIndex = parseInt(args[1]) - 1;
      if (!target || isNaN(itemIndex) || itemIndex < 0) return message.reply(`❌ Cú pháp: \`${prefix}giveitem @user <stt_vật_phẩm>\``);
      if (target.bot || target.id === id) return message.reply(`❌ Không thể tặng cho bot hoặc bản thân!`);

      const inv = await pool.query("SELECT * FROM inventory WHERE userid=$1 ORDER BY item_type ASC, id ASC", [id]);
      const item = inv.rows[itemIndex];
      
      if (!item) return message.reply("❌ Vật phẩm không tồn tại!");
      if (item.is_equipped) return message.reply("❌ Tháo đồ ra trước khi đem tặng người khác nhé!");

      if (item.quantity > 1) {
         await pool.query("UPDATE inventory SET quantity = quantity - 1 WHERE id=$1", [item.id]);
         await pool.query("INSERT INTO inventory (userid, item_type, item_category, item_name, quantity, part, set_name, attributes) VALUES ($1, $2, $3, $4, 1, $5, $6, $7)", [target.id, item.item_type, item.item_category, item.item_name, item.part, item.set_name, JSON.stringify(item.attributes)]);
      } else {
         await pool.query("UPDATE inventory SET userid=$1 WHERE id=$2", [target.id, item.id]);
      }
      return message.reply(`🎁 Bạn đã hào phóng tặng **${item.item_name}** cho ${target.username}!`);
    }

    // ==========================
    // LỆNH BATTLE (PVP) ENGINE
    // ==========================
    if (cmd === "battle" || cmd === "pvp") {
      const targetUser = message.mentions.users.first();
      if (!targetUser || targetUser.bot || targetUser.id === id) return message.reply(`❌ Cú pháp: \`${prefix}battle @user\``);

      let p1 = await getPlayerCombatStats(id);
      let p2 = await getPlayerCombatStats(targetUser.id);
      p1.name = message.author.username;
      p2.name = targetUser.username;
      p1.hp = p1.maxHp; p2.hp = p2.maxHp;
      p1.statuses = []; p2.statuses = []; 
      p1.isStunned = false; p2.isStunned = false; p1.isFrozen = false; p2.isFrozen = false;

      let battleLog = `⚔️ **${p1.name}** vs **${p2.name}** ⚔️\n\n`;
      let turn = 1;

      const applyStatus = (attacker, defender, type, chance, res, isDamage = true) => {
        if (Math.random() * 100 > chance) return;
        if (Math.random() * 100 < res) {
          battleLog += `🛡️ *${defender.name} đã kháng được ${type}!*\n`;
          return;
        }
        const duration = randInt(2, 3);
        const val = isDamage ? randInt(5, 15) : 0; 
        defender.statuses.push({ type, duration, val });
        battleLog += `⚠️ **${defender.name}** bị dính **${type}** trong ${duration} lượt!\n`;
      };

      while (p1.hp > 0 && p2.hp > 0 && turn <= 15) {
        battleLog += `**[Lượt ${turn}]**\n`;

        let first = p1, second = p2;
        if (p1.isGreatsword && !p2.isGreatsword) { first = p2; second = p1; }
        else if (!p1.isGreatsword && p2.isGreatsword) { first = p1; second = p2; }
        else if (p2.speed > p1.speed) { first = p2; second = p1; }

        let sequence = [];
        if (first.speed >= second.speed * 2) sequence = [first, first, second];
        else if (second.speed >= first.speed * 2) sequence = [second, second, first];
        else sequence = [first, second];

        for (let actor of sequence) {
          if (p1.hp <= 0 || p2.hp <= 0) break;
          let target = actor === p1 ? p2 : p1;

          actor.statuses = actor.statuses.filter(s => s.duration > 0);
          for (let s of actor.statuses) {
            if (['Độc', 'Cháy', 'Chảy máu'].includes(s.type)) {
              let dotDmg = Math.floor((s.val / 100) * actor.maxHp);
              if (s.type === 'Cháy') dotDmg = Math.floor(dotDmg * (1 - actor.buffs.fireRes/100));
              if (s.type === 'Độc') dotDmg = Math.floor(dotDmg * (1 - actor.buffs.poisonRes/100));
              if (s.type === 'Chảy máu') dotDmg = Math.floor(dotDmg * (1 - actor.buffs.bleedRes/100));
              
              actor.hp -= dotDmg;
              battleLog += `🩸 *${actor.name} mất ${dotDmg} HP do ${s.type}.*\n`;
            }
            s.duration--;
          }

          if (actor.hp <= 0) break;

          if (actor.isStunned || actor.isFrozen) {
            battleLog += `💫 ${actor.name} không thể cử động!\n`;
            actor.isStunned = false; actor.isFrozen = false;
            continue;
          }

          let dodgeTotal = target.buffs.dodgeChance + (target.className === 'Cung Thủ' ? 20 : 0);
          if (Math.random() * 100 < dodgeTotal) {
            battleLog += `💨 **${target.name}** đã né được đòn của ${actor.name}!\n`;
            continue;
          }

          let dmg = actor.atk;
          let isCrit = false;
          let critChance = actor.buffs.critChance;
          let critDmgMultiplier = 1.5 + (actor.buffs.critDamage / 100) + (actor.className === 'Kiếm Khách' ? 0.2 : 0);

          if (Math.random() * 100 < critChance) {
            dmg = Math.floor(dmg * critDmgMultiplier);
            isCrit = true;
          }

          let armorReduction = target.armor / (target.armor + 100);
          dmg = Math.floor(dmg * (1 - armorReduction));
          dmg = Math.floor(dmg * (1 - target.buffs.dmgReduction / 100));
          if (dmg < 1) dmg = 1;

          target.hp -= dmg;
          let critStr = isCrit ? "💥 **CHÍ MẠNG!**" : "🗡️";
          battleLog += `${critStr} ${actor.name} đánh ${target.name} mất **${dmg} HP**.\n`;

          if (actor.buffs.lifesteal > 0) {
            let heal = Math.floor(dmg * (actor.buffs.lifesteal / 100));
            actor.hp = Math.min(actor.maxHp, actor.hp + heal);
          }

          if (actor.buffs.fireChance > 0) applyStatus(actor, target, 'Cháy', actor.buffs.fireChance, target.buffs.fireRes);
          if (actor.buffs.poisonChance > 0) applyStatus(actor, target, 'Độc', actor.buffs.poisonChance, target.buffs.poisonRes);
          if (actor.buffs.iceChance > 0) {
            if (Math.random() * 100 < actor.buffs.iceChance && Math.random() * 100 > target.buffs.iceRes) {
               target.isFrozen = true; battleLog += `❄️ **${target.name}** bị Đóng băng!\n`;
            }
          }
          if (actor.className === 'Sát Thủ') applyStatus(actor, target, 'Chảy máu', 20, target.buffs.bleedRes);
          if (actor.className === 'Chiến Binh') {
            if (Math.random() * 100 < 50 && Math.random() * 100 > target.buffs.stunRes) {
               target.isStunned = true; battleLog += `🔨 **${target.name}** bị Choáng!\n`;
            }
          }
        }
        battleLog += `❤️ HP: ${p1.name} [${p1.hp}] | ${p2.name} [${p2.hp}]\n---\n`;
        turn++;
      }

      let winner = "Hòa";
      if (p1.hp > 0 && p2.hp <= 0) winner = p1.name;
      else if (p2.hp > 0 && p1.hp <= 0) winner = p2.name;
      else if (p1.hp > p2.hp) winner = p1.name;
      else if (p2.hp > p1.hp) winner = p2.name;

      battleLog += `\n🏆 **KẾT QUẢ:** **${winner}** đã giành chiến thắng!`;

      if (battleLog.length > 4000) battleLog = battleLog.substring(0, 3900) + "\n\n... (Trận chiến quá dài đã bị cắt bớt) ...\n" + `🏆 **KẾT QUẢ:** **${winner}** giành chiến thắng!`;

      const embed = new EmbedBuilder()
        .setTitle("BÁO CÁO TRẬN CHIẾN PVP")
        .setColor("#E74C3C")
        .setDescription(battleLog);
      
      return message.reply({ embeds: [embed] });
    }
  });

  bot.login(LEVEL_TOKEN);
}

startBot();