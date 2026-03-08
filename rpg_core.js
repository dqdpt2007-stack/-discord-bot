const { Pool } = require('pg');
// Nhớ cấu hình pool DB của cậu ở đây nhé
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Hàm này dùng để đảm bảo ai cũng có file lưu đồ trong Database
 */
async function initPlayerEquipment(userid) {
    const query = `
        INSERT INTO equipment (userid) 
        VALUES ($1) 
        ON CONFLICT (userid) DO NOTHING;
    `;
    await pool.query(query, [userid]);
}

/**
 * Hàm lấy toàn bộ trang bị và TÍNH TOÁN CHỈ SỐ TỔNG
 * Sau này có thêm buff/debuff mới, hàm này tự động cộng dồn mà không cần sửa nhiều!
 */
async function getPlayerBattleStats(userid) {
    await initPlayerEquipment(userid);
    
    const { rows } = await pool.query('SELECT * FROM equipment WHERE userid = $1', [userid]);
    const eq = rows[0];

    // Chỉ số gốc của nhân vật (khi cởi truồng)
    let totalStats = {
        hp: 100,
        armor: 0,
        dmg: 5,
        speed: 20,
        dodgeChance: 0,
        critChance: 0,
        critDamage: 150, // Mặc định chí mạng x1.5 sát thương
        lifesteal: 0,
        buffs: {} // Nơi chứa các buff đặc biệt (đốt máu, độc, kháng...)
    };

    // Danh sách các ô trang bị
    const slots = ['weapon', 'head', 'chest', 'legs', 'boots', 'gloves'];

    slots.forEach(slot => {
        const item = eq[slot];
        if (item && Object.keys(item).length > 0) {
            // Cộng chỉ số cơ bản
            if (item.hp) totalStats.hp += item.hp;
            if (item.armor) totalStats.armor += item.armor;
            if (item.dmg) totalStats.dmg += item.dmg;
            if (item.weight) totalStats.speed -= item.weight; // Giáp nặng thì trừ tốc độ

            // Xử lý Buffs/Debuffs (Tính năng xịn xò cậu muốn đây!)
            if (item.buffs) {
                for (const [buffName, buffValue] of Object.entries(item.buffs)) {
                    // Nếu là chỉ số cứng thì cộng thẳng
                    if (totalStats[buffName] !== undefined && typeof totalStats[buffName] === 'number') {
                        totalStats[buffName] += buffValue;
                    } else {
                        // Nếu là buff lạ (độc, lửa, v.v.), gom vào object buffs
                        if (!totalStats.buffs[buffName]) totalStats.buffs[buffName] = 0;
                        totalStats.buffs[buffName] += buffValue;
                    }
                }
            }
        }
    });

    // Tránh việc tốc độ bị âm do giáp quá nặng
    if (totalStats.speed < 1) totalStats.speed = 1;

    return { equipment: eq, totalStats };
}

module.exports = { initPlayerEquipment, getPlayerBattleStats, pool };