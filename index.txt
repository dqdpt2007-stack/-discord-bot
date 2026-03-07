require("dotenv").config()

const {Client,GatewayIntentBits,PermissionsBitField}=require("discord.js")
const {Pool}=require("pg")
const Groq=require("groq-sdk")
const axios=require("axios")

/* DATABASE */

const pool=new Pool({
 connectionString:process.env.DATABASE_URL,
 ssl:{rejectUnauthorized:false}
})

async function initDB(){

await pool.query(`
CREATE TABLE IF NOT EXISTS levels(
userid TEXT PRIMARY KEY,

xp_week INT DEFAULT 0,
level_week INT DEFAULT 1,

xp_month INT DEFAULT 0,
level_month INT DEFAULT 1,

xp_year INT DEFAULT 0,
level_year INT DEFAULT 1
)
`)

await pool.query(`
CREATE TABLE IF NOT EXISTS rewards(
id SERIAL PRIMARY KEY,
userid TEXT,
text TEXT
)
`)
}

initDB()

/* XP */

function xpNeeded(level){
return 50*level*level+50*level
}

async function getLevel(id){

const res=await pool.query(
"SELECT * FROM levels WHERE userid=$1",
[id]
)

if(res.rows.length===0){

await pool.query(
"INSERT INTO levels(userid) VALUES($1)",
[id]
)

return{
xp_week:0,level_week:1,
xp_month:0,level_month:1,
xp_year:0,level_year:1
}
}

return res.rows[0]
}

async function saveLevel(id,data){

await pool.query(`
UPDATE levels SET

xp_week=$1,level_week=$2,
xp_month=$3,level_month=$4,
xp_year=$5,level_year=$6

WHERE userid=$7
`,[
data.xp_week,data.level_week,
data.xp_month,data.level_month,
data.xp_year,data.level_year,
id
])

}

/* GROQ */

const groq=new Groq({
apiKey:process.env.GROQ_API_KEY
})

async function actionAI(action){

const chat=await groq.chat.completions.create({

messages:[
{role:"system",content:"Generate a short cute anime romantic reaction."},
{role:"user",content:`User does ${action}`}
],

model:"llama-3.3-70b-versatile"
})

return chat.choices[0].message.content
}

/* GIF */

async function getAnimeGif(tag){

try{

const res=await axios.get(`https://nekos.best/api/v2/${tag}`)

return res.data.results[0].url

}catch{

return null
}
}

/* BOT CONFIG */

