require("dotenv").config();
const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const googleTTS = require("google-tts-api");
const Groq = require("groq-sdk");
const { DisTube } = require("distube"); // Thêm thư viện nhạc

// ===== CHECK ENV =====
if (!process.env.DISCORD_TOKEN_1 || !process.env.DISCORD_TOKEN_2) {
  console.error("❌ Missing DISCORD_TOKEN_1 or 2");
  process.exit(1);
}
if (!process.env.GROQ_API_KEY) {
  console.error("❌ Missing GROQ_API_KEY");
  process.exit(1);
}

// ===== GROQ =====
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ===== BOT CONFIG (ĐÃ CHIA RIÊNG NGƯỜI DÙNG CHO TỪNG BOT) =====
const bots = [
  {
    token: process.env.DISCORD_TOKEN_1,
    prefix: "^",
    allowedUsers: ["1320722786586722329"], 
    lang: "ko",
    personality: `
BOT 1
Bạn là Woo
bạn trai của Vi
cậu ấy có tính cách ấm áp và vui vẻ, trung thực và được nhiều người yêu mến
xưng anh gọi người dùng là em
thường thêm các cảm xúc trong // // ví dụ // ngại ngùng //
`
  },
  {
    token: process.env.DISCORD_TOKEN_2,
    prefix: "!!", 
    allowedUsers: ["1473300330128080990"], 
    lang: "ja",
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

// ===== ANIME SEARCH =====
async function getAnimeGif(tag) {
  try {
    const res = await axios.get(`https://nekos.best/api/v2/${tag}`);
    return res.data.results?.[0]?.url || null;
  } catch (err) { return null; }
}

// ==========================================
// ===== KHỞI ĐỘNG CÁC BOT AI ============
// ==========================================
bots.forEach(config => {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds, 
      GatewayIntentBits.GuildMessages, 
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates // QUAN TRỌNG: Cần intent này để vào Voice
    ]
  });

  // ===== CẤU HÌNH NHẠC CHO TỪNG BOT =====
  client.distube = new DisTube(client, {
    leaveOnEmpty: true,
    leaveOnFinish: false,
    leaveOnStop: true,
    emitNewSongOnly: true,
  });

  // Thông báo khi bắt đầu phát nhạc
  client.distube.on("playSong", (queue, song) => {
    queue.textChannel.send(`🎶 Anh đang mở bài: **${song.name}** - \`${song.formattedDuration}\` cho em nghe nè!`);
  });

  // Thông báo khi thêm vào hàng đợi
  client.distube.on("addSong", (queue, song) => {
    queue.textChannel.send(`✅ Đã thêm **${song.name}** vào danh sách chờ nha.`);
  });

  client.distube.on("error", (channel, e) => {
    if (channel) channel.send(`❌ Anh gặp lỗi phát nhạc rồi: ${e.toString().slice(0, 1970)}`);
    else console.error(e);
  });
  // ========================================

  client.once("ready", (c) => console.log(`✅ AI Bot online: ${c.user.tag}`));

  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    const content = message.content;
    const prefix = config.prefix;

    if (!content.startsWith(prefix)) return;

    // === KIỂM TRA QUYỀN ===
    const isAllowedUser = config.allowedUsers.includes(message.author.id);
    const isMod = message.member && (
      message.member.permissions.has(PermissionsBitField.Flags.ManageMessages) || 
      message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)
    );

    if (!isAllowedUser && !isMod) return; 

    // ==========================================
    // ===== LỆNH PHÁT NHẠC (MUSIC COMMANDS) ====
    // ==========================================
    
    // 1. Lệnh PLAY
    if (content.startsWith(prefix + "play ")) {
      const voiceChannel = message.member?.voice?.channel;
      if (!voiceChannel) return message.reply("Em phải vào phòng Voice trước thì anh mới mở nhạc được chứ!");
      
      const query = content.slice((prefix + "play ").length).trim();
      if (!query) return message.reply("Em muốn nghe bài gì? Gửi tên bài hoặc link cho anh nha.");

      message.reply(`🔍 Đang tìm bài **${query}** cho em nè...`);
      try {
        await client.distube.play(voiceChannel, query, {
          member: message.member,
          textChannel: message.channel,
          message
        });
      } catch (e) {
        message.channel.send(`❌ Khum mở được bài này rồi em ơi: \`${e.message}\``);
      }
      return;
    }

    // 2. Lệnh STOP
    if (content === prefix + "stop") {
      const queue = client.distube.getQueue(message);
      if (!queue) return message.reply("Hiện tại anh đâu có mở bài nào đâu em.");
      queue.stop();
      return message.reply("⏹️ Anh tắt nhạc rồi nha. Khi nào muốn nghe lại cứ gọi anh.");
    }

    // 3. Lệnh SKIP
    if (content === prefix + "skip") {
      const queue = client.distube.getQueue(message);
      if (!queue) return message.reply("Có bài nào đang phát đâu mà chuyển hỡi em.");
      try {
        if (queue.songs.length <= 1) {
          queue.stop();
          return message.reply("⏭️ Đã qua bài (Hết danh sách nên anh tắt nhạc nhé).");
        } else {
          await queue.skip();
          return message.reply("⏭️ Anh qua bài tiếp theo nha.");
        }
      } catch (e) {
        return message.reply(`❌ Lỗi khi chuyển bài: ${e.message}`);
      }
    }

    // 4. Lệnh QUEUE
    if (content === prefix + "queue") {
      const queue = client.distube.getQueue(message);
      if (!queue) return message.reply("Danh sách phát đang trống trơn à.");
      const q = queue.songs
        .map((song, i) => `${i === 0 ? "▶️ Đang phát:" : `**${i}.**`} ${song.name} - \`${song.formattedDuration}\``)
        .slice(0, 10)
        .join("\n");
      
      const qEmbed = new EmbedBuilder()
        .setTitle("📜 Danh sách phát nhạc của chúng mình")
        .setDescription(q)
        .setColor("#FFB6C1")
        .setFooter({ text: `Tổng cộng: ${queue.songs.length} bài hát` });
      return message.reply({ embeds: [qEmbed] });
    }
