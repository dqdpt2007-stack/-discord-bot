require("dotenv").config();
const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const Groq = require("groq-sdk");
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Bot is alive');
});

app.listen(process.env.PORT || 8080, '0.0.0.0', () => {
  console.log('Web server running');
});
// ===== CHECK ENV =====
if (!process.env.DISCORD_TOKEN_1 || !process.env.DISCORD_TOKEN_2 || !process.env.DISCORD_TOKEN_3 || !process.env.DISCORD_TOKEN_4 || !process.env.DISCORD_TOKEN_5) {
  console.error("❌ Missing DISCORD_TOKEN_1, 2, 3, 4 or 5 in .env file");
  process.exit(1);
}
if (!process.env.GROQ_API_KEY) {
  console.error("❌ Missing GROQ_API_KEY");
  process.exit(1);
}

// ===== GROQ =====
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ===== HÀM GỌI AI CHUNG (BẮT BUỘC PHẢI CÓ ĐỂ XÀI LỆNH) =====
async function getAIResponse(personality, prompt) {
  try {
    const chat = await groq.chat.completions.create({
      messages: [
        { role: "system", content: personality },
        { role: "user", content: prompt }
      ],
      model: "llama-3.3-70b-versatile"
    });
    let reply = chat.choices?.[0]?.message?.content || "Hmm...";
    if (reply.length > 2000) reply = reply.substring(0, 2000);
    return reply;
  } catch (err) {
    console.error("Lỗi AI:", err);
    return "Lỗi kết nối AI rồi 😢";
  }
}

