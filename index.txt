require("dotenv").config();
const cooldown = new Map();
const fs = require("fs");	
const axios = require("axios");
const { Pool } = require("pg");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
const { Client, GatewayIntentBits, PermissionsBitField } = require("discord.js");
const Groq = require("groq-sdk");

// ===== CHECK ENV =====

if (!process.env.DISCORD_TOKEN_1 || !process.env.DISCORD_TOKEN_2) {
  console.error("❌ Missing DISCORD_TOKEN_1 or DISCORD_TOKEN_2");
  process.exit(1);
}

if (!process.env.GROQ_API_KEY) {
  console.error("❌ Missing GROQ_API_KEY");
  process.exit(1);
}

// ===== GROQ =====

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// ===== BOT CONFIG =====
const bots = [
  // ===== BOT 1 =====
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

  // ===== BOT 2 =====
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
// ===== LEVEL BOT CONFIG =====

const LEVEL_PREFIX = "lvl!";
const LEVEL_TOKEN = process.env.DISCORD_TOKEN_LVL;


function xpNeeded(level){
  return 50 * level * level + 50 * level;
}

// ===== START BOT =====
async function initDB(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS levels (
      userid TEXT PRIMARY KEY,
      xp INT DEFAULT 0,
      level INT DEFAULT 1
    )
  `);
}

initDB();
async function getLevel(id){

  const res = await pool.query(
    "SELECT * FROM levels WHERE userid=$1",
    [id]
  );

  if(res.rows.length === 0){

    await pool.query(
      "INSERT INTO levels(userid,xp,level) VALUES($1,0,1)",
      [id]
    );

    return {xp:0, level:1};

  }

  return res.rows[0];
}

async function saveLevel(id,xp,level){

  await pool.query(
    "UPDATE levels SET xp=$1, level=$2 WHERE userid=$3",
    [xp,level,id]
  );

}
// ======anime search ====
async function getAnimeGif(tag){

  try{

    const res = await axios.get(`https://nekos.best/api/v2/${tag}`);

    if(!res.data.results || res.data.results.length === 0){
      return null;
    }

    return res.data.results[0].url;

  }catch(err){

    console.error("GIF ERROR:", err.response?.data || err);
    return null;

  }

}
bots.forEach(config => {

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });

  client.once("clientReady", () => {
    console.log(`✅ Bot online: ${client.user.tag}`);
  });

  client.on("messageCreate", async (message) => {

    if (message.author.bot) return;

    const content = message.content;
    const prefix = config.prefix;

    // ===== HI =====

    if (content === prefix + "hi") {
      return message.reply("Anh chào em nha");
    }

    // ===== SLEEP =====

    if (content === prefix + "sleep") {
      return message.reply("Ngủ ngon nha bé ngoan của anh");
    }


  // ===== LOVE =====

if (content === prefix + "love") {

  const percent = Math.floor(Math.random() * 101);

  let action = "";
  let gifTag = null;

  if (percent < 10) {
    action = "😤 Đừng đến gần";
    gifTag = "slap";
  }
  else if (percent < 35) {
    action = "🤝 Tay em nay ấm quá";
    gifTag = "handhold";
  }
  else if (percent < 50) {
    action = "🫳 Đừng giận nhe";
    gifTag = "pat";
  }
  else if (percent < 80) {
    action = "🤗 Ôm cái ";
    gifTag = "hug";
  }
  else if (percent < 99) {
    action = "💋 Chụt";
    gifTag = "kiss";
  }
  else {
    action = "💍 Kết hôn với anh nhe";
    gifTag = "blush";
  }

  let gif = null;

  if (gifTag) {
    gif = await getAnimeGif(gifTag);
  }

  if (!gif) {
    return message.reply(`💖 Độ thiện cảm: **${percent}%**\n${action}`);
  }

  return message.reply(`💖 Độ thiện cảm: **${percent}%**\n${action}\n${gif}`);

}

    // ===== HELP =====

    if (content === prefix + "help") {
      return message.reply(`
📜 Lệnh của bot

${prefix}hi
${prefix}sleep
${prefix}love
${prefix}hug
${prefix}pat
${prefix}kiss
${prefix}blush
${prefix}rep <id> <text>
${prefix}ai <text>
`);
    }

    // ===== AI =====

    if (content.startsWith(prefix + "ai ")) {

      const prompt = content.slice((prefix + "ai ").length).trim();

      if (!prompt) {
        return message.reply("Nói gì đi.");
      }

      try {

        const chat = await groq.chat.completions.create({
          messages: [
            { role: "system", content: config.personality },
            { role: "user", content: prompt }
          ],
          model: "llama-3.3-70b-versatile"
        });

        let reply = chat.choices?.[0]?.message?.content || "Không nghĩ ra câu trả lời.";

        if (reply.length > 2000) {
          reply = reply.substring(0, 2000);
        }

        return message.reply(reply);

      } catch (err) {

        console.error("AI ERROR:", err);
        return message.reply("AI lỗi rồi");

      }

    }
// ===== PAT =====

if (content === prefix + "pat") {

  const gif = await getAnimeGif("pat");

  if (!gif) return message.reply("Không tìm được GIF 😢");

  return message.reply("🫳 Ngoan nào\n" + gif);

}
// ===== HUG =====

if (content === prefix + "hug") {

  const gif = await getAnimeGif("hug");

  if (!gif) return message.reply("Không tìm được GIF 😢");

  return message.reply("🤗 Nay cũng biết đòi ôm luôn à\n" + gif);

}
// ===== KISS =====

if (content === prefix + "kiss") {

  const gif = await getAnimeGif("kiss");

  if (!gif) return message.reply("Không tìm được GIF 😢");

  return message.reply("💋 Chụt\n" + gif);

}
// ===== KISS =====

if (content === prefix + "blush") {

  const gif = await getAnimeGif("blush");

  if (!gif) return message.reply("Không tìm được GIF 😢");

  return message.reply("Ngại...\n" + gif);

}
// ===== Handhold =====

if (content === prefix + "hand") {

  const gif = await getAnimeGif("handhold");

  if (!gif) return message.reply("Không tìm được GIF 😢");

  return message.reply("Hình như tay em dính gì nà\n" + gif);

}


// ===== REP =====

if (content.startsWith(prefix + "rep")) {

  const args = content.split(" ");
  const msgID = args[1];
  const text = args.slice(2).join(" ");

  if (!msgID || !text) {
return message.reply(`Dùng: ${prefix}rep <messageID> <nội dung>`);  }

  try {

    let found = null;

    for (const channel of message.guild.channels.cache.values()) {

      if (!channel.isTextBased()) continue;

      try {

        const msg = await channel.messages.fetch(msgID);

        if (msg) {
          found = msg;
          break;
        }

      } catch {}

    }

    if (!found) {
      return message.reply("Không tìm thấy message.");
    }

    await found.reply(text);

    try {
      await message.delete();
    } catch {}

  } catch (err) {

    console.error(err);
    message.reply("Lỗi khi reply.");

  }

}

  });

  client.login(config.token);

});
/* ===== LEVEL BOT ===== */


