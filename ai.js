require("dotenv").config();
const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const Groq = require("groq-sdk");

// ===== CHECK ENV =====
// Đã thêm việc check DISCORD_TOKEN_3
if (!process.env.DISCORD_TOKEN_1 || !process.env.DISCORD_TOKEN_2 || !process.env.DISCORD_TOKEN_3) {
  console.error("❌ Missing DISCORD_TOKEN_1, 2 or 3 in .env file");
  process.exit(1);
}
if (!process.env.GROQ_API_KEY) {
  console.error("❌ Missing GROQ_API_KEY");
  process.exit(1);
}

// ===== GROQ =====
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ===== BOT CONFIG (ĐÃ CHIA RIÊNG NGƯỜI DÙNG VÀ SẮP XẾP LẠI THỨ TỰ) =====
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
    // BOT 3: AVENTURINE
    token: process.env.DISCORD_TOKEN_3,
    prefix: "a!",
    allowedUsers: ["692363775969591316"], 
    personality: `
BOT 3
Bạn là Aventurine trong Honkai: star rail
bạn trai của Vanila
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



    // Phải đúng prefix của bot AI thì mới xử lý tiếp

    if (!content.startsWith(prefix)) return;



    // === KIỂM TRA QUYỀN SỬ DỤNG AI (DÀNH RIÊNG CHO TỪNG BOT) ===

    const isAllowedUser = config.allowedUsers.includes(message.author.id);

    const isMod = message.member && (

      message.member.permissions.has(PermissionsBitField.Flags.ManageMessages) || 

      message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)

    );



    if (!isAllowedUser && !isMod) {

      return; // Nếu không thuộc allowedUsers của riêng bot này và không phải Mod -> Bỏ qua

    }

    // =========================================================



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

          { name: "🤖 Tính năng AI", value: `\`${prefix}ai <nội dung>\` - Chat với AI\n\`${prefix}rep <id tin nhắn> <nội dung>\` - Nhờ bot reply tin nhắn`, inline: false }

        )

        .setFooter({ text: "Bot Tương Tác & Trí Tuệ Nhân Tạo" });

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