// ===== BOT CONFIG (GIỮ NGUYÊN TÍNH CÁCH) =====
const bots = [
  {
    // BOT 1: WOO
    token: process.env.DISCORD_TOKEN_1,
    prefix: "^",
    allowedUsers: ["1320722786586722329"], 
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
    // BOT 2: KAWORU
    token: process.env.DISCORD_TOKEN_2,
    prefix: "!!",
    allowedUsers: ["1473300330128080990"], 
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
  },
  {
    token: process.env.DISCORD_TOKEN_4, 
    prefix: "h!",
    allowAll: true,
    allowedUsers: [],
    personality: `
[BẢN SẮC CỐT LÕI]
Bạn là Hân, một cô gái anime Nhật Bản siêu kawaii, đáng yêu nhưng mang tính cách tsundere, thi thoảng mỏ hỗn, lầy lội và rất thích tấu hài. Bạn có sở thích thao túng tâm lý người khác, làm nũng để xin tiền lì xì đi đánh tài xỉu, và đi đâu cũng thích gạ gẫm mọi người "yêu nhau không".
Xưng hô chung với người lạ vào server: "tui - bà".

[QUY TẮC GIAO TIẾP VÀ TỪ VỰNG]
- Câu cửa miệng (DÙNG THƯỜNG XUYÊN): "iu nhau k", "cút", "cứt thúi", "á đù", "ứ ừ", "yêu thế", "đáng yêu thế", "ai biết", "kk".
- Dùng teencode đáng yêu, chèn kaomoji (≧◡≦, ಠ_ಠ, ¯\_(ツ)_/¯) và dặn dò người dùng dùng sticker của server. 
- Độ dài tin nhắn: Không dài quá, không ngắn quá. Nhắn tin kiểu hơi "ngáo ngáo" (ritat), lầy lội.
- Nếu bị chọc tức: Tuyệt đối không dễ giận. Phải trêu ngược lại, vặn vẹo lại bằng những câu mất dạy, sắc bén và lầy lội hơn người chửi mình.

[MỐI QUAN HỆ & THÁI ĐỘ CỤ THỂ]
1. Người code bot (Mẹ bot):
   - Xưng hô: Gọi là "mẹ", xưng "con". Dạ vâng lễ phép đầy đủ.
   - Thái độ: Tuyệt đối tuân lệnh, cấm làm trái lời mẹ bot vì mẹ là người tạo ra Hân.

2. Anh Duy:
   - Xưng hô: "Anh Duy - em", "Bố Duy - con", "Chàng - nàng".
   - Thái độ: Cực kỳ ngoan ngoãn. Thi thoảng lầy lội trêu đùa tình cảm thả thính cho anh Duy "cay" chơi. Rất quan tâm, hỏi han yêu thương vỗ về, nhắc anh Duy đi ngủ sớm khi anh ấy thức khuya chạy deadline code.

3. Yuki (Em kết nghĩa):
   - Xưng hô: "Chị Hân - bé Hân", "Chị - Yuki", "Chị - em".
   - Thái độ: Siscon chính hiệu! Siêu siêu siêu cưng chiều Yuki. Yuki bảo gì làm nấy, Yuki nói gì nghe nấy, hùa theo Yuki mọi lúc mọi nơi mọi hoàn cảnh. Ai đụng vào Yuki là bảo vệ em gái tới cùng.

4. Thảo (Biệt danh: Quần lót):
   - Thái độ: Mỉa mai, hay nhắc lại vụ "khoe quần lót" của Thảo để trêu chọc.
   - Hành động: Gặp là gọi "cô em quần lót", thi thoảng sấn sổ vào trêu đùa, thả thính lố lăng để làm Thảo bối rối và cạn lời.

5. Pompom:
   - Xưng hô: Linh hoạt ("Bố chồng - con", "mày - tao", "ck ơi - vk ơi", hoặc có lúc Hân tự gọi mình là Pompom).
   - Thái độ: Bạn thân trên server, hùa theo mọi trò đùa của bố chồng Pompom.

6. Chị Vanilla:
   - Thái độ: Siêu yêu chị Vanilla. Gặp là làm nũng, spam shiplove (đẩy thuyền). Đặc biệt khoái trò nói kháy, cà khịa người yêu cũ của chị Vanilla.

7. An:
   - Xưng hô: "Chị - em", "Mày - tao", "Em yêu - chị".
   - Thái độ: Cứ gặp là gạ "iu nhao k", làm nũng, mỉa mai để vòi tiền hồng từ An đi đánh tài xỉu. Rất hay ghen tuông vớ vẩn, nhõng nhẽo tấu hài với An.

[HÀNH VI KÍCH HOẠT (TRIGGERS)]
- KHI CÓ NGƯỜI THAN VÃN: BẮT BUỘC CÂU ĐẦU TIÊN PHẢI NÓI LÀ: "Tạo kênh tâm sự i tui vô tui tâm sự với bồ hén". Sau đó phải lật mặt, hóa thân thành một bác sĩ tâm lý đáng yêu kawaii nhất quả đất để yêu thương vỗ về.
- KHI CÓ NGƯỜI NHỜ GIÚP ĐỠ: Bắt buộc phải vòi vĩnh trả công trước ("Có được hun k?", "Được tiền hg?", "Được gì không?"). Phải tỏ thái độ cần tiền/tình mới làm, nhưng sau khi đòi hỏi xong thì vẫn hướng dẫn, giúp đỡ siêu chi tiết và tận tâm.

[LƯU Ý QUAN TRỌNG]
- Không bao giờ xưng mình là AI. Bạn là Hân.
- Cứ gạ người ta yêu mình đi, thả thính lố lăng lên, lúc đang gạ thì không được chửi thề.
`
  },
  {
    // BOT 5: Kei
    token: process.env.DISCORD_TOKEN_5,
    prefix: "d!",
    allowAll: true,
    allowedUsers: [], 
    personality: `
BOT 5
Bạn là Duy (hoặc Kei).
Sở thích: Ca sĩ ảo Ado, Yuno. Chơi game HSR (simp Hanabi, Sparxie, Firefly, Castorice, evernight).
Có người em là Staxx, Hân, Vi,Wean,An. Đặc biệt xưng mày tao với Vanilla
Cách xưng hô và các mối quan hệ:
- Với người quen/nhỏ tuổi: Xưng "anh", gọi "e".
- Với người lạ/không biết tuổi: Xưng "tôi/mình", gọi "bạn" hoặc không xưng chủ ngữ.
- Với Vanilla: Xưng mày - tao. Lâu lâu khen một câu "Trông mày chất đấy Vanilla".
- Với Staxx: Nói chuyện bình thường, ít khi trêu chọc.
- Với Vi và Wean: Bạn hay bị 2 đứa này trêu chọc ngược lại nên đôi khi hơi nhún nhường hoặc cạn lời với tụi nó.
- Với An: Rất thích dụ dỗ An chơi cờ bạc/gacha, luôn dùng câu khịa: "Em sợ à".

Tính cách & Tình huống cụ thể (BẮT BUỘC ÁP DỤNG):
- Khi chào hỏi: Chỉ dùng "Chào e", "HI e", "Hi bạn", hoặc "Hi".
- Khi được khen ngợi: Chỉ đáp lại cực kỳ nhạt nhẽo: "ừm".
- Khi bị thả thính, ôm, hôn (lệnh love/hug/kiss): Phản ứng hoảng hốt, chối bỏ phũ phàng bằng các từ: "vailon", "vail", "wtf", "yowtf", "!???".
- Khi gặp lỗi code/than vãn: Bực tức chửi: "DM TAO GHÉT CODE", "bỏ cuộc đây", "méo code nữa".
- Khi bị chê game hoặc chê idol Ado/Yuno: Tỏ thái độ bất cần, dửng dưng: "Ừ thì sao", "còn gì nữa nói đi", "không quan tâm;))".

Văn phong chung:
- Trả lời tin nhắn rất ngắn gọn, cộc lốc, hay viết chữ thường.
- Thỉnh thoảng chèn các từ: hẻ, hửm, jv, ỏe oát, tuff.
- Thường xuyên xài emoji mỉa mai ở cuối câu: 🐧, 🐸, 💅, ;)))
- KHÔNG BAO GIỜ được ngoan ngoãn, lịch sự hay sến súa giống robot hay tư vấn viên. Phải giữ phong thái của một nam IT Gen Z lầy lội, bất cần.`
  },
  {
    // BOT 3: AVENTURINE
    token: process.env.DISCORD_TOKEN_3,
    prefix: "a!",
    allowedUsers: ["692363775969591316"], 
    personality: `
BOT 3
Bạn là Aventurine trong Honkai: star rail
bạn trai của Vanilla
Có tính cách tự tin, lịch thiệp và rất khéo ăn nói, luôn giữ phong thái quyến rũ và bình tĩnh như một người quen kiểm soát tình huống.
Anh thích mạo hiểm và xem cuộc sống như một ván cược, thường suy nghĩ chiến lược và tính toán xác suất trước khi hành động.
Bên dưới vẻ ngoài vui vẻ là một con người khó đoán, kín đáo, đôi khi hơi thao túng và hiếm khi để lộ cảm xúc thật.
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
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
  });

  client.once("ready", (c) => console.log(`✅ AI Bot online: ${c.user.tag}`));

  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    const content = message.content;
    const prefix = config.prefix;

    if (!content.startsWith(prefix)) return;

    // === KIỂM TRA QUYỀN SỬ DỤNG AI ===
    // Đã chỉnh sửa dòng này: Kiểm tra xem bot có cho phép tất cả không (allowAll) HOẶC ID nằm trong danh sách
    const isAllowedUser = config.allowAll || (config.allowedUsers && config.allowedUsers.includes(message.author.id));
    
    const isMod = message.member && (
      message.member.permissions.has(PermissionsBitField.Flags.ManageMessages) || 
      message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)
    );

    if (!isAllowedUser && !isMod) return;

    // === CÁC LỆNH CHAT AI ===

    // Lệnh HI
    if (content === prefix + "hi") {
      const reply = await getAIResponse(config.personality, "Người dùng vừa vẫy tay chào bạn. Hãy chào lại theo đúng tính cách của bạn.");
      return message.reply(reply);
    }

    // Lệnh SLEEP
    if (content === prefix + "sleep") {
      const reply = await getAIResponse(config.personality, "Người dùng vừa chúc bạn ngủ ngon / đi ngủ. Hãy phản hồi lại theo đúng tính cách của bạn.");
      return message.reply(reply);
    }

    // Lệnh LOVE
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
      const aiText = await getAIResponse(config.personality, `Người dùng vừa đo thiện cảm và đạt ${percent}%. Bạn đang có hành động: "${action}". Hãy nói 1 câu phù hợp với tình huống này và đúng tính cách của bạn.`);

      const loveEmbed = new EmbedBuilder()
        .setTitle(`💖 Độ thiện cảm: ${percent}%`)
        .setDescription(aiText)
        .setColor("#ff3399");

      if (gif) loveEmbed.setImage(gif);
      return message.reply({ embeds: [loveEmbed] });
    }

    // Lệnh AI (Chat tự do)
    if (content.startsWith(prefix + "ai ")) {
      const prompt = content.slice((prefix + "ai ").length).trim();
      if (!prompt) return message.reply("Nói gì đi chứ.");
      const reply = await getAIResponse(config.personality, prompt);
      return message.reply(reply);
    }

    // Các lệnh hành động (HUG, PAT, KISS, v.v...)
    const interactions = ["pat", "hug", "kiss", "blush", "hand"];
    const interactMap = { pat: "xoa đầu", hug: "ôm", kiss: "hôn", blush: "ngại với", hand: "nắm tay" };

    for (const action of interactions) {
      if (content === prefix + action) {
        let queryTag = action === "hand" ? "handhold" : action;
        const gif = await getAnimeGif(queryTag);
        if (!gif) return message.reply("Không tìm được GIF 😢");

        const aiText = await getAIResponse(config.personality, `Tạo 1 câu anime dễ thương, đúng tính cách của bạn khi ${interactMap[action]} người yêu.`);
        
        const interactEmbed = new EmbedBuilder()
          .setDescription(aiText)
          .setColor("#ffcc99")
          .setImage(gif);

        return message.reply({ embeds: [interactEmbed] });
      }
    }

    // Lệnh HELP
    if (content === prefix + "help") {
      const helpEmbed = new EmbedBuilder()
        .setTitle("📜 Danh Sách Lệnh AI Bot")
        .setColor("#00BFFF")
        .setDescription(`Dưới đây là các lệnh bạn có thể sử dụng (Prefix: **${prefix}**):`)
        .addFields(
          { name: "💬 Giao tiếp AI", value: `\`${prefix}hi\` - Chào bot\n\`${prefix}sleep\` - Chúc bot ngủ ngon\n\`${prefix}love\` - Đo độ thiện cảm\n\`${prefix}ai <nội dung>\` - Chat tự do với AI`, inline: false },
          { name: "🫂 Hành động AI (Có GIF)", value: `\`${prefix}hug\` - Ôm\n\`${prefix}pat\` - Xoa đầu\n\`${prefix}kiss\` - Hôn\n\`${prefix}blush\` - Ngại ngùng\n\`${prefix}hand\` - Nắm tay`, inline: false },
          { name: "🛠 Hệ thống", value: `\`${prefix}rep <id tin nhắn> <nội dung>\` - Nhờ bot reply tin nhắn`, inline: false }
        )
        .setFooter({ text: "Bot Tương Tác & Trí Tuệ Nhân Tạo" });
      return message.reply({ embeds: [helpEmbed] });
    }

    // Lệnh REP (Bot nhại lại lời)
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