const levelBot = new Client({
  intents:[
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ]
});

levelBot.once("clientReady",()=>{
  console.log("📈 Level bot online:", levelBot.user.tag);
});

levelBot.on("messageCreate", async (message)=>{

  if(message.author.bot) return;

  const content = message.content;
  const id = message.author.id;

  /* ========= COMMANDS ========= */

  if(content.startsWith(LEVEL_PREFIX)){

  const args = content.slice(LEVEL_PREFIX.length).trim().split(/ +/);
  const cmd = args[0];

  // ===== PROFILE =====
  if(cmd === "profile"){

    const user = message.mentions.users.first() || message.author;

    const data = await getLevel(user.id);
    const need = xpNeeded(data.level);

    return message.reply(
`👤 ${user.username}

📈 Level: ${data.level}
⭐ XP: ${data.xp}/${need}`
    );
  }

    // ===== RANK =====
    if(cmd === "rank"){

      const data = await getLevel(id);

      return message.reply(
        `📈 Level: ${data.level}\nXP: ${data.xp}`
      );
    }

    // ===== HELP =====
    if(cmd === "help"){

      return message.reply(`
📊 Level Bot Commands

lvl!rank
→ xem level của bạn

lvl!profile
→ xem profile level

lvl!top
→ bảng xếp hạng server

lvl!reset @user
→ reset level người dùng (mod)

lvl!resetall
→ reset toàn server (mod)
`);
    }

    // ===== TOP =====
    if(cmd === "top"){

      const res = await pool.query(
        "SELECT * FROM levels ORDER BY level DESC, xp DESC LIMIT 10"
      );

      let text = "🏆 Leaderboard\n";

      res.rows.forEach((user,i)=>{

        const member = message.guild.members.cache.get(user.userid);
        const name = member ? member.user.username : "Unknown";

        text += `${i+1}. ${name} Lv.${user.level}\n`;
      });

      return message.reply(text);
    }

    // ===== RESET USER =====
    if(cmd === "reset"){

      if(!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild))
        return message.reply("❌ Chỉ mod mới dùng được.");

      const user = message.mentions.users.first();
      if(!user) return message.reply("❌ Hãy tag người cần reset.");

      await pool.query(
        "UPDATE levels SET xp=0, level=1 WHERE userid=$1",
        [user.id]
      );

      return message.reply(`🔄 Đã reset level của ${user.username}`);
    }

    // ===== RESET ALL =====
    if(cmd === "resetall"){

      if(!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild))
        return message.reply("❌ Chỉ mod mới dùng được.");

      await pool.query("DELETE FROM levels");

      return message.reply("💥 Đã reset toàn bộ level server.");
    }

    return;
  }

  /* ========= CHAT XP ========= */

if(content.length < 5) return; // chống spam tin nhắn ngắn

if(cooldown.has(id)){

  const timeLeft = cooldown.get(id) - Date.now();

  if(timeLeft > 0) return;

}

// cooldown 15s
cooldown.set(id, Date.now() + 15000);

// random xp
const xp = Math.floor(Math.random()*8)+5;

const data = await getLevel(id);

data.xp += xp;

const need = xpNeeded(data.level);

if(data.xp >= need){

  data.xp -= need;
  data.level++;

  message.channel.send(
    `🎉 ${message.author.username} đã lên level ${data.level}!`
  );
}

await saveLevel(id,data.xp,data.level);

});
// VOICEXP
setInterval(async () => {

  levelBot.guilds.cache.forEach(async guild => {

    guild.channels.cache.forEach(async channel => {

      if(!channel.isVoiceBased()) return;

      channel.members.forEach(async member => {

        if(member.user.bot) return;
        if(member.voice.selfMute || member.voice.selfDeaf) return;

        const id = member.user.id;
        const data = await getLevel(id);

        data.xp += 10;

        const need = xpNeeded(data.level);

        if(data.xp >= need){

          data.xp -= need;
          data.level++;

          const textChannel = guild.systemChannel;

          if(textChannel){
            textChannel.send(
              `🎉 ${member.user.username} đã lên level ${data.level}!`
            );
          }

        }

        await saveLevel(id,data.xp,data.level);

      });

    });

  });

}, 60000);

levelBot.login(LEVEL_TOKEN);