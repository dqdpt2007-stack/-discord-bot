require('dotenv').config();

const token = process.env.DISCORD_TOKEN;
const aiKey = process.env.API_KEY;
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
const Groq = require("groq-sdk");

const groq = new Groq({
  apiKey: process.env.API_KEY
});
const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const prefix = "^";

client.on('ready', () => {
  console.log(`Bot đã online: ${client.user.tag}`);
});

client.on('messageCreate', async message => {

  if (message.author.bot) return;

  // ---------------- BASIC ----------------

  if (message.content === "^hi") {
    message.reply("Anh chào em");
  }

  if (message.content === "^sleep") {
    message.reply("Ngủ ngon nha bé ngoan của anh");
  }

  if (message.content === "^coin") {
    const kq = Math.random() < 0.5 ? "Ngửa" : "Sấp";
    message.reply("Kết quả: " + kq);
  }

  if (message.content === "^roll") {
    const so = Math.floor(Math.random() * 100) + 1;
    message.reply("Số của bạn: " + so);
  }

  // ---------------- LOVE ----------------

  if (message.content === "^love") {

    const percent = Math.floor(Math.random() * 101);
    let gif;

    if (percent > 80) {
      gif = "https://media.giphy.com/media/G3va31oEEnIkM/giphy.gif";
    } else if (percent > 50) {
      gif = "https://media.giphy.com/media/3o7TKTDn976rzVgky4/giphy.gif";
    } else {
      gif = "https://media.giphy.com/media/kXdo4BgGoFC80/giphy.gif";
    }

    message.reply(`💖 Độ thiện cảm: **${percent}%**\n${gif}`);
  }

  // ---------------- HELP ----------------

  if (message.content === "^help") {
    message.reply(`
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
^ai <text> - chat ai
    `);
  }

  // ---------------- HUG ----------------

  if (message.content === "^hug") {

    const gifs = [
      "https://media.giphy.com/media/QFPoctlgZ5s0E/giphy.gif",
      "https://media.giphy.com/media/svXXBgduBsJ1u/giphy.gif",
      "https://media.giphy.com/media/WynnqxhdFEPYY/giphy.gif"
    ];

    const gif = gifs[Math.floor(Math.random()*gifs.length)];

    message.reply("🤗 Nay cũng biết đòi ôm luôn à\n" + gif);
  }

  // ---------------- KISS ----------------

  if (message.content === "^kiss") {

    const gifs = [
      "https://media.giphy.com/media/FqBTvSNjNzeZG/giphy.gif",
      "https://media.giphy.com/media/bGm9FuBCGg4SY/giphy.gif"
    ];

    const gif = gifs[Math.floor(Math.random()*gifs.length)];

    message.reply("💋 Chụt\n" + gif);
  }

  // ---------------- LICK ----------------

  if (message.content === "^lick") {

    const gifs = [
      "https://media.giphy.com/media/11k3oaUjSlFR4I/giphy.gif",
      "https://media.giphy.com/media/QX6wZEQB33qaheyJlw/giphy.gif",
      "https://media.giphy.com/media/ICOgUNjpvO0PC/giphy.gif"
    ];

    const gif = gifs[Math.floor(Math.random()*gifs.length)];

    message.reply("👅\n" + gif);
  }

  // ---------------- BOOBS ----------------

  if (message.content === "^boobs") {

    const gifs = [
      "https://media.giphy.com/media/10yIEN8cMn4i9W/giphy.gif",
      "https://media.giphy.com/media/3o6Zt481isNVuQI1l6/giphy.gif"
    ];

    const gif = gifs[Math.floor(Math.random()*gifs.length)];

    message.reply("😏 Surprise\n" + gif);
  }
// ------------AI-----------------------
if (message.content.startsWith("^ai ")) {

  const prompt = message.content.slice(4);

  try {

    const chat = await groq.chat.completions.create({
  messages: [
    { role: "system", content: personality },
    { role: "user", content: prompt }
  ],
  model: "llama-3.3-70b-versatile"
});

    message.reply(chat.choices[0].message.content);

  } catch (err) {

    console.log(err);
    message.reply("AI lỗi rồi 🥲");

  }

}
  // ---------------- REP BY ID ----------------

  if (message.content.startsWith("^rep")) {

  const args = message.content.split(" ");
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

    // xoá tin nhắn lệnh
    try {
      await message.delete();
    } catch {}

  } catch (err) {
    console.log(err);
    message.reply("Lỗi khi reply.");
  }

}

});
client.login(process.env.DISCORD_TOKEN);