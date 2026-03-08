require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, Collection } = require('discord.js');
const { Pool } = require('pg'); // Thêm dòng này nếu cậu dùng Pool trực tiếp ở file này
const { pool, getPlayerBattleStats, initPlayerEquipment } = require('./rpg_core.js'); // Đảm bảo đã có file này

// ============================================================================
// [1] KHỞI TẠO CLIENT & CẤU HÌNH CƠ BẢN
// ============================================================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const PREFIX = 'k!';
const COOLDOWNS = new Collection(); // Chống spam lệnh

// ============================================================================
// [2] HÀM TIỆN ÍCH (HELPER FUNCTIONS)
// ============================================================================

// Hàm tính XP cần thiết để lên cấp tiếp theo
function getNextLevelXp(level) {
    return level * 150 + 100; // Lv1 cần 250, Lv2 cần 400...
}

// Hàm format tiền tệ (Ví dụ: 1000000 -> 1,000,000)
function formatMoney(amount) {
    return amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Hàm đảm bảo user có dữ liệu trong bảng levels (tránh lỗi cột xp không tồn tại)
async function ensureUserExists(userid) {
    const query = `
        INSERT INTO levels (userid, xp_week, lvl_week, xp_month, lvl_month, xp_year, lvl_year, kcoin, daily_last) 
        VALUES ($1, 0, 1, 0, 1, 0, 1, 0, 0) 
        ON CONFLICT (userid) DO NOTHING;
    `;
    await pool.query(query, [userid]);
    await initPlayerEquipment(userid); // Tạo luôn ô chứa đồ bên rpg_core
}

// ============================================================================
// [3] SỰ KIỆN BOT ONLINE
// ============================================================================
client.once('clientReady', async (c) => {
    console.log(`✅ Cốt lõi hệ thống đã nạp xong! Bot ${c.user.tag} đang hoạt động!`);
    client.user.setActivity(`${PREFIX}help | RPG System`, { type: 3 }); // 3 = Watching
});

// ============================================================================
// [4] HỆ THỐNG LẮNG NGHE TIN NHẮN (CỘNG XP & XỬ LÝ LỆNH)
// ============================================================================
client.on('messageCreate', async (message) => {
    // Bỏ qua tin nhắn của bot hoặc tin nhắn sương sương (DM)
    if (message.author.bot || !message.guild) return;

    const userid = message.author.id;

    try {
        // 4.1. CỘNG XP KHI CHAT
        await ensureUserExists(userid);

        // Lấy data hiện tại của user
        const { rows } = await pool.query('SELECT * FROM levels WHERE userid = $1', [userid]);
        let uData = rows[0];

        // Random XP nhận được khi chat (từ 5 đến 15 XP)
        let gainedXp = Math.floor(Math.random() * 11) + 5; 
        
        // Cập nhật XP (Tuần, Tháng, Năm)
        uData.xp_week += gainedXp;
        uData.xp_month += gainedXp;
        uData.xp_year += gainedXp;

        let leveledUp = false;
        let newLvlMsg = "";

        // Kiểm tra lên cấp Tuần
        if (uData.xp_week >= getNextLevelXp(uData.lvl_week)) {
            uData.xp_week -= getNextLevelXp(uData.lvl_week);
            uData.lvl_week += 1;
            uData.kcoin += 100; // Thưởng 100 Kcoin khi lên cấp
            leveledUp = true;
            newLvlMsg += `🌟 Tuần: **${uData.lvl_week}**\n`;
        }
        
        // Lưu lại XP vào Database
        await pool.query(`
            UPDATE levels 
            SET xp_week = $1, lvl_week = $2, xp_month = $3, lvl_month = $4, xp_year = $5, lvl_year = $6, kcoin = $7
            WHERE userid = $8
        `, [uData.xp_week, uData.lvl_week, uData.xp_month, uData.lvl_month, uData.xp_year, uData.lvl_year, uData.kcoin, userid]);

        if (leveledUp) {
            const lvlEmbed = new EmbedBuilder()
                .setColor('#F1C40F')
                .setTitle('🎉 Chúc mừng lên cấp!')
                .setDescription(`Chúc mừng <@${userid}>, cậu vừa thăng cấp!\n${newLvlMsg}\n💰 Thưởng: **+100 Kcoin**`);
            message.channel.send({ embeds: [lvlEmbed] });
        }

        // ============================================================================
        // 4.2. XỬ LÝ CÂU LỆNH (COMMAND HANDLER)
        // ============================================================================
        if (!message.content.startsWith(PREFIX)) return;

        const args = message.content.slice(PREFIX.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        // ---------------------------------------------------------
        // LỆNH: k!help
        // ---------------------------------------------------------
        if (command === 'help') {
            const helpEmbed = new EmbedBuilder()
                .setTitle('📚 Bảng Hướng Dẫn K-RPG')
                .setColor('#3498DB')
                .setDescription('Chào mừng cậu đến với hệ thống RPG. Dưới đây là các lệnh hiện có:')
                .addFields(
                    { name: '👤 Tài khoản & Xếp hạng', value: '`k!profile`: Xem hồ sơ\n`k!daily`: Nhận thưởng\n`k!top`: Bảng xếp hạng\n`k!top money`: Đại gia Kcoin' },
                    { name: '🎒 Trang Bị & Gacha', value: '`k!gacha`: Mở rương (500 Kcoin)\n`k!inv`: Xem túi đồ\n`k!equip <ID>`: Mặc đồ\n`k!sell <ID/all>`: Bán đồ\n`k!upgrade <ID>`: Cường hóa đồ' },
                    { name: '⚔️ Chiến Đấu', value: '`k!info`: Xem chỉ số sức mạnh\n`k!battle @user`: Thách đấu' }
                )
                .setFooter({ text: 'Phiên bản K-RPG v2.0 - Tái Sinh' });
            return message.reply({ embeds: [helpEmbed] });
        }

        // ---------------------------------------------------------
        // LỆNH: k!daily
        // ---------------------------------------------------------
        if (command === 'daily') {
            const now = Date.now();
            const cooldownAmount = 24 * 60 * 60 * 1000;
            const lastDaily = Number(uData.daily_last) || 0;

            if (now - lastDaily < cooldownAmount) {
                const timeLeft = cooldownAmount - (now - lastDaily);
                const hours = Math.floor(timeLeft / (1000 * 60 * 60));
                const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
                return message.reply(`⏳ Cậu đã nhận quà hôm nay rồi! Hãy quay lại sau **${hours} giờ ${minutes} phút** nữa nhé.`);
            }

            const reward = Math.floor(Math.random() * (500 - 200 + 1)) + 200; 
            
            await pool.query(`UPDATE levels SET kcoin = kcoin + $1, daily_last = $2 WHERE userid = $3`, [reward, now, userid]);
            
            const dailyEmbed = new EmbedBuilder()
                .setTitle('🎁 Điểm danh thành công!')
                .setColor('#2ECC71')
                .setDescription(`Cậu nhận được **${formatMoney(reward)} Kcoin**!\nTổng tài sản: **${formatMoney(uData.kcoin + reward)} Kcoin**.`);
            return message.reply({ embeds: [dailyEmbed] });
        }

        // ---------------------------------------------------------
        // LỆNH: k!profile
        // ---------------------------------------------------------
        if (command === 'profile') {
            const targetUser = message.mentions.users.first() || message.author;
            await ensureUserExists(targetUser.id);
            const res = await pool.query('SELECT * FROM levels WHERE userid = $1', [targetUser.id]);
            const tData = res.rows[0];

            const isDailyReady = (Date.now() - (Number(tData.daily_last) || 0)) >= (24 * 60 * 60 * 1000);

            const profileEmbed = new EmbedBuilder()
                .setTitle(`👤 Hồ sơ của ${targetUser.username}`)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                .setColor('#9B59B6')
                .addFields(
                    { name: '🌟 Tuần', value: `Lv: **${tData.lvl_week}**\nXP: ${tData.xp_week}/${getNextLevelXp(tData.lvl_week)}`, inline: true },
                    { name: '🔥 Tháng', value: `Lv: **${tData.lvl_month}**\nXP: ${tData.xp_month}/${getNextLevelXp(tData.lvl_month)}`, inline: true },
                    { name: '👑 Năm', value: `Lv: **${tData.lvl_year}**\nXP: ${tData.xp_year}/${getNextLevelXp(tData.lvl_year)}`, inline: true },
                    { name: '💰 Tài Sản', value: `**${formatMoney(tData.kcoin)}** Kcoin`, inline: false },
                    { name: '🎁 Daily', value: isDailyReady ? '✅ Đã sẵn sàng!' : `❌ Chưa hồi (<t:${Math.floor((Number(tData.daily_last) + 86400000)/1000)}:R>)`, inline: false }
                );
            return message.reply({ embeds: [profileEmbed] });
        }

        // ---------------------------------------------------------
        // LỆNH: k!info
        // ---------------------------------------------------------
        if (command === 'info') {
            const targetUser = message.mentions.users.first() || message.author;
            const battleData = await getPlayerBattleStats(targetUser.id);
            const stats = battleData.totalStats;
            const eq = battleData.equipment;

            const formatItem = (item) => {
                if (!item || Object.keys(item).length === 0) return '`[ Trống ]`';
                return `**${item.name}** ${item.upgrade ? `(+${item.upgrade})` : ''}`;
            };

            const infoEmbed = new EmbedBuilder()
                .setTitle(`⚔️ Chỉ số chiến đấu: ${targetUser.username}`)
                .setColor('#E74C3C')
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '❤️ Máu (HP)', value: `${stats.hp}`, inline: true },
                    { name: '🛡️ Giáp', value: `${stats.armor}`, inline: true },
                    { name: '🗡️ Sát thương', value: `${stats.dmg}`, inline: true },
                    { name: '⚡ Tốc độ', value: `${stats.speed}`, inline: true },
                    { name: '💨 Né tránh', value: `${stats.dodgeChance}%`, inline: true },
                    { name: '💥 Chí mạng', value: `${stats.critChance}% (ST: x${stats.critDamage/100})`, inline: true },
                    { name: '\u200B', value: '👕 **TRANG BỊ HIỆN TẠI**', inline: false },
                    { name: 'Vũ khí', value: formatItem(eq.weapon), inline: true },
                    { name: 'Mũ', value: formatItem(eq.head), inline: true },
                    { name: 'Áo Giáp', value: formatItem(eq.chest), inline: true },
                    { name: 'Quần', value: formatItem(eq.legs), inline: true },
                    { name: 'Găng tay', value: formatItem(eq.gloves), inline: true },
                    { name: 'Giày', value: formatItem(eq.boots), inline: true }
                );
            return message.reply({ embeds: [infoEmbed] });
        }

        // ---------------------------------------------------------
        // LỆNH: k!gacha
        // ---------------------------------------------------------
        if (command === 'gacha' || command === 'open') {
            const cost = 500;
            if (uData.kcoin < cost) {
                return message.reply(`❌ Cậu không đủ tiền! Cần **${cost} Kcoin** để mở rương. Đi chat thêm hoặc dùng \`k!daily\` đi nhé.`);
            }

            await pool.query(`UPDATE levels SET kcoin = kcoin - $1 WHERE userid = $2`, [cost, userid]);

            const rarities = ['Gỗ', 'Đồng', 'Sắt', 'Vàng', 'Kim Cương', 'Phượng Hoàng'];
            const armorTypes = ['head', 'chest', 'legs', 'boots', 'gloves'];
            const weaponTypes = ['Kiếm', 'Đao', 'Cung', 'Pháp Trượng'];
            
            const rand = Math.random() * 100;
            let tier = 0;
            if (rand < 5) tier = 5; 
            else if (rand < 15) tier = 4; 
            else if (rand < 30) tier = 3; 
            else if (rand < 60) tier = 2; 
            else if (rand < 85) tier = 1; 
            else tier = 0; 

            const rarityName = rarities[tier];
            const isWeapon = Math.random() > 0.5;
            
            let newItem = {
                id: Math.random().toString(36).substr(2, 6),
                rarity: rarityName,
                upgrade: 0
            };

            if (isWeapon) {
                const wType = weaponTypes[Math.floor(Math.random() * weaponTypes.length)];
                newItem.type = 'weapon';
                newItem.name = `${wType} ${rarityName}`;
                newItem.dmg = Math.floor(Math.random() * (10 + tier * 20)) + (5 + tier * 10);
                newItem.buffs = {};
                if (Math.random() > 0.5) newItem.buffs.critChance = Math.floor(Math.random() * 5) + 1; 
                if (tier >= 3) newItem.buffs.lifesteal = Math.floor(Math.random() * 5) + 1; 
            } else {
                const aType = armorTypes[Math.floor(Math.random() * armorTypes.length)];
                newItem.type = aType;
                const partNames = { 'head': 'Mũ', 'chest': 'Áo', 'legs': 'Quần', 'boots': 'Giày', 'gloves': 'Găng' };
                newItem.name = `${partNames[aType]} ${rarityName}`;
                newItem.hp = Math.floor(Math.random() * (20 + tier * 40)) + (10 + tier * 20);
                newItem.armor = Math.floor(Math.random() * (5 + tier * 10)) + (2 + tier * 5);
                newItem.weight = Math.max(0, 5 - tier); 
                newItem.buffs = {};
                if (Math.random() > 0.7) newItem.buffs.dodgeChance = Math.floor(Math.random() * 3) + 1;
            }

            const eqData = await pool.query('SELECT inventory FROM equipment WHERE userid = $1', [userid]);
            let inv = eqData.rows[0]?.inventory || [];
            inv.push(newItem);

            await pool.query('UPDATE equipment SET inventory = $1::jsonb WHERE userid = $2', [JSON.stringify(inv), userid]);

            const gachaEmbed = new EmbedBuilder()
                .setTitle('🎉 Mở Rương Thành Công!')
                .setColor('#E67E22')
                .setDescription(`Cậu đã tiêu **${cost} Kcoin** và nhận được:\n\n**${newItem.name}** (ID: \`${newItem.id}\`)`)
                .addFields(
                    { name: 'Chỉ số', value: `Loại: ${newItem.type}\n${newItem.dmg ? `🗡️ DMG: ${newItem.dmg}` : `❤️ HP: ${newItem.hp} | 🛡️ Giáp: ${newItem.armor}`}` },
                    { name: 'Thuộc tính ẩn', value: Object.keys(newItem.buffs).length > 0 ? JSON.stringify(newItem.buffs) : 'Không có' }
                )
                .setFooter({ text: `Dùng k!equip ${newItem.id} để mặc đồ` });
            
            return message.reply({ embeds: [gachaEmbed] });
        }

        // ---------------------------------------------------------
        // LỆNH: k!inventory
        // ---------------------------------------------------------
        if (command === 'inventory' || command === 'inv') {
            await ensureUserExists(userid);
            const eqData = await pool.query('SELECT inventory FROM equipment WHERE userid = $1', [userid]);
            const inv = eqData.rows[0]?.inventory || [];

            if (inv.length === 0) return message.reply("🎒 Túi đồ của cậu đang trống rỗng! Dùng `k!gacha` để kiếm đồ nhé.");

            const invEmbed = new EmbedBuilder()
                .setTitle(`🎒 Túi đồ của ${message.author.username}`)
                .setColor('#8E44AD')
                .setDescription('Dùng lệnh `k!equip <ID>` để mặc đồ nhé.');

            const displayInv = inv.slice(-15).reverse(); 

            let invString = '';
            displayInv.forEach((item, index) => {
                const stats = item.dmg ? `🗡️${item.dmg}` : `❤️${item.hp} 🛡️${item.armor}`;
                invString += `\`${item.id}\` | **${item.name}** ${item.upgrade ? `(+${item.upgrade})` : ''} | ${stats}\n`;
            });

            invEmbed.addFields({ name: 'Các vật phẩm', value: invString });
            return message.reply({ embeds: [invEmbed] });
        }

        // ---------------------------------------------------------
        // LỆNH: k!equip <ID>
        // ---------------------------------------------------------
        if (command === 'equip') {
            const itemId = args[0];
            if (!itemId) return message.reply("❌ Cậu phải nhập ID món đồ muốn mặc! (Ví dụ: `k!equip a8f9b`)");

            const eqData = await pool.query('SELECT * FROM equipment WHERE userid = $1', [userid]);
            let equipment = eqData.rows[0];
            let inv = equipment.inventory || [];

            const itemIndex = inv.findIndex(i => i.id === itemId);
            if (itemIndex === -1) return message.reply("❌ Không tìm thấy món đồ này trong túi của cậu!");

            const itemToEquip = inv[itemIndex];
            const slot = itemToEquip.type; 

            inv.splice(itemIndex, 1);

            const currentEquipped = equipment[slot];
            if (currentEquipped && Object.keys(currentEquipped).length > 0) {
                inv.push(currentEquipped);
            }

            await pool.query(`
                UPDATE equipment 
                SET "${slot}" = $1::jsonb, inventory = $2::jsonb 
                WHERE userid = $3
            `, [JSON.stringify(itemToEquip), JSON.stringify(inv), userid]);

            return message.reply(`✅ Cậu đã trang bị thành công **${itemToEquip.name}**! Dùng \`k!info\` để xem chỉ số mới.`);
        }

        // ---------------------------------------------------------
        // LỆNH: k!battle <@user>
        // ---------------------------------------------------------
        if (command === 'battle' || command === 'pvp') {
            const target = message.mentions.users.first();
            if (!target) return message.reply("❌ Cậu muốn đánh với ai? Hãy tag họ vào! (VD: `k!battle @Kaworu`)");
            if (target.id === userid) return message.reply("❌ Cậu không thể tự đấm chính mình được!");
            if (target.bot) return message.reply("❌ Không được bắt nạt bot nhé!");

            const p1Data = await getPlayerBattleStats(userid);
            const p2Data = await getPlayerBattleStats(target.id);

            let p1 = { name: message.author.username, ...p1Data.totalStats };
            let p2 = { name: target.username, ...p2Data.totalStats };

            let battleLog = `⚔️ **TRẬN CHIẾN BẮT ĐẦU:** ${p1.name} 🆚 ${p2.name}\n\n`;
            let turn = 1;
            const maxTurns = 15;

            let attacker = p1.speed >= p2.speed ? p1 : p2;
            let defender = p1.speed >= p2.speed ? p2 : p1;

            while (p1.hp > 0 && p2.hp > 0 && turn <= maxTurns) {
                battleLog += `**[Hiệp ${turn}]** `;

                const isDodge = Math.random() * 100 < defender.dodgeChance;
                
                if (isDodge) {
                    battleLog += `💨 ${defender.name} lách người **né được** đòn tấn công của ${attacker.name}!\n`;
                } else {
                    let finalDmg = attacker.dmg;
                    const isCrit = Math.random() * 100 < attacker.critChance;
                    
                    if (isCrit) {
                        finalDmg = Math.floor(finalDmg * (attacker.critDamage / 100));
                    }

                    const damageReductionMultiplier = 100 / (100 + defender.armor);
                    let actualDamage = Math.floor(finalDmg * damageReductionMultiplier);
                    if (actualDamage < 1) actualDamage = 1; 

                    defender.hp -= actualDamage;

                    let critText = isCrit ? '💥 **CHÍ MẠNG!** ' : '🗡️ ';
                    battleLog += `${critText}${attacker.name} chém ${defender.name} mất **${actualDamage} HP**! *(Giáp đỡ được ${finalDmg - actualDamage})*\n`;

                    if (attacker.lifesteal > 0) {
                        const healAmount = Math.floor(actualDamage * (attacker.lifesteal / 100));
                        if (healAmount > 0) {
                            attacker.hp += healAmount;
                            battleLog += `🧛 *${attacker.name} hút lại ${healAmount} HP!*\n`;
                        }
                    }
                }

                if (defender.hp <= 0) break;

                let temp = attacker;
                attacker = defender;
                defender = temp;
                turn++;
            }

            battleLog += `\n`;
            
            let resultEmbed = new EmbedBuilder().setColor('#E74C3C');
            if (p1.hp <= 0) {
                battleLog += `💀 ${p1.name} gục ngã! **${p2.name} DÀNH CHIẾN THẮNG!** 🏆`;
                resultEmbed.setTitle('🔥 KẾT QUẢ PVP: BẠN ĐÃ THUA 🔥');
            } else if (p2.hp <= 0) {
                battleLog += `💀 ${p2.name} gục ngã! **${p1.name} DÀNH CHIẾN THẮNG!** 🏆`;
                resultEmbed.setTitle('🔥 KẾT QUẢ PVP: BẠN ĐÃ THẮNG! 🔥');
            } else {
                battleLog += `⏳ Hết 15 hiệp, không ai gục ngã. **HÒA!** 🤝`;
                resultEmbed.setTitle('🔥 KẾT QUẢ PVP: HÒA NHAU 🔥');
            }

            resultEmbed.setDescription(battleLog)
                       .setFooter({ text: `Máu còn lại: ${p1.name} (${Math.max(0, p1.hp)} HP) | ${p2.name} (${Math.max(0, p2.hp)} HP)` });

            return message.reply({ embeds: [resultEmbed] });
        }

        // ---------------------------------------------------------
        // LỆNH: k!sell <ID> 
        // ---------------------------------------------------------
        if (command === 'sell') {
            const itemId = args[0];
            if (!itemId) return message.reply("❌ Cậu phải nhập ID món đồ muốn bán! (Ví dụ: `k!sell a8f9b`). Hoặc dùng lệnh `k!sellall` để bán nhanh.");

            const eqData = await pool.query('SELECT inventory FROM equipment WHERE userid = $1', [userid]);
            let inv = eqData.rows[0]?.inventory || [];

            if (itemId.toLowerCase() === 'all') {
                const trashRarities = ['Gỗ', 'Đồng'];
                const itemsToKeep = [];
                let totalEarned = 0;
                let soldCount = 0;

                inv.forEach(item => {
                    if (trashRarities.includes(item.rarity)) {
                        const price = item.rarity === 'Gỗ' ? 50 : 100;
                        totalEarned += price + ((item.upgrade || 0) * 20);
                        soldCount++;
                    } else {
                        itemsToKeep.push(item);
                    }
                });

                if (soldCount === 0) return message.reply("🎒 Túi của cậu không có đồ Gỗ hay Đồng nào để dọn dẹp cả!");

                await pool.query('UPDATE equipment SET inventory = $1::jsonb WHERE userid = $2', [JSON.stringify(itemsToKeep), userid]);
                await pool.query('UPDATE levels SET kcoin = kcoin + $1 WHERE userid = $2', [totalEarned, userid]);

                return message.reply(`🧹 **Dọn Kho:** Cậu đã bán **${soldCount}** món đồ rác (Gỗ/Đồng) và thu về **${formatMoney(totalEarned)} Kcoin**!`);
            }

            const itemIndex = inv.findIndex(i => i.id === itemId);
            if (itemIndex === -1) return message.reply("❌ Không tìm thấy món đồ này trong túi của cậu! (Lưu ý: Không thể bán đồ đang mặc trên người)");

            const itemToSell = inv[itemIndex];
            
            const prices = { 'Gỗ': 50, 'Đồng': 100, 'Sắt': 250, 'Vàng': 500, 'Kim Cương': 1500, 'Phượng Hoàng': 5000 };
            const basePrice = prices[itemToSell.rarity] || 50;
            const upgradeBonus = (itemToSell.upgrade || 0) * 50; 
            const totalEarned = basePrice + upgradeBonus;

            inv.splice(itemIndex, 1);

            await pool.query('UPDATE equipment SET inventory = $1::jsonb WHERE userid = $2', [JSON.stringify(inv), userid]);
            await pool.query('UPDATE levels SET kcoin = kcoin + $1 WHERE userid = $2', [totalEarned, userid]);

            return message.reply(`💰 Cậu đã bán **${itemToSell.name}** ${itemToSell.upgrade ? `(+${itemToSell.upgrade})` : ''} và bỏ túi **${formatMoney(totalEarned)} Kcoin**!`);
        }

        // ---------------------------------------------------------
        // LỆNH: k!upgrade <ID> 
        // ---------------------------------------------------------
        if (command === 'upgrade' || command === 'forge') {
            const itemId = args[0];
            if (!itemId) return message.reply("❌ Cậu muốn thợ rèn đập món nào? Nhập ID vào nhé! (VD: `k!upgrade a8f9b`)");

            const eqData = await pool.query('SELECT inventory FROM equipment WHERE userid = $1', [userid]);
            let inv = eqData.rows[0]?.inventory || [];

            const itemIndex = inv.findIndex(i => i.id === itemId);
            if (itemIndex === -1) return message.reply("❌ Không tìm thấy đồ! Cậu phải cất đồ vào túi (`k!equip` món khác ra) mới mang đi rèn được.");

            let item = inv[itemIndex];
            if (!item.upgrade) item.upgrade = 0;

            if (item.upgrade >= 15) return message.reply("✨ Món đồ này đã đạt cảnh giới tối đa (+15). Không thể đập thêm!");

            const cost = 200 + (item.upgrade * 150); 
            const successRate = Math.max(10, 90 - (item.upgrade * 6)); 

            if (uData.kcoin < cost) {
                return message.reply(`❌ Cậu thiếu tiền rồi! Cần **${formatMoney(cost)} Kcoin** để nâng món này lên +${item.upgrade + 1}.`);
            }

            await pool.query('UPDATE levels SET kcoin = kcoin - $1 WHERE userid = $2', [cost, userid]);

            const rand = Math.random() * 100;
            const forgeEmbed = new EmbedBuilder();

            if (rand <= successRate) {
                item.upgrade += 1;
                if (item.type === 'weapon') {
                    item.dmg = Math.floor(item.dmg * 1.15); 
                } else {
                    item.hp = Math.floor(item.hp * 1.15); 
                    item.armor += 2; 
                }

                inv[itemIndex] = item;
                await pool.query('UPDATE equipment SET inventory = $1::jsonb WHERE userid = $2', [JSON.stringify(inv), userid]);

                forgeEmbed
                    .setTitle('🔨 LÒ RÈN: THÀNH CÔNG RỰC RỠ!')
                    .setColor('#2ECC71')
                    .setDescription(`Ting! Ting! Tiếng búa vang lên, món đồ phát sáng!\n\n**${item.name}** đã lên **+${item.upgrade}**!`)
                    .addFields({ name: 'Chi phí', value: `-${formatMoney(cost)} Kcoin`, inline: true })
                    .addFields({ name: 'Chỉ số mới', value: item.dmg ? `🗡️ DMG: ${item.dmg}` : `❤️ HP: ${item.hp} | 🛡️ Giáp: ${item.armor}`, inline: true });
            } else {
                forgeEmbed
                    .setTitle('🔨 LÒ RÈN: XỊT MẤT RỒI...')
                    .setColor('#E74C3C')
                    .setDescription(`Xèo xèo... Lò rèn bốc khói đen. Đập thất bại rồi cậu ơi!\n(Đồ vẫn còn nguyên, chỉ bay màu **${formatMoney(cost)} Kcoin**)`)
                    .setFooter({ text: `Tỉ lệ thành công vừa rồi là: ${successRate}%` });
            }

            return message.reply({ embeds: [forgeEmbed] });
        }

        // ---------------------------------------------------------
        // LỆNH: k!top 
        // ---------------------------------------------------------
        // ---------------------------------------------------------
        // LỆNH: k!top <week/month/year/money>
        // ---------------------------------------------------------
        if (command === 'top' || command === 'leaderboard') {
            const type = args[0] ? args[0].toLowerCase() : 'year'; // Mặc định là năm
            
            if (['money', 'kcoin', 'coin'].includes(type)) {
                const { rows } = await pool.query('SELECT userid, kcoin FROM levels ORDER BY kcoin DESC LIMIT 10');
                
                let boardStr = '';
                for (let i = 0; i < rows.length; i++) {
                    boardStr += `**#${i + 1}** | <@${rows[i].userid}> - 💰 **${formatMoney(rows[i].kcoin)}**\n`;
                }

                const topEmbed = new EmbedBuilder()
                    .setTitle('🏆 BẢNG VÀNG: TOP 10 ĐẠI GIA KCOIN')
                    .setColor('#F1C40F')
                    .setDescription(boardStr || 'Chưa có ai trong danh sách này!');
                return message.reply({ embeds: [topEmbed] });

            } else if (['week', 'month', 'year'].includes(type)) {
                let lvlCol = `lvl_${type}`;
                let xpCol = `xp_${type}`;
                let title = type === 'week' ? 'TUẦN' : (type === 'month' ? 'THÁNG' : 'NĂM');

                // Lấy top 10 theo cột tương ứng
                const { rows } = await pool.query(`SELECT userid, ${lvlCol}, ${xpCol} FROM levels ORDER BY ${lvlCol} DESC, ${xpCol} DESC LIMIT 10`);
                
                let boardStr = '';
                for (let i = 0; i < rows.length; i++) {
                    boardStr += `**#${i + 1}** | <@${rows[i].userid}> - 👑 Lv **${rows[i][lvlCol]}** (XP: ${rows[i][xpCol]})\n`;
                }

                const topEmbed = new EmbedBuilder()
                    .setTitle(`🏆 BẢNG VÀNG: TOP 10 CAO THỦ CÀY CUỐC (${title})`)
                    .setColor('#3498DB')
                    .setDescription(boardStr || 'Chưa có ai trong danh sách này!')
                    .setFooter({ text: 'Dùng k!top week/month/year/money để xem các bảng xếp hạng khác' });
                return message.reply({ embeds: [topEmbed] });
                
            } else {
                return message.reply("❌ Sai cú pháp! Hãy dùng: `k!top week`, `k!top month`, `k!top year`, hoặc `k!top money`.");
            }
        }

        // ---------------------------------------------------------
        // LỆNH: k!rank (Xem thứ hạng của bản thân hoặc người khác)
        // ---------------------------------------------------------
        if (command === 'rank') {
            const targetUser = message.mentions.users.first() || message.author;
            await ensureUserExists(targetUser.id);

            // Dùng Window Function của PostgreSQL để tính thứ hạng trực tiếp trên DB
            const queries = [
                pool.query(`SELECT rank FROM (SELECT userid, RANK() OVER (ORDER BY lvl_week DESC, xp_week DESC) as rank FROM levels) t WHERE userid = $1`, [targetUser.id]),
                pool.query(`SELECT rank FROM (SELECT userid, RANK() OVER (ORDER BY lvl_month DESC, xp_month DESC) as rank FROM levels) t WHERE userid = $1`, [targetUser.id]),
                pool.query(`SELECT rank FROM (SELECT userid, RANK() OVER (ORDER BY lvl_year DESC, xp_year DESC) as rank FROM levels) t WHERE userid = $1`, [targetUser.id]),
                pool.query(`SELECT rank FROM (SELECT userid, RANK() OVER (ORDER BY kcoin DESC) as rank FROM levels) t WHERE userid = $1`, [targetUser.id])
            ];

            // Chạy cả 4 truy vấn cùng lúc cho mượt
            const [resWeek, resMonth, resYear, resCoin] = await Promise.all(queries);

            const rankEmbed = new EmbedBuilder()
                .setTitle(`📊 Thứ hạng của ${targetUser.username}`)
                .setColor('#9B59B6')
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '🌟 Hạng Tuần', value: `**#${resWeek.rows[0]?.rank || '?' }**`, inline: true },
                    { name: '🔥 Hạng Tháng', value: `**#${resMonth.rows[0]?.rank || '?' }**`, inline: true },
                    { name: '👑 Hạng Năm', value: `**#${resYear.rows[0]?.rank || '?' }**`, inline: true },
                    { name: '💰 Đại Gia', value: `**#${resCoin.rows[0]?.rank || '?' }**`, inline: true }
                );

            return message.reply({ embeds: [rankEmbed] });
        }
// ---------------------------------------------------------
        // LỆNH: k!cf (Cờ bạc tung đồng xu)
        // ---------------------------------------------------------
        if (command === 'cf' || command === 'coinflip') {
            const betAmount = parseInt(args[0]);
            if (isNaN(betAmount) || betAmount <= 0) return message.reply("❌ Cậu phải nhập số tiền muốn cược! (VD: `k!cf 500`)");
            if (uData.kcoin < betAmount) return message.reply("❌ Cậu không có đủ tiền để cược chừng này! Đừng có bốc bát họ nhé.");

            const isWin = Math.random() >= 0.5; // Tỉ lệ 50/50 xanh chín
            if (isWin) {
                await pool.query('UPDATE levels SET kcoin = kcoin + $1 WHERE userid = $2', [betAmount, userid]);
                return message.reply(`🪙 Đồng xu lật ngửa! Cậu **THẮNG** và ẵm trọn **${formatMoney(betAmount)} Kcoin**! 🎉`);
            } else {
                await pool.query('UPDATE levels SET kcoin = kcoin - $1 WHERE userid = $2', [betAmount, userid]);
                return message.reply(`🪙 Đồng xu lật sấp! Cậu **THUA** và mất sạch **${formatMoney(betAmount)} Kcoin**! Ra đê mà ở nhé 💸`);
            }
        }

        // ---------------------------------------------------------
        // LỆNH: k!give (Chuyển tiền cho người khác)
        // ---------------------------------------------------------
        if (command === 'give' || command === 'pay') {
            const target = message.mentions.users.first();
            const amount = parseInt(args[1]);
            
            if (!target || isNaN(amount) || amount <= 0) return message.reply("❌ Sai cú pháp! (VD: `k!give @user 1000`)");
            if (target.id === userid) return message.reply("❌ Tự chuyển tiền cho chính mình? Cậu rảnh hả!");
            if (uData.kcoin < amount) return message.reply("❌ Trong ví không đủ tiền, đòi làm người tốt chuyển khoản cho ai?");

            await ensureUserExists(target.id);
            // Trừ tiền người gửi, cộng tiền người nhận
            await pool.query('UPDATE levels SET kcoin = kcoin - $1 WHERE userid = $2', [amount, userid]);
            await pool.query('UPDATE levels SET kcoin = kcoin + $1 WHERE userid = $2', [amount, target.id]);
            
            return message.reply(`💸 Cậu đã chuyển khoản cái rẹt **${formatMoney(amount)} Kcoin** cho **${target.username}**!`);
        }

        // ---------------------------------------------------------
        // LỆNH: k!giveitem (Tặng đồ cho người khác)
        // ---------------------------------------------------------
        if (command === 'giveitem') {
            const target = message.mentions.users.first();
            const itemId = args[1];
            
            if (!target || !itemId) return message.reply("❌ Sai cú pháp! (VD: `k!giveitem @user a8f9b`)");
            if (target.id === userid) return message.reply("❌ Không thể tự tặng đồ cho mình!");

            const eqData = await pool.query('SELECT inventory FROM equipment WHERE userid = $1', [userid]);
            let myInv = eqData.rows[0]?.inventory || [];
            
            const itemIndex = myInv.findIndex(i => i.id === itemId);
            if (itemIndex === -1) return message.reply("❌ Không tìm thấy món đồ này trong túi của cậu!");

            // Rút đồ ra khỏi túi mình
            const itemToGive = myInv.splice(itemIndex, 1)[0];

            await ensureUserExists(target.id);
            const targetEqData = await pool.query('SELECT inventory FROM equipment WHERE userid = $1', [target.id]);
            let targetInv = targetEqData.rows[0]?.inventory || [];
            
            // Nhét đồ vào túi người nhận
            targetInv.push(itemToGive);

            // Cập nhật database cho cả 2
            await pool.query('UPDATE equipment SET inventory = $1::jsonb WHERE userid = $2', [JSON.stringify(myInv), userid]);
            await pool.query('UPDATE equipment SET inventory = $1::jsonb WHERE userid = $2', [JSON.stringify(targetInv), target.id]);

            return message.reply(`🎁Bạn đã tặng **${itemToGive.name}** ${itemToGive.upgrade ? `(+${itemToGive.upgrade})` : ''} cho **${target.username}**!`);
        }
    } catch (err) {
        console.error('Lỗi hệ thống khi xử lý tin nhắn:', err);
    }
}); // <--- ĐÂY LÀ DẤU ĐÓNG CỦA SỰ KIỆN LẮNG NGHE TIN NHẮN!

