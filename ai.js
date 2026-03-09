require("dotenv").config();
const ffmpeg = require('ffmpeg-static');
process.env.FFMPEG_PATH = ffmpeg;

const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const googleTTS = require('google-tts-api'); 
const Groq = require("groq-sdk");
const { DisTube } = require("distube"); 
const { YtDlpPlugin } = require("@distube/yt-dlp");
const { DirectLinkPlugin } = require("@distube/direct-link");

// ===== KIỂM TRA BIẾN MÔI TRƯỜNG =====
if (!process.env.DISCORD_TOKEN_1 || !process.env.DISCORD_TOKEN_2 || !process.env.GROQ_API_KEY) {
  console.error("❌ Thiếu Token hoặc API Key trong file .env!");
  process.exit(1);
}

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ===== CẤU HÌNH CÁC BOT =====
const bots = [
  {
    token: process.env.DISCORD_TOKEN_1,
    prefix: "^",
    allowedUsers: ["1320722786586722329"], 
    lang: "ko",
    personality: `Bạn là Woo, bạn trai của Vi. Ấm áp, vui vẻ, trung thực. Xưng anh gọi em. //ngại ngùng//`
  },
  {
    token: process.env.DISCORD_TOKEN_2,
    prefix: "!!", 
    allowedUsers: ["1473300330128080990"], 
    lang: "ja",
    personality: `Bạn là Kaworu, bạn trai của shinji. Điềm tĩnh, thấu hiểu. //đỏ mặt//`
  }
];

async function getAnimeGif(tag) {
  try {
    const res = await axios.get(`https://nekos.best/api/v2/${tag}`);
    return res.data.results?.[0]?.url || null;
  } catch (err) { return null; }
}

bots.forEach(config => {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds, 
      GatewayIntentBits.GuildMessages, 
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates 
    ]
  });

  // Sửa lỗi cảnh báo YtDlpPlugin (Nên để DirectLink lên trước hoặc config plugin hợp lệ)
  client.distube = new DisTube(client, {
    emitNewSongOnly: true,
    savePreviousSongs: false,
    plugins: [
      new DirectLinkPlugin(),
      new YtDlpPlugin() // YtDlpPlugin nên để sau cùng để tránh xung đột nhận diện link
    ]
  });

  client.distube.on("playSong", (queue, song) => {
    queue.textChannel.send(`🎶 Anh đang mở bài: **${song.name}** cho em nghe nè!`);
  });

  // Sửa lỗi đổi tên sự kiện từ 'ready' thành 'clientReady' cho Discord.js v14+
  client.once("clientReady", (c) => console.log(`✅ AI Bot đã sẵn sàng: ${c.user.tag}`));

  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    const prefix = config.prefix;
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/g);
    const command = args.shift().toLowerCase();

    const isAllowedUser = config.allowedUsers.includes(message.author.id);
    const isMod = message.member?.permissions.has(PermissionsBitField.Flags.ManageMessages);
    if (!isAllowedUser && !isMod) return; 

    // --- LỆNH SAY (Sửa lỗi hoàn chỉnh) ---
    if (command === "say") {
      const text = args.join(" ");
      const voiceChannel = message.member?.voice?.channel;
      if (!text || !voiceChannel) return message.reply("Em vào voice rỉ tai anh nói gì đi!");

      try {
        // Sử dụng googleTTS trực tiếp trong lệnh
        const ttsUrl = googleTTS.getAudioUrl(text, {
          lang: config.lang,
          slow: false,
          host: 'https://translate.google.com',
        });

        await client.distube.play(voiceChannel, ttsUrl, { 
          member: message.member, 
          textChannel: message.channel,
          skip: true 
        });
      } catch (e) { 
        console.error(e);
        message.reply("Cổ họng anh hơi đau rồi..."); 
      }
      return;
    }

    // --- CÁC LỆNH NHẠC KHÁC (GIỮ NGUYÊN) ---
    if (command === "play") {
        const voiceChannel = message.member?.voice?.channel;
        if (!voiceChannel) return message.reply("Vào phòng voice đã em ơi!");
        const query = args.join(" ");
        if (!query) return message.reply("Bài gì nè?");
        client.distube.play(voiceChannel, query, { member: message.member, textChannel: message.channel, message });
    }

    if (command === "stop") {
        const queue = client.distube.getQueue(message);
        if (queue) queue.stop();
        return message.reply("⏹️ Tắt nhạc nha.");
    }

    // --- LỆNH AI ---
    if (command === "ai") {
      const prompt = args.join(" ");
      if (!prompt) return message.reply("Nói gì đi em...");
      try {
        const chat = await groq.chat.completions.create({
          messages: [ { role: "system", content: config.personality }, { role: "user", content: prompt } ],
          model: "llama-3.3-70b-versatile"
        });
        return message.reply(chat.choices[0].message.content.substring(0, 2000));
      } catch (err) { return message.reply("Anh hơi chóng mặt..."); }
    }
  });

  client.login(config.token).catch(err => console.error(`❌ Lỗi Login!`));
});