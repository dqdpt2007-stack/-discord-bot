require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");
const Groq = require("groq-sdk");

// ===== CHECK ENV =====

if (!process.env.DISCORD_TOKEN) {
  console.error("❌ Missing DISCORD_TOKEN in environment variables");
  process.exit(1);
}

if (!process.env.GROQ_API_KEY) {
  console.error("❌ Missing GROQ_API_KEY in environment variables");
  process.exit(1);
}

// ===== DISCORD CLIENT =====

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ===== GROQ AI =====

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const prefix = "^";

// ===== BOT PERSONALITY =====

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

// ===== READY =====

client.once("ready", () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
});

// ===== MESSAGE =====

client.on("messageCreate", async (message) => {

  if (message.author.bot) return;

  const content = message.content;

  // ===== HI =====

  if (content === "^hi") {
    return message.reply("Anh chào em");
  }

  // ===== SLEEP =====

  if (content === "^sleep") {
    return message.reply("Ngủ ngon nha bé ngoan của anh");
  }

  // ===== COIN =====

  if (content === "^coin") {
    const kq = Math.random() < 0.5 ? "Ngửa" : "Sấp";
    return message.reply("Kết quả: " + kq);
  }

  // ===== ROLL =====

  if (content === "^roll") {
    const so = Math.floor(Math.random() * 100) + 1;
    return message.reply("Số của bạn: " + so);
  }

  // ===== LOVE =====

  if (content === "^love") {

    const percent = Math.floor(Math.random() * 101);

    const gifs = [
      "https://media.giphy.com/media/G3va31oEEnIkM/giphy.gif",
      "https://media.giphy.com/media/3o7TKTDn976rzVgky4/giphy.gif",
      "https://media.giphy.com/media/kXdo4BgGoFC80/giphy.gif"
    ];

    const gif = gifs[Math.floor(Math.random() * gifs.length)];

    return message.reply(`💖 Độ thiện cảm: **${percent}%**\n${gif}`);
  }

  // ===== HUG =====

  if (content === "^hug") {

    const gifs = [
      "https://media.giphy.com/media/QFPoctlgZ5s0E/giphy.gif",
      "https://media.giphy.com/media/svXXBgduBsJ1u/giphy.gif",
      "https://media.giphy.com/media/WynnqxhdFEPYY/giphy.gif"
    ];

    const gif = gifs[Math.floor(Math.random() * gifs.length)];

    return message.reply("🤗 Nay cũng biết đòi ôm luôn à\n" + gif);
  }

  // ===== KISS =====

  if (content === "^kiss") {

    const gifs = [
      "https://media.giphy.com/media/FqBTvSNjNzeZG/giphy.gif",
      "https://media.giphy.com/media/bGm9FuBCGg4SY/giphy.gif"
    ];

    const gif = gifs[Math.floor(Math.random() * gifs.length)];

    return message.reply("💋 Chụt\n" + gif);
  }

  // ===== LICK =====

  if (content === "^lick") {

    const gifs = [
      "https://media.giphy.com/media/11k3oaUjSlFR4I/giphy.gif",
      "https://media.giphy.com/media/QX6wZEQB33qaheyJlw/giphy.gif",
      "https://media.giphy.com/media/ICOgUNjpvO0PC/giphy.gif"
    ];

    const gif = gifs[Math.floor(Math.random() * gifs.length)];

    return message.reply("👅\n" + gif);
  }

  // ===== HELP =====

  if (content === "^help") {
    return message.reply(`
📜 Lệnh của bot

^hi - chào bot
^sleep - chúc ngủ ngon
^coin - tung đồng xu
^roll - random số
^love - độ thiện cảm
^hug - ôm
^kiss - hôn
^lick - liếm
^rep <id> <text> - reply tin nhắn
^ai <text> - chat AI
`);
  }

  // ===== AI =====

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

      let reply = chat.choices?.[0]?.message?.content || "Anh chưa nghĩ ra trả lời.";

      if (reply.length > 2000) {
        reply = reply.substring(0, 2000);
      }

      return message.reply(reply);

    } catch (err) {

      console.error("AI ERROR:", err);
      return message.reply("AI lỗi rồi 🥲");

    }

  }

  // ===== REP =====

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

      console.error(err);
      message.reply("Lỗi khi reply.");

    }

  }

});

// ===== LOGIN =====

client.login(process.env.DISCORD_TOKEN);