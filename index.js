require("dotenv").config();
const fs = require("fs");	
const axios = require("axios");

const { Client, GatewayIntentBits } = require("discord.js");
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

let levels = {};
const cooldown = new Map();

if (fs.existsSync("./levels.json")) {
  levels = JSON.parse(fs.readFileSync("./levels.json"));
}

function xpNeeded(level){
  return 50 * level * level + 50 * level;
}

// ===== START BOT =====
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
      return message.reply("Anh chào em nhaư");
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
// ===== LEVEL BOT =====

const levelBot = new Client({
  intents:[
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

levelBot.once("clientReady",()=>{
  console.log("📈 Level bot online:", levelBot.user.tag);
});

levelBot.on("messageCreate",(message)=>{

  if(message.author.bot) return;

  const content = message.content;

  const id = message.author.id;

  if(!levels[id]){
    levels[id] = {xp:0, level:1};
  }

  /*
  ========= COMMANDS
  */

  if(content.startsWith(LEVEL_PREFIX)){

    const cmd = content.slice(LEVEL_PREFIX.length);

    if(cmd === "rank"){

      return message.reply(
        `📈 Level: ${levels[id].level}\nXP: ${levels[id].xp}`
      );

    }

    if(cmd === "help"){

  return message.reply(`
📊 **Level Bot Commands**

lvl!rank  
→ xem level và XP của bạn

lvl!top  
→ bảng xếp hạng level server

lvl!help  
→ xem danh sách lệnh

📈 XP System
• Chat: 5-15 XP
• Voice: 20 XP / phút
• Cooldown: 10s
`);

}

    if(cmd === "top"){

  const sorted = Object.entries(levels)
    .sort((a,b)=>b[1].level - a[1].level)
    .slice(0,10);

  let text = "🏆 Leaderboard\n";

  sorted.forEach((user,i)=>{

    const member = message.guild.members.cache.get(user[0]);
    const name = member ? member.user.username : "Unknown";

    text += `${i+1}. ${name} Lv.${user[1].level}\n`;

  });

  return message.reply(text);

}
// =====RESET LVL==========
if(cmd === "reset"){

  if(!message.member.permissions.has("ManageGuild"))
    return message.reply("❌ Chỉ mod mới dùng được.");

  const user = message.mentions.users.first();
  if(!user) return message.reply("❌ Hãy tag người cần reset.");

  levels[user.id] = {xp:0, level:1};

  fs.writeFileSync("./levels.json", JSON.stringify(levels,null,2));

  return message.reply(`🔄 Đã reset level của ${user.username}`);
}


if(cmd === "resetall"){

  if(!message.member.permissions.has("ManageGuild"))
    return message.reply("❌ Chỉ mod mới dùng được.");

  levels = {};

  fs.writeFileSync("./levels.json", JSON.stringify(levels,null,2));

  return message.reply("💥 Đã reset toàn bộ level server.");
}

  /*
  ========= CHAT XP
  */

  if(content.length < 3) return;

  if(cooldown.has(id)){

    const timeLeft = cooldown.get(id) - Date.now();

    if(timeLeft > 0) return;

  }

  cooldown.set(id, Date.now() + 10000);

  const xp = Math.floor(Math.random()*10)+5;

  levels[id].xp += xp;

  const need = xpNeeded(levels[id].level);

  if(levels[id].xp >= need){

    levels[id].xp -= need;
    levels[id].level++;

    message.channel.send(
      `🎉 <@${id}> đã lên level ${levels[id].level}`
    );

  }

  fs.writeFileSync("./levels.json", JSON.stringify(levels,null,2));

});


/*
========= VOICE XP
*/

setInterval(()=>{

  levelBot.guilds.cache.forEach(guild=>{

    guild.members.cache.forEach(member=>{

      if(member.voice.channel && !member.user.bot){

        const id = member.id;

        if(!levels[id]){
          levels[id] = {xp:0, level:1};
        }

        levels[id].xp += 20;

      }

    });

  });

  fs.writeFileSync("./levels.json", JSON.stringify(levels,null,2));

},60000);


levelBot.login(LEVEL_TOKEN);