// Bỏ comment dòng này ra để chạy bot nhé!
// ============================================================================
// [5] HỆ THỐNG TREO VOICE NHẬN THƯỞNG
// ============================================================================
const voiceSessions = new Map(); // Nơi lưu trữ thời gian bắt đầu vào voice

client.on('voiceStateUpdate', async (oldState, newState) => {
    if (newState.member.user.bot) return; // Không tính cho bot
    const userid = newState.member.user.id;

    // Trạng thái: MỚI VÀO KÊNH VOICE
    if (!oldState.channelId && newState.channelId) {
        voiceSessions.set(userid, Date.now()); // Lưu lại mốc thời gian vác mặt vào
    }
    // Trạng thái: THOÁT KHỎI KÊNH VOICE
    else if (oldState.channelId && !newState.channelId) {
        const joinTime = voiceSessions.get(userid);
        if (joinTime) {
            const durationMs = Date.now() - joinTime;
            const minutes = Math.floor(durationMs / 60000); // Đổi ra phút
            voiceSessions.delete(userid); // Xóa phiên treo máy

            // Nếu treo được lớn hơn 1 phút mới thưởng
            if (minutes > 0) {
                const earnedXp = minutes * 5; // Treo 1 phút được 5 XP
                const earnedKcoin = minutes * 10; // Treo 1 phút được 10 Kcoin

                try {
                    await ensureUserExists(userid);
                    await pool.query(`
                        UPDATE levels 
                        SET xp_week = xp_week + $1, xp_month = xp_month + $1, xp_year = xp_year + $1, kcoin = kcoin + $2 
                        WHERE userid = $3
                    `, [earnedXp, earnedKcoin, userid]);
                    
                    // Có thể bot sẽ chat log vào 1 kênh nào đó, nhưng tạm thời tớ cho nó im lặng cộng ngầm để đỡ rác server.
                    console.log(`🎙️ [Voice] ${newState.member.user.tag} treo ${minutes} phút, nhận ${earnedXp} XP và ${earnedKcoin} Kcoin.`);
                } catch (err) {
                    console.error("Lỗi khi cộng quà treo Voice:", err);
                }
            }
        }
    }
});
// client.login(process.env.DISCORD_TOKEN_LVL);