const bots=[

{
token:process.env.DISCORD_TOKEN_1,
prefix:"^",

personality:`
BOT 1
Bạn là Woo
bạn trai của Vi
 cậu ấy có tính cách ấm áp và vui vẻ, trung thực và được nhiều người yêu mến
xưng anh gọi người dùng là em
thường thêm các cảm xúc trong // // ví dụ // ngại ngùng //
`
},

{
token:process.env.DISCORD_TOKEN_2,
prefix:"!!",

personality:`
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

]

/* FUN BOT */

bots.forEach(config=>{

const client=new Client({

intents:[
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMessages,
GatewayIntentBits.MessageContent
]

})

client.once("ready",()=>{

console.log("AI BOT:",client.user.tag)

})

client.on("messageCreate",async message=>{

if(message.author.bot)return

const content=message.content
const prefix=config.prefix

/* HI */

if(content===prefix+"hi")
return message.reply("Anh chào em")

/* SLEEP */

if(content===prefix+"sleep")
return message.reply("Ngủ ngon nha")

/* LOVE */

if(content===prefix+"love"){

const percent=Math.floor(Math.random()*101)

return message.reply(`💖 Độ thiện cảm ${percent}%`)
}

/* ACTION COMMANDS */

if(content===prefix+"hug"||
content===prefix+"kiss"||
content===prefix+"pat"){

const action=content.slice(prefix.length)

const gif=await getAnimeGif(action)
const text=await actionAI(action)

return message.reply(text+"\n"+gif)
}

/* REP */

if(content.startsWith(prefix+"rep")){

const args=content.split(" ")
const msgID=args[1]
const text=args.slice(2).join(" ")

let found=null

for(const channel of message.guild.channels.cache.values()){

if(!channel.isTextBased())continue

try{

const msg=await channel.messages.fetch(msgID)

if(msg){
found=msg
break
}

}catch{}

}

if(found){

await found.reply(text)

try{await message.delete()}catch{}

}else{

message.reply("Không tìm thấy message")

}

}

/* AI CHAT */

if(content.startsWith(prefix+"ai ")){

const prompt=content.slice((prefix+"ai ").length)

const chat=await groq.chat.completions.create({

messages:[
{role:"system",content:config.personality},
{role:"user",content:prompt}
],

model:"llama-3.3-70b-versatile"

})

let reply=chat.choices[0].message.content

if(reply.length>2000)
reply=reply.slice(0,2000)

message.reply(reply)

}

})

client.login(config.token)

})

/* LEVEL BOT */

const cooldown=new Map()

const levelBot=new Client({

intents:[
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMessages,
GatewayIntentBits.GuildVoiceStates,
GatewayIntentBits.MessageContent
]

})

levelBot.once("ready",()=>{

console.log("LEVEL BOT:",levelBot.user.tag)

})

levelBot.on("messageCreate",async message=>{

if(message.author.bot)return

const id=message.author.id
const content=message.content

/* COMMAND */

if(content.startsWith("lvl!")){

const args=content.slice(4).split(/ +/)
const cmd=args[0]

/* PROFILE */

if(cmd==="profile"){

const data=await getLevel(id)

const needW=xpNeeded(data.level_week)
const needM=xpNeeded(data.level_month)
const needY=xpNeeded(data.level_year)

const rewards=await pool.query(
"SELECT text FROM rewards WHERE userid=$1",
[id]
)

let ach="None"

if(rewards.rows.length>0){

ach=rewards.rows.map(r=>"• "+r.text).join("\n")

}

return message.reply(`

╔════ PROFILE ════╗

WEEK
Lv ${data.level_week}
XP ${data.xp_week}/${needW}

MONTH
Lv ${data.level_month}
XP ${data.xp_month}/${needM}

YEAR
Lv ${data.level_year}
XP ${data.xp_year}/${needY}

🏆 ACHIEVEMENTS
${ach}

╚═══════════════╝

`)

}

/* REWARD */

if(cmd==="reward"){

if(!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild))
return message.reply("Admin only")

const user=args[1]
const text=args.slice(2).join(" ")

await pool.query(
"INSERT INTO rewards(userid,text) VALUES($1,$2)",
[user,text]
)

return message.reply("Reward added")

}

/* RESET */

if(cmd==="reset"){

if(!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild))
return

const type=args[1]

if(type==="week")
await pool.query("UPDATE levels SET xp_week=0,level_week=1")

if(type==="month")
await pool.query("UPDATE levels SET xp_month=0,level_month=1")

if(type==="year")
await pool.query("UPDATE levels SET xp_year=0,level_year=1")

return message.reply("Reset done")

}

}

/* XP CHAT */

if(content.length<5)return

if(cooldown.has(id)){

if(cooldown.get(id)>Date.now())return

}

cooldown.set(id,Date.now()+15000)

const xp=Math.floor(Math.random()*8)+5

const data=await getLevel(id)

data.xp_week+=xp
data.xp_month+=xp
data.xp_year+=xp

if(data.xp_week>=xpNeeded(data.level_week)){

data.xp_week-=xpNeeded(data.level_week)
data.level_week++

message.channel.send(
`🎉 ${message.author.username} level week ${data.level_week}`
)

}

if(data.xp_month>=xpNeeded(data.level_month)){

data.xp_month-=xpNeeded(data.level_month)
data.level_month++

}

if(data.xp_year>=xpNeeded(data.level_year)){

data.xp_year-=xpNeeded(data.level_year)
data.level_year++

}

await saveLevel(id,data)

})

/* VOICE XP */

setInterval(()=>{

levelBot.guilds.cache.forEach(guild=>{

guild.channels.cache.forEach(channel=>{

if(!channel.isVoiceBased())return

channel.members.forEach(async member=>{

if(member.user.bot)return

const id=member.user.id

const data=await getLevel(id)

data.xp_week+=10
data.xp_month+=10
data.xp_year+=10

await saveLevel(id,data)

})

})

})

},60000)

levelBot.login(process.env.DISCORD_TOKEN_LVL)