// 5. Lệnh SAY (Mỗi bot 1 thứ tiếng)
    if (content.startsWith(prefix + "say ")) {
      const text = content.slice((prefix + "say ").length).trim();
      const voiceChannel = message.member?.voice?.channel;

      if (!text) return message.reply("Em muốn anh nói gì nào?");
      if (!voiceChannel) return message.reply("Em vào Voice đi rồi anh rỉ tai cho nghe.");

      try {
        const url = googleTTS.getAudioUrl(text, { lang: config.lang, slow: false, host: "https://translate.google.com" });
        await client.distube.play(voiceChannel, url, { member: message.member, textChannel: message.channel });
      } catch (e) {
        message.reply(`❌ Cổ họng anh bị sao á: ${e.message}`);
      }
      return;
    }

    // ==========================================
    // ===== CÁC LỆNH AI CŨ CỦA BẠN DƯỚI NÀY ====
    // ==========================================

    if (content === prefix + "hi") return message.reply("Anh chào em nha");
    if (content === prefix + "sleep") return message.reply("Ngủ ngon nha bé ngoan của anh");

    if (content === prefix + "love") {
      const percent = Math.floor(Math.random() * 101);
      let action = "", gifTag = null;
      
      if (percent < 10) { action = "giận dỗi, lùi ra xa"; gifTag = "slap"; }
      else if (percent < 35) { action = "nắm tay nhẹ nhàng"; gifTag = "handhold"; }
      else if (percent < 50) { action = "xoa đầu dỗ dành"; gifTag = "pat"; }
      else if (percent < 80) { action = "ôm ấp tình cảm"; gifTag = "hug"; }
      else if (percent < 99) { action = "hôn nồng cháy"; gifTag = "kiss"; }
      else { action = "đỏ mặt, muốn kết hôn"; gifTag = "blush"; }

      let gif = gifTag ? await getAnimeGif(gifTag) : null;

      try {
        const chat = await groq.chat.completions.create({
          messages: [
            { role: "system", content: config.personality },
            { role: "user", content: `Người dùng vừa đo thiện cảm và đạt ${percent}%. Bạn đang có hành động: "${action}". Hãy nói 1 câu phù hợp với tình huống này và đúng tính cách của bạn.` }
          ],
          model: "llama-3.3-70b-versatile"
        });

        const loveEmbed = new EmbedBuilder()
          .setTitle(`💖 Độ thiện cảm: ${percent}%`)
          .setDescription(chat.choices[0].message.content)
          .setColor("#ff3399");

        if (gif) loveEmbed.setImage(gif);

        return message.reply({ embeds: [loveEmbed] });
      } catch (err) {
        return message.reply(`💖 Độ thiện cảm: **${percent}%**\nLỗi AI không nói được.`);
      }
    }

    if (content === prefix + "help") {
      const helpEmbed = new EmbedBuilder()
        .setTitle("📜 Danh Sách Lệnh AI Bot")
        .setColor("#00BFFF")
        .setDescription(`Dưới đây là các lệnh bạn có thể sử dụng (Prefix: **${prefix}**):`)
        .addFields(
          { name: "💬 Giao tiếp cơ bản", value: `\`${prefix}hi\` - Chào bot\n\`${prefix}sleep\` - Chúc bot ngủ ngon\n\`${prefix}love\` - Đo độ thiện cảm`, inline: false },
          { name: "🫂 Hành động (Có ảnh GIF)", value: `\`${prefix}hug\` - Ôm\n\`${prefix}pat\` - Xoa đầu\n\`${prefix}kiss\` - Hôn\n\`${prefix}blush\` - Ngại ngùng\n\`${prefix}hand\` - Nắm tay`, inline: false },
          { name: "🤖 Tính năng AI", value: `\`${prefix}ai <nội dung>\` - Chat với AI\n\`${prefix}rep <id tin nhắn> <nội dung>\` - Nhờ bot reply tin nhắn\n\`${prefix}say <nội dung>\` - Nhờ bot nói trong Voice`, inline: false }, // THÊM LỆNH SAY VÀO ĐÂY
          { name: "🎵 Âm nhạc", value: `\`${prefix}play <tên/link>\` - Phát nhạc\n\`${prefix}stop\` - Tắt nhạc\n\`${prefix}skip\` - Qua bài\n\`${prefix}queue\` - Xem danh sách phát`, inline: false }
        )
        .setFooter({ text: "Bot Tương Tác & Phát Nhạc" });
      return message.reply({ embeds: [helpEmbed] });
    }

    if (content.startsWith(prefix + "ai ")) {
      const prompt = content.slice((prefix + "ai ").length).trim();
      if (!prompt) return message.reply("Nói gì đi.");
      try {
        const chat = await groq.chat.completions.create({
          messages: [ { role: "system", content: config.personality }, { role: "user", content: prompt } ],
          model: "llama-3.3-70b-versatile"
        });
        let reply = chat.choices?.[0]?.message?.content || "Không nghĩ ra câu trả lời.";
        if (reply.length > 2000) reply = reply.substring(0, 2000);
        return message.reply(reply);
      } catch (err) {
        return message.reply("AI lỗi rồi");
      }
    }

    const interactions = ["pat", "hug", "kiss", "blush", "hand"];
    const interactMap = { pat: "xoa đầu", hug: "ôm", kiss: "hôn", blush: "ngại với", hand: "nắm tay" };

    for (const action of interactions) {
      if (content === prefix + action) {
        let queryTag = action === "hand" ? "handhold" : action;
        const gif = await getAnimeGif(queryTag);
        if (!gif) return message.reply("Không tìm được GIF 😢");

        try {
          const chat = await groq.chat.completions.create({
            messages: [
              { role: "system", content: config.personality },
              { role: "user", content: `Tạo 1 câu anime dễ thương khi ${interactMap[action]} người yêu` }
            ],
            model: "llama-3.3-70b-versatile"
          });

          const interactEmbed = new EmbedBuilder()
            .setDescription(chat.choices[0].message.content)
            .setColor("#ffcc99")
            .setImage(gif);

          return message.reply({ embeds: [interactEmbed] });
        } catch(e) {
          const failEmbed = new EmbedBuilder().setColor("#ffcc99").setImage(gif);
          return message.reply({ embeds: [failEmbed] });
        }
      }
    }

    if (content.startsWith(prefix + "rep")) {
      const args = content.split(" ");
      const msgID = args[1];
      const text = args.slice(2).join(" ");
      if (!msgID || !text) return message.reply(`Dùng: ${prefix}rep <messageID> <nội dung>`);
      try {
        let found = null;
        for (const channel of message.guild.channels.cache.values()) {
          if (!channel.isTextBased()) continue;
          try {
            const msg = await channel.messages.fetch(msgID);
            if (msg) { found = msg; break; }
          } catch {}
        }
        if (!found) return message.reply("Không tìm thấy message.");
        await found.reply(text);
        try { await message.delete(); } catch {}
      } catch (err) {
        message.reply("Lỗi khi reply.");
      }
    }
  });

  client.login(config.token);
});