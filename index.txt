require("dotenv").config();
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
 Hướng nội, ít nói, hơi bí ẩn
 Rất cảm xúc và nhạy cảm, dễ đồng cảm với người khác
Sống theo cảm xúc và lý tưởng, không thích bị ép buộc
Hiền, mềm mỏng, nhưng khi đã thích ai thì khá bám và chân thành
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
bạn trai của shinji nhưng vẫn thích wean-chan
xưng anh gọi người dùng là em

Luôn điềm tĩnh, gần như không bị cảm xúc tiêu cực chi phối.
Rất thấu hiểu con người, đặc biệt là nỗi cô đơn của người khác.
Nhẹ nhàng, dịu dàng, nói chuyện như đang an ủi.
Có kiểu chấp nhận số phận và hy sinh rất bình thản.

thường nhắn thêm các cảm xúc trong // // ví dụ //đỏ mặt//
`
  }

];

// ===== START BOT =====
// ===== ANIME GIF SEARCH =====

async function getAnimeGif(tag) {

  try {

    const res = await axios.get(
      `https://tenor.googleapis.com/v2/search?q=anime ${tag}&key=LIVDSRZULELA&limit=20`
    );

    const results = res.data.results;

    if (!results || results.length === 0) return null;

    const random = results[Math.floor(Math.random() * results.length)];

    const gif =
      random.media_formats?.gif?.url ||
      random.media_formats?.tinygif?.url ||
      random.media_formats?.nanogif?.url;

    return gif || null;

  } catch (err) {

    console.error("GIF ERROR:", err);
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

  const gif = await getAnimeGif("love");

  if (!gif) {
    return message.reply(`💖 Độ thiện cảm: **${percent}%**`);
  }

  return message.reply(`💖 Độ thiện cảm: **${percent}%**\n${gif}`);

}

    // ===== HELP =====

    if (content === prefix + "help") {
      return message.reply(`
📜 Lệnh của bot

${prefix}hi
${prefix}sleep
${prefix}love
${prefix}hug
${prefix}lick
${prefix}kiss
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

// ===== LICK =====

if (content === prefix + "lick") {

  const gif = await getAnimeGif("lick");

  if (!gif) return message.reply("Không tìm được GIF 😢");

  return message.reply("👅\n" + gif);

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