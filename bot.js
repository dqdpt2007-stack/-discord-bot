require("dotenv").config();
const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const googleTTS = require("google-tts-api");
const Groq = require("groq-sdk");
const { DisTube } = require("distube"); 
const { YtDlpPlugin } = require("@distube/yt-dlp");
const ffmpeg = require('ffmpeg-static');

// Ép bot dùng FFmpeg từ thư viện đã cài
process.env.FFMPEG_PATH = ffmpeg;

if (!process.env.DISCORD_TOKEN_1 || !process.env.DISCORD_TOKEN_2 || !process.env.GROQ_API_KEY) {
  console.error("❌ Thiếu Token/Groq Key trong .env");
  process.exit(1);
}

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const bots = [
  {
    token: process.env.DISCORD_TOKEN_1, prefix: "^", allowedUsers: ["1320722786586722329"], lang: "ko",
    personality: "Bạn là Woo, bạn trai của Vi. Ấm áp, vui vẻ. Xưng anh gọi em."
  },
  {
    token: process.env.DISCORD_TOKEN_2, prefix: "!!", allowedUsers: ["1473300330128080990"], lang: "ja",
    personality: "Bạn là Kaworu, bạn trai của shinji. Nhẹ nhàng, thấu hiểu. Xưng anh gọi em."
  }
];

async function getAnimeGif(tag) {
  try {
    const res = await axios.get(`https://nekos.best/api/v2/${tag}`);
    return res.data.results?.[0]?.url || null;
  } catch { return null; }
}

bots.forEach(config => {
  const client = new Client({
    intents: [3276799] // Full intents để tránh lỗi thiếu quyền
  });

  client.distube = new DisTube(client, {
    emitNewSongOnly: true,
    plugins: [new YtDlpPlugin()]
  });

  client.distube.on("playSong", (queue, song) => {
    queue.textChannel.send(`🎶 Anh đang mở bài: **${song.name}** cho em nè!`);
  });

  client.distube.on("error", (channel, e) => {
    if (channel) channel.send(`❌ Lỗi nhạc: ${e.message.slice(0, 100)}`);
  });

  client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.content.startsWith(config.prefix)) return;
    const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
    const cmd = args.shift().toLowerCase();

    if (cmd === "play") {
      const vc = message.member?.voice?.channel;
      if (!vc) return message.reply("Vào Voice đi em!");
      client.distube.play(vc, args.join(" "), { textChannel: message.channel, member: message.member, message });
    }
    
    if (cmd === "ai") {
      try {
        const chat = await groq.chat.completions.create({
          messages: [{ role: "system", content: config.personality }, { role: "user", content: args.join(" ") }],
          model: "llama-3.3-70b-versatile"
        });
        message.reply(chat.choices[0].message.content);
      } catch { message.reply("Anh lỗi tí..."); }
    }
    // Bạn có thể copy thêm các lệnh stop, skip, love từ code cũ vào đây sau.
  });

  client.once("ready", (c) => console.log(`🚀 ${c.user.tag} ĐÃ ONLINE!`));
  client.login(config.token);
});