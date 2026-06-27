const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEFAULT_CHAT = process.env.TELEGRAM_DEFAULT_CHAT_ID;

export async function sendTelegram(chatId, text) {
    if (!TG_TOKEN) {
        console.warn('TELEGRAM_BOT_TOKEN не задан, пропускаем отправку');
        return false;
    }

    const targetChatId = chatId || DEFAULT_CHAT;
    if (!targetChatId) {
        console.warn('Нет chat_id для отправки сообщения');
        return false;
    }

    try {
        const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: targetChatId,
                text,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            })
        });

        if (!res.ok) {
            const errBody = await res.text();
            console.error('Telegram API error:', res.status, errBody);
            return false;
        }
        return true;
    } catch (err) {
        console.error('Telegram send failed:', err.message);
        return false;
    }
}

export function formatNewBookingMessage(booking, tenant, room) {
    const checkIn = new Date(booking.check_in).toLocaleDateString('ru-RU');
    const checkOut = new Date(booking.check_out).toLocaleDateString('ru-RU');
    const nights = Math.ceil((new Date(booking.check_out) - new Date(booking.check_in)) / 86400000);

    return [
        `🔔 <b>Новая бронь</b> — ${tenant.name}`,
        '',
        `<b>Номер:</b> ${room.name}`,
        `<b>Гость:</b> ${booking.guest_name}`,
        `<b>Телефон:</b> ${booking.guest_phone}`,
        `<b>Заезд:</b> ${checkIn}`,
        `<b>Выезд:</b> ${checkOut} (${nights} ноч.)`,
        `<b>Сумма:</b> ${Number(booking.total_price).toLocaleString('ru-RU')} ₸`,
        '',
        `<i>Источник: сайт</i>`,
        `<i>ID брони: ${booking.id}</i>`
    ].join('\n');
}
