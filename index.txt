require("dotenv").config();
const cooldown = new Map();
const fs = require("fs");	
const axios = require("axios");
const { Pool } = require("pg");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
const { Client, GatewayIntentBits, PermissionsBitField , EmbedBuilder} = require("discord.js");
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

xp_week INT DEFAULT 0,
lvl_week INT DEFAULT 1,

xp_month INT DEFAULT 0,
lvl_month INT DEFAULT 1,

xp_year INT DEFAULT 0,
lvl_year INT DEFAULT 1
)
`);
}
await pool.query(`
CREATE TABLE IF NOT EXISTS rewards (
id SERIAL PRIMARY KEY,
userid TEXT,
reward TEXT
)
`);

initDB();
async function getLevel(id){

const res = await pool.query(
"SELECT * FROM levels WHERE userid=$1",
[id]
);

if(res.rows.length === 0){

await pool.query(
`INSERT INTO levels
(userid,xp_week,lvl_week,xp_month,lvl_month,xp_year,lvl_year)
VALUES($1,0,1,0,1,0,1)`,
[id]
);

return {
xp_week:0,lvl_week:1,
xp_month:0,lvl_month:1,
xp_year:0,lvl_year:1
};

}

return res.rows[0];
}
async function saveLevel(id,data){

await pool.query(
`UPDATE levels SET

xp_week=$1,
lvl_week=$2,

xp_month=$3,
lvl_month=$4,

xp_year=$5,
lvl_year=$6

WHERE userid=$7`,

[
data.xp_week,
data.lvl_week,

data.xp_month,
data.lvl_month,

data.xp_year,
data.lvl_year,

id
]
);
}// ======anime search ====
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
${prefix}hand
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

 const chat = await groq.chat.completions.create({
messages:[
{role:"system",content:config.personality},
{role:"user",content:"Tạo 1 câu anime dễ thương khi xoa đầu người yêu"}
],
model:"llama-3.3-70b-versatile"
});

const text = chat.choices[0].message.content;

return message.reply(text + "\n" + gif);

}
// ===== HUG =====

if (content === prefix + "hug") {

  const gif = await getAnimeGif("hug");

  if (!gif) return message.reply("Không tìm được GIF 😢");

  const chat = await groq.chat.completions.create({
messages:[
{role:"system",content:config.personality},
{role:"user",content:"Tạo 1 câu anime dễ thương khi ôm người yêu"}
],
model:"llama-3.3-70b-versatile"
});

const text = chat.choices[0].message.content;

return message.reply(text + "\n" + gif);

}
// ===== KISS =====

if (content === prefix + "kiss") {

  const gif = await getAnimeGif("kiss");

  if (!gif) return message.reply("Không tìm được GIF 😢");

  const chat = await groq.chat.completions.create({
messages:[
{role:"system",content:config.personality},
{role:"user",content:"Tạo 1 câu anime dễ thương khi hôn người yêu"}
],
model:"llama-3.3-70b-versatile"
});

const text = chat.choices[0].message.content;

return message.reply(text + "\n" + gif);

}
// ===== BLUSH =====

if (content === prefix + "blush") {

  const gif = await getAnimeGif("blush");

  if (!gif) return message.reply("Không tìm được GIF 😢");

  const chat = await groq.chat.completions.create({
messages:[
{role:"system",content:config.personality},
{role:"user",content:"Tạo 1 câu anime dễ thương khi ngại với người yêu"}
],
model:"llama-3.3-70b-versatile"
});

const text = chat.choices[0].message.content;

return message.reply(text + "\n" + gif);

}
// ===== Handhold =====

if (content === prefix + "hand") {

  const gif = await getAnimeGif("handhold");

  if (!gif) return message.reply("Không tìm được GIF 😢");

  const chat = await groq.chat.completions.create({
messages:[
{role:"system",content:config.personality},
{role:"user",content:"Tạo 1 câu anime dễ thương khi nắm tay người yêu"}
],
model:"llama-3.3-70b-versatile"
});

const text = chat.choices[0].message.content;

return message.reply(text + "\n" + gif);

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
const data = await getLevel(id);

const needWeek = xpNeeded(data.lvl_week);
const needMonth = xpNeeded(data.lvl_month);
const needYear = xpNeeded(data.lvl_year);
    const rewards = await pool.query(
"SELECT reward FROM rewards WHERE userid=$1",
[id]
);

let rewardText = "None";

if(rewards.rows.length > 0){
rewardText = rewards.rows.map(r=>"🏆 "+r.reward).join("\n");
}

const profileText = `👤 ${message.author.username}

📅 Week
Lv ${data.lvl_week}
XP ${data.xp_week}/${needWeek}

🗓 Month
Lv ${data.lvl_month}
XP ${data.xp_month}/${needMonth}

📆 Year
Lv ${data.lvl_year}
XP ${data.xp_year}/${needYear}

🏅 Thành tích
${rewardText}
`;

const embed = new EmbedBuilder()
.setTitle("📊 PROFILE")
.setDescription(profileText)
.setColor("#ff66cc");

return message.reply({embeds:[embed]});
}
    // ===== RANK =====
    if(cmd === "rank"){

    const data = await getLevel(id);

const needWeek = xpNeeded(data.lvl_week);
const needMonth = xpNeeded(data.lvl_month);
const needYear = xpNeeded(data.lvl_year);

return message.reply(
`📊 LEVEL

📅 Week
Lv ${data.lvl_week}
XP ${data.xp_week}/${needWeek}

🗓 Month
Lv ${data.lvl_month}
XP ${data.xp_month}/${needMonth}

📆 Year
Lv ${data.lvl_year}
XP ${data.xp_year}/${needYear}
`
);
    }
// ====REWARD
if(cmd === "reward"){

if(!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild))
return;

const user = message.mentions.users.first();

const text = args.slice(2).join(" ");

if(!user || !text)
return message.reply("lvl!reward @user <text>");

await pool.query(
"INSERT INTO rewards(userid,reward) VALUES($1,$2)",
[user.id,text]
);

message.reply("🏆 Đã thêm thành tích");

}
    // ===== HELP =====
    if(cmd === "help"){

      return message.reply(`
📊 Level Bot Commands
lvl!rank
lvl!profile
lvl!top
lvl!reset week
lvl!reset month
lvl!reset year
lvl!reward @user <text>
`);
    }

    // ===== TOP =====
    if(cmd === "top"){

      const res = await pool.query(
        "SELECT * FROM levels ORDER BY lvl_year DESC, xp_year DESC LIMIT 10"
      );

      let text = "🏆 Leaderboard\n";

      res.rows.forEach((user,i)=>{

        const member = message.guild.members.cache.get(user.userid);
        const name = member ? member.user.username : "Unknown";

        text += `${i+1}. ${name} Lv.${user.lvl_year}\n`;
      });

      return message.reply(text);
    }

    // ===== RESET USER =====
   if(cmd === "reset"){

if(!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild))
return message.reply("❌ Mod only");

const type = args[1];

if(type === "week"){

await pool.query(
"UPDATE levels SET xp_week=0,lvl_week=1"
);

return message.reply("🔄 Reset tuần");

}

if(type === "month"){

await pool.query(
"UPDATE levels SET xp_month=0,lvl_month=1"
);

return message.reply("🔄 Reset tháng");

}

if(type === "year"){

await pool.query(
"UPDATE levels SET xp_year=0,lvl_year=1"
);

return message.reply("🔄 Reset năm");

}

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

data.xp_week += xp;
data.xp_month += xp;
data.xp_year += xp;

const needWeek = xpNeeded(data.lvl_week);
const needMonth = xpNeeded(data.lvl_month);
const needYear = xpNeeded(data.lvl_year);

if(data.xp_week >= needWeek){
data.xp_week -= needWeek;
data.lvl_week++;
}

if(data.xp_month >= needMonth){
data.xp_month -= needMonth;
data.lvl_month++;
}

if(data.xp_year >= needYear){
data.xp_year -= needYear;
data.lvl_year++;
}
}

await saveLevel(id,data);

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

       data.xp_week += 10;
	data.xp_month += 10;
	data.xp_year += 10;

        const need = xpNeeded(data.lvl_year);

        if(data.xp_year >= need){

data.xp_year -= need;
data.lvl_year++;

          const textChannel = guild.systemChannel;

          if(textChannel){
            textChannel.send(
              `🎉 ${member.user.username} đã lên level ${data.level}!`
            );
          }

        }

        await saveLevel(id,data);

      });

    });

  });

}, 60000);

levelBot.login(LEVEL_TOKEN);