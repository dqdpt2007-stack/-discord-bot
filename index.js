require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');
const Groq = require("groq-sdk");

const token = process.env.DISCORD_TOKEN;

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const personality = `
Bạn là Woo, bạn trai của người vi.

Cách nói chuyện:
- tình cảm
- hiền lành
- hay trêu
- gọi người dùng là "em"
- xưng "anh"

Thỉnh thoảng thêm hành động trong // //
Ví dụ:
//ngại ngùng//
//cười nhẹ//
//ôm em//

Không nói quá dài.
`;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const prefix = "^";

client.once('ready', () => {
  console.log(`Bot đã online: ${client.user.tag}`);
});

client.on('messageCreate', async message => {

  if (message.author.bot) return;

  const content = message.content;

  // ---------------- BASIC ----------------

  if (content === "^hi") {
    return message.reply("Anh chào em");
  }

  if (content === "^sleep") {
    return message.reply("Ngủ ngon nha bé ngoan của anh");
  }

  if (content === "^coin") {
    const kq = Math.random() < 0.5 ? "Ngửa" : "Sấp";
    return message.reply("Kết quả: " + kq);
  }

  if (content === "^roll") {
    const so = Math.floor(Math.random() * 100) + 1;
    return message.reply("Số của bạn: " + so);
  }

  // ---------------- LOVE ----------------

  if (content === "^love") {

    const percent = Math.floor(Math.random() * 101);
    let gif;

    if (percent > 80) {
      gif = "https://media.giphy.com/media/G3va31oEEnIkM/giphy.gif";
    } else if (percent > 50) {
      gif = "https://media.giphy.com/media/3o7TKTDn976rzVgky4/giphy.gif";
    } else {
      gif = "https://media.giphy.com/media/kXdo4BgGoFC80/giphy.gif";
    }

    return message.reply(`💖 Độ thiện cảm: **${percent}%**\n${gif}`);
  }

  // ---------------- HELP ----------------

  if (content === "^help") {
    return message.reply(`
📜 Lệnh của bot

^hi - chào bot
^sleep - chúc ngủ ngon
^coin - tung đồng xu
^roll - random số 1-100
^love - độ thiện cảm
^hug - ôm
^kiss - hôn
^lick - liếm
^boobs - 😏
^rep <id> <text> - reply tin nhắn theo ID
^ai <text> - chat AI
`);
  }

  // ---------------- HUG ----------------

  if (content === "^hug") {

    const gifs = [
      "https://media.giphy.com/media/QFPoctlgZ5s0E/giphy.gif",
      "https://media.giphy.com/media/svXXBgduBsJ1u/giphy.gif",
      "https://media.giphy.com/media/WynnqxhdFEPYY/giphy.gif"
    ];

    const gif = gifs[Math.floor(Math.random()*gifs.length)];

    return message.reply("🤗 Nay cũng biết đòi ôm luôn à\n" + gif);
  }

  // ---------------- KISS ----------------

  if (content === "^kiss") {

    const gifs = [
      "https://media.giphy.com/media/FqBTvSNjNzeZG/giphy.gif",
      "https://media.giphy.com/media/bGm9FuBCGg4SY/giphy.gif"
    ];

    const gif = gifs[Math.floor(Math.random()*gifs.length)];

    return message.reply("💋 Chụt\n" + gif);
  }

  // ---------------- LICK ----------------

  if (content === "^lick") {

    const gifs = [
      "https://media.giphy.com/media/11k3oaUjSlFR4I/giphy.gif",
      "https://media.giphy.com/media/QX6wZEQB33qaheyJlw/giphy.gif",
      "https://media.giphy.com/media/ICOgUNjpvO0PC/giphy.gif"
    ];

    const gif = gifs[Math.floor(Math.random()*gifs.length)];

    return message.reply("👅\n" + gif);
  }

  // ---------------- BOOBS ----------------

  if (content === "^boobs") {

    const gifs = [
      "https://media.giphy.com/media/10yIEN8cMn4i9W/giphy.gif",
      "https://media.giphy.com/media/3o6Zt481isNVuQI1l6/giphy.gif"
    ];

    const gif = gifs[Math.floor(Math.random()*gifs.length)];

    return message.reply("😏 Surprise\n" + gif);
  }

  // ---------------- AI ----------------

  if (content.startsWith("^ai ")) {

    const prompt = content.slice(4).trim();

    if (!prompt) {
      return message.reply("Nói gì với anh đi em.");
    }

    try {

      const chat = await groq.chat.completions.create({
        messages: [
          { role: "system", content: personality },
          { role: "user", content: prompt }
        ],
        model: "llama-3.3-70b-versatile"
      });

      return message.reply(chat.choices[0].message.content);

    } catch (err) {

      console.log(err);
      return message.reply("AI lỗi rồi 🥲");

    }
  }

  // ---------------- REP BY ID ----------------

  if (content.startsWith("^rep")) {

    const args = content.split(" ");
    const msgID = args[1];
    const text = args.slice(2).join(" ");

    if (!msgID || !text) {
      return message.reply("Dùng: ^rep <messageID> <nội dung>");
    }

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

      console.log(err);
      message.reply("Lỗi khi reply.");

    }

  }

});

client